import chalk from "chalk";
import { EventEmitter } from "events";
import { ConnectionManager } from "./ConnectionManager.js";
import { HealthMonitor } from "./HealthMonitor.js";
import { ProcessManager } from "./ProcessManager.js";
import { StateManager } from "./StateManager.js";
import { ErrorRecovery } from "./ErrorRecovery.js";

export interface OrchestratorConfig {
  comfyuiUrl?: string;
  sandboxPath?: string;
  autoRestart?: boolean;
  healthMonitoring?: boolean;
  errorRecovery?: boolean;
  stateManagement?: boolean;
  connectionManagement?: boolean;
}

export class ServerOrchestrator extends EventEmitter {
  private connectionManager: ConnectionManager | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private processManager: ProcessManager = new ProcessManager();
  private stateManager: StateManager | null = null;
  private errorRecovery: ErrorRecovery | null = null;
  private config: Required<OrchestratorConfig>;
  private isInitialized: boolean = false;
  private isShuttingDown: boolean = false;

  constructor(config: OrchestratorConfig = {}) {
    super();
    
    this.config = {
      comfyuiUrl: config.comfyuiUrl ?? 'http://127.0.0.1:8188',
      sandboxPath: config.sandboxPath ?? 'sandbox/ComfyUI_Sandbox_CUDA126',
      autoRestart: config.autoRestart ?? true,
      healthMonitoring: config.healthMonitoring ?? true,
      errorRecovery: config.errorRecovery ?? true,
      stateManagement: config.stateManagement ?? true,
      connectionManagement: config.connectionManagement ?? true
    };

    console.error(chalk.blue(`🎭 ServerOrchestrator initializing...`));
    
    // Initialize core components
    this.initializeComponents();
    
    // Set up component interactions
    this.setupComponentInteractions();
    
    console.error(chalk.green(`✅ ServerOrchestrator initialized`));
  }

  private initializeComponents(): void {
    // Initialize Connection Manager
    if (this.config.connectionManagement) {
      this.connectionManager = new ConnectionManager({
        maxReconnectAttempts: 10,
        baseReconnectDelay: 2000,
        maxReconnectDelay: 30000,
        healthCheckInterval: 5000
      });
    }

    // Initialize Health Monitor
    if (this.config.healthMonitoring) {
      this.healthMonitor = new HealthMonitor({
        checkInterval: 5000,
        comfyuiUrl: this.config.comfyuiUrl,
        healthThreshold: 70,
        criticalThreshold: 30,
        maxConsecutiveFailures: 3
      });
    }

    // Initialize Process Manager
    this.processManager = new ProcessManager();

    // Initialize State Manager
    if (this.config.stateManagement) {
      this.stateManager = new StateManager({
        persistState: true,
        snapshotInterval: 30000,
        maxSnapshots: 100,
        autoSave: true
      });
    }

    // Initialize Error Recovery
    if (this.config.errorRecovery) {
      this.errorRecovery = new ErrorRecovery({
        maxGlobalRetries: 3,
        enableGracefulDegradation: true,
        enableCircuitBreaker: true,
        circuitBreakerThreshold: 5,
        circuitBreakerTimeout: 60000
      });
    }
  }

  private setupComponentInteractions(): void {
    // Connection Manager Events
    if (this.connectionManager) {
      this.connectionManager.on('connected', (connectionId) => {
        console.error(chalk.green(`🔗 Connection established: ${connectionId}`));
        if (this.stateManager) {
          this.stateManager.updateConnectionState({
            isConnected: true,
            connectionId,
            lastConnected: new Date(),
            reconnectAttempts: 0
          });
        }
        this.emit('connectionEstablished', connectionId);
      });

      this.connectionManager.on('disconnected', (connectionId) => {
        console.error(chalk.yellow(`🔌 Connection lost: ${connectionId}`));
        if (this.stateManager) {
          this.stateManager.updateConnectionState({
            isConnected: false,
            lastDisconnected: new Date()
          });
        }
        this.emit('connectionLost', connectionId);
      });

      this.connectionManager.on('reconnectAttempt', (attempt) => {
        console.error(chalk.yellow(`🔄 Reconnection attempt: ${attempt}`));
        if (this.stateManager) {
          this.stateManager.updateConnectionState({ reconnectAttempts: attempt });
        }
      });

      this.connectionManager.on('connectionAbandoned', (attempts) => {
        console.error(chalk.red(`💥 Connection abandoned after ${attempts} attempts`));
        this.handleCriticalFailure('connection_abandoned', { attempts });
      });
    }

    // Health Monitor Events
    if (this.healthMonitor) {
      this.healthMonitor.on('healthCheck', (metrics) => {
        if (this.stateManager) {
          this.stateManager.updateHealthState({
            lastHealthCheck: metrics.timestamp,
            healthScore: metrics.healthScore,
            overallHealth: metrics.overallHealth
          });
        }
      });

      this.healthMonitor.on('criticalHealth', (metrics) => {
        console.error(chalk.red(`🚨 Critical health detected: ${metrics.healthScore}`));
        this.handleCriticalFailure('critical_health', metrics);
      });

      this.healthMonitor.on('healthStatusChanged', (current, previous, metrics) => {
        console.error(chalk.blue(`🔄 Health status: ${previous} → ${current}`));
        this.emit('healthStatusChanged', current, previous, metrics);
      });
    }

    // Process Manager Events
    this.processManager.on('processStarted', (name, info) => {
      console.error(chalk.green(`🚀 Process started: ${name} (PID: ${info.pid})`));
      if (this.stateManager) {
        this.stateManager.updateProcessState({
          activeProcessCount: this.processManager.getAllProcesses().filter(p => p.status === 'running').length
        });
      }
    });

    this.processManager.on('processExited', (name, code, signal) => {
      console.error(chalk.yellow(`🛑 Process exited: ${name} (code: ${code}, signal: ${signal})`));
      if (this.config.autoRestart && !this.isShuttingDown) {
        this.handleProcessFailure(name, code, signal);
      }
    });

    this.processManager.on('processError', (name, error) => {
      console.error(chalk.red(`❌ Process error: ${name} - ${error.message}`));
      this.handleProcessError(name, error);
    });

    // Error Recovery Events
    if (this.errorRecovery) {
      this.errorRecovery.on('recoverySuccess', (attempt) => {
        console.error(chalk.green(`✅ Recovery successful: ${attempt.strategy.name}`));
        if (this.stateManager) {
          this.stateManager.recordRecoveryAttempt();
        }
      });

      this.errorRecovery.on('recoveryFailed', (context) => {
        console.error(chalk.red(`💥 Recovery failed for: ${context.toolName}.${context.operation}`));
        this.handleRecoveryFailure(context);
      });

      this.errorRecovery.on('circuitBreakerTripped', (operationKey, failures) => {
        console.error(chalk.red(`🚫 Circuit breaker tripped: ${operationKey} (${failures} failures)`));
        this.emit('circuitBreakerTripped', operationKey, failures);
      });
    }
  }

  public async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      console.error(chalk.yellow(`⚠️ ServerOrchestrator already initialized`));
      return true;
    }

    try {
      console.error(chalk.blue(`🚀 Starting ServerOrchestrator initialization...`));

      // Start health monitoring
      if (this.healthMonitor) {
        this.healthMonitor.startMonitoring();
      }

      // Initialize connection
      if (this.connectionManager) {
        const connected = await this.connectionManager.connect(async () => {
          try {
            const response = await fetch(`${this.config.comfyuiUrl}/queue`, {
              method: 'GET',
              signal: AbortSignal.timeout(5000)
            });
            return response.ok;
          } catch {
            return false;
          }
        });

        if (!connected) {
          console.error(chalk.yellow(`⚠️ Initial connection failed, but orchestrator will continue`));
        }
      }

      this.isInitialized = true;
      console.error(chalk.green(`✅ ServerOrchestrator initialization complete`));
      this.emit('initialized');
      return true;

    } catch (error) {
      console.error(chalk.red(`❌ ServerOrchestrator initialization failed: ${error}`));
      this.emit('initializationFailed', error);
      return false;
    }
  }

  public async executeWithRecovery<T>(
    operation: string,
    toolName: string,
    executor: () => Promise<T>,
    metadata: Record<string, any> = {}
  ): Promise<T> {
    const operationId = `${toolName}_${operation}_${Date.now()}`;
    
    try {
      // Record operation start
      if (this.stateManager) {
        this.stateManager.addActiveOperation(operationId);
        this.stateManager.recordToolCall(toolName, true); // Optimistic
      }

      // Execute the operation
      const result = await executor();

      // Record success
      if (this.stateManager) {
        this.stateManager.removeActiveOperation(operationId);
      }

      return result;

    } catch (error) {
      console.error(chalk.red(`❌ Operation failed: ${toolName}.${operation} - ${error}`));

      // Record failure
      if (this.stateManager) {
        this.stateManager.removeActiveOperation(operationId);
        this.stateManager.recordToolCall(toolName, false);
        this.stateManager.recordError(error as Error, false);
      }

      // Attempt recovery if enabled
      if (this.errorRecovery) {
        const context = this.errorRecovery.createErrorContext(
          operation,
          toolName,
          error as Error,
          'medium',
          metadata
        );

        const recovered = await this.errorRecovery.handleError(context);
        
        if (recovered) {
          // Retry the operation after successful recovery
          try {
            const result = await executor();
            if (this.stateManager) {
              this.stateManager.recordToolCall(toolName, true);
            }
            return result;
          } catch (retryError) {
            console.error(chalk.red(`❌ Operation failed even after recovery: ${retryError}`));
            throw retryError;
          }
        }
      }

      throw error;
    }
  }

  private async handleCriticalFailure(type: string, data: any): Promise<void> {
    console.error(chalk.red(`🚨 Critical failure detected: ${type}`));
    
    if (this.stateManager) {
      this.stateManager.recordError(new Error(`Critical failure: ${type}`), true);
    }

    // Attempt emergency recovery
    try {
      if (type === 'connection_abandoned') {
        await this.emergencyRestart();
      } else if (type === 'critical_health') {
        await this.emergencyCleanup();
      }
    } catch (error) {
      console.error(chalk.red(`💥 Emergency recovery failed: ${error}`));
    }

    this.emit('criticalFailure', type, data);
  }

  private async handleProcessFailure(name: string, _code: number | null, _signal: string | null): Promise<void> {
    console.error(chalk.yellow(`🔄 Handling process failure: ${name}`));
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Attempt to restart the process
    try {
      await this.processManager.restartProcess(name);
    } catch (error) {
      console.error(chalk.red(`❌ Failed to restart process ${name}: ${error}`));
      this.handleCriticalFailure('process_restart_failed', { name, error });
    }
  }

  private async handleProcessError(name: string, error: Error): Promise<void> {
    if (this.errorRecovery) {
      const context = this.errorRecovery.createErrorContext(
        'process_management',
        'ProcessManager',
        error,
        'high',
        { processName: name }
      );

      await this.errorRecovery.handleError(context);
    }
  }

  private async handleRecoveryFailure(context: any): Promise<void> {
    console.error(chalk.red(`💥 All recovery attempts failed for ${context.toolName}.${context.operation}`));
    
    // Consider emergency measures
    if (context.severity === 'critical') {
      await this.emergencyRestart();
    }
  }

  private async emergencyRestart(): Promise<void> {
    console.error(chalk.red(`🚨 Initiating emergency restart...`));
    
    try {
      // Kill all ComfyUI processes
      await this.processManager.killAllComfyUIProcesses();
      
      // Reset state
      if (this.stateManager) {
        this.stateManager.resetState(true);
      }
      
      // Reset connection manager
      if (this.connectionManager) {
        this.connectionManager.resetReconnectAttempts();
      }
      
      console.error(chalk.green(`✅ Emergency restart completed`));
      this.emit('emergencyRestart');
      
    } catch (error) {
      console.error(chalk.red(`💥 Emergency restart failed: ${error}`));
      throw error;
    }
  }

  private async emergencyCleanup(): Promise<void> {
    console.error(chalk.yellow(`🧹 Initiating emergency cleanup...`));
    
    try {
      // Perform comprehensive cleanup
      const result = await this.processManager.killAllComfyUIProcesses();
      
      console.error(chalk.green(`✅ Emergency cleanup completed: ${result.processesKilled} processes killed`));
      this.emit('emergencyCleanup', result);
      
    } catch (error) {
      console.error(chalk.red(`💥 Emergency cleanup failed: ${error}`));
      throw error;
    }
  }

  public getStatus() {
    return {
      isInitialized: this.isInitialized,
      isShuttingDown: this.isShuttingDown,
      connection: this.connectionManager?.getState(),
      health: this.healthMonitor?.getLastMetrics(),
      processes: this.processManager?.getAllProcesses(),
      state: this.stateManager?.getStateMetrics(),
      recovery: this.errorRecovery?.getRecoveryMetrics(),
      circuitBreakers: this.errorRecovery?.getCircuitBreakerStatus()
    };
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.error(chalk.yellow(`🛑 ServerOrchestrator shutdown initiated...`));

    try {
      // Stop health monitoring
      if (this.healthMonitor) {
        this.healthMonitor.stopMonitoring();
      }

      // Disconnect connection manager
      if (this.connectionManager) {
        this.connectionManager.disconnect();
      }

      // Save state
      if (this.stateManager) {
        await this.stateManager.saveState();
      }

      // Destroy components
      this.connectionManager?.destroy();
      this.healthMonitor?.destroy();
      this.processManager?.destroy();
      this.stateManager?.destroy();
      this.errorRecovery?.destroy();

      console.error(chalk.green(`✅ ServerOrchestrator shutdown complete`));
      this.emit('shutdown');

    } catch (error) {
      console.error(chalk.red(`❌ Shutdown error: ${error}`));
      throw error;
    }
  }
}
