import chalk from "chalk";
import { EventEmitter } from "events";
import fs from "fs-extra";
import path from "path";

export interface ServerState {
  sessionId: string;
  startTime: Date;
  lastActivity: Date;
  connectionState: {
    isConnected: boolean;
    connectionId: string | null;
    lastConnected: Date | null;
    lastDisconnected: Date | null;
    reconnectAttempts: number;
  };
  processState: {
    managedProcesses: Record<string, any>;
    lastCleanup: Date | null;
    activeProcessCount: number;
  };
  healthState: {
    lastHealthCheck: Date | null;
    healthScore: number;
    overallHealth: string;
    consecutiveFailures: number;
  };
  toolState: {
    lastToolCall: Date | null;
    toolCallCount: number;
    failedToolCalls: number;
    activeOperations: string[];
  };
  errorState: {
    lastError: Date | null;
    errorCount: number;
    criticalErrors: number;
    recoveryAttempts: number;
  };
  configuration: {
    comfyuiUrl: string;
    sandboxPath: string;
    autoRestart: boolean;
    healthMonitoring: boolean;
  };
}

export interface StateSnapshot {
  timestamp: Date;
  state: ServerState;
  checksum: string;
}

export interface StateManagerConfig {
  persistState?: boolean;
  stateFilePath?: string;
  snapshotInterval?: number;
  maxSnapshots?: number;
  autoSave?: boolean;
  compressionEnabled?: boolean;
}

export class StateManager extends EventEmitter {
  private currentState: ServerState;
  private config: Required<StateManagerConfig>;
  private snapshots: StateSnapshot[] = [];
  private snapshotTimer: NodeJS.Timeout | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private stateFilePath: string;

  constructor(config: StateManagerConfig = {}) {
    super();
    
    this.config = {
      persistState: config.persistState ?? true,
      stateFilePath: config.stateFilePath ?? path.join(process.cwd(), 'state', 'server-state.json'),
      snapshotInterval: config.snapshotInterval ?? 30000, // 30 seconds
      maxSnapshots: config.maxSnapshots ?? 100,
      autoSave: config.autoSave ?? true,
      compressionEnabled: config.compressionEnabled ?? false
    };

    this.stateFilePath = this.config.stateFilePath;
    
    // Initialize state
    this.currentState = this.createInitialState();
    
    console.error(chalk.blue(`📊 StateManager initialized with session: ${this.currentState.sessionId}`));
    
    // Load persisted state if available
    if (this.config.persistState) {
      this.loadPersistedState();
    }
    
    // Start automatic snapshots
    this.startSnapshotTimer();
    
    // Start auto-save if enabled
    if (this.config.autoSave) {
      this.startAutoSave();
    }
  }

  private createInitialState(): ServerState {
    return {
      sessionId: this.generateSessionId(),
      startTime: new Date(),
      lastActivity: new Date(),
      connectionState: {
        isConnected: false,
        connectionId: null,
        lastConnected: null,
        lastDisconnected: null,
        reconnectAttempts: 0
      },
      processState: {
        managedProcesses: {},
        lastCleanup: null,
        activeProcessCount: 0
      },
      healthState: {
        lastHealthCheck: null,
        healthScore: 0,
        overallHealth: 'unknown',
        consecutiveFailures: 0
      },
      toolState: {
        lastToolCall: null,
        toolCallCount: 0,
        failedToolCalls: 0,
        activeOperations: []
      },
      errorState: {
        lastError: null,
        errorCount: 0,
        criticalErrors: 0,
        recoveryAttempts: 0
      },
      configuration: {
        comfyuiUrl: 'http://127.0.0.1:8188',
        sandboxPath: 'sandbox/ComfyUI_Sandbox_CUDA126',
        autoRestart: true,
        healthMonitoring: true
      }
    };
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public updateConnectionState(updates: Partial<ServerState['connectionState']>): void {
    this.currentState.connectionState = {
      ...this.currentState.connectionState,
      ...updates
    };
    this.currentState.lastActivity = new Date();
    
    console.error(chalk.blue(`🔗 Connection state updated: ${JSON.stringify(updates)}`));
    this.emit('connectionStateChanged', this.currentState.connectionState);
    this.triggerAutoSave();
  }

  public updateProcessState(updates: Partial<ServerState['processState']>): void {
    this.currentState.processState = {
      ...this.currentState.processState,
      ...updates
    };
    this.currentState.lastActivity = new Date();
    
    console.error(chalk.blue(`🔧 Process state updated`));
    this.emit('processStateChanged', this.currentState.processState);
    this.triggerAutoSave();
  }

  public updateHealthState(updates: Partial<ServerState['healthState']>): void {
    this.currentState.healthState = {
      ...this.currentState.healthState,
      ...updates
    };
    this.currentState.lastActivity = new Date();
    
    this.emit('healthStateChanged', this.currentState.healthState);
    this.triggerAutoSave();
  }

  public updateToolState(updates: Partial<ServerState['toolState']>): void {
    this.currentState.toolState = {
      ...this.currentState.toolState,
      ...updates
    };
    this.currentState.lastActivity = new Date();
    
    this.emit('toolStateChanged', this.currentState.toolState);
    this.triggerAutoSave();
  }

  public updateErrorState(updates: Partial<ServerState['errorState']>): void {
    this.currentState.errorState = {
      ...this.currentState.errorState,
      ...updates
    };
    this.currentState.lastActivity = new Date();
    
    console.error(chalk.red(`❌ Error state updated: ${JSON.stringify(updates)}`));
    this.emit('errorStateChanged', this.currentState.errorState);
    this.triggerAutoSave();
  }

  public updateConfiguration(updates: Partial<ServerState['configuration']>): void {
    this.currentState.configuration = {
      ...this.currentState.configuration,
      ...updates
    };
    this.currentState.lastActivity = new Date();
    
    console.error(chalk.blue(`⚙️ Configuration updated: ${JSON.stringify(updates)}`));
    this.emit('configurationChanged', this.currentState.configuration);
    this.triggerAutoSave();
  }

  public recordToolCall(toolName: string, success: boolean): void {
    this.currentState.toolState.lastToolCall = new Date();
    this.currentState.toolState.toolCallCount++;
    
    if (!success) {
      this.currentState.toolState.failedToolCalls++;
    }
    
    this.currentState.lastActivity = new Date();
    this.emit('toolCallRecorded', toolName, success);
    this.triggerAutoSave();
  }

  public addActiveOperation(operationId: string): void {
    if (!this.currentState.toolState.activeOperations.includes(operationId)) {
      this.currentState.toolState.activeOperations.push(operationId);
      this.emit('operationStarted', operationId);
    }
  }

  public removeActiveOperation(operationId: string): void {
    const index = this.currentState.toolState.activeOperations.indexOf(operationId);
    if (index > -1) {
      this.currentState.toolState.activeOperations.splice(index, 1);
      this.emit('operationCompleted', operationId);
    }
  }

  public recordError(error: Error, isCritical: boolean = false): void {
    this.currentState.errorState.lastError = new Date();
    this.currentState.errorState.errorCount++;
    
    if (isCritical) {
      this.currentState.errorState.criticalErrors++;
    }
    
    this.currentState.lastActivity = new Date();
    
    console.error(chalk.red(`📝 Error recorded: ${error.message} (critical: ${isCritical})`));
    this.emit('errorRecorded', error, isCritical);
    this.triggerAutoSave();
  }

  public recordRecoveryAttempt(): void {
    this.currentState.errorState.recoveryAttempts++;
    this.currentState.lastActivity = new Date();
    
    console.error(chalk.yellow(`🔄 Recovery attempt recorded (total: ${this.currentState.errorState.recoveryAttempts})`));
    this.emit('recoveryAttempted', this.currentState.errorState.recoveryAttempts);
    this.triggerAutoSave();
  }

  public resetState(preserveConfiguration: boolean = true): void {
    const oldSessionId = this.currentState.sessionId;
    const config = preserveConfiguration ? this.currentState.configuration : undefined;
    
    this.currentState = this.createInitialState();
    
    if (config) {
      this.currentState.configuration = config;
    }
    
    console.error(chalk.yellow(`🔄 State reset: ${oldSessionId} → ${this.currentState.sessionId}`));
    this.emit('stateReset', oldSessionId, this.currentState.sessionId);
    this.triggerAutoSave();
  }

  public createSnapshot(): StateSnapshot {
    const snapshot: StateSnapshot = {
      timestamp: new Date(),
      state: JSON.parse(JSON.stringify(this.currentState)), // Deep clone
      checksum: this.calculateChecksum(this.currentState)
    };
    
    this.snapshots.push(snapshot);
    
    // Limit snapshot history
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }
    
    this.emit('snapshotCreated', snapshot);
    return snapshot;
  }

  private calculateChecksum(state: ServerState): string {
    const stateString = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < stateString.length; i++) {
      const char = stateString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  public restoreFromSnapshot(snapshotIndex: number): boolean {
    if (snapshotIndex < 0 || snapshotIndex >= this.snapshots.length) {
      console.error(chalk.red(`❌ Invalid snapshot index: ${snapshotIndex}`));
      return false;
    }

    const snapshot = this.snapshots[snapshotIndex];
    if (!snapshot) {
      console.error(chalk.red(`❌ Snapshot not found at index: ${snapshotIndex}`));
      return false;
    }

    const oldSessionId = this.currentState.sessionId;

    this.currentState = JSON.parse(JSON.stringify(snapshot.state)); // Deep clone

    console.error(chalk.green(`✅ State restored from snapshot (${snapshot.timestamp.toISOString()})`));
    this.emit('stateRestored', oldSessionId, this.currentState.sessionId, snapshot);
    return true;
  }

  private startSnapshotTimer(): void {
    this.snapshotTimer = setInterval(() => {
      this.createSnapshot();
    }, this.config.snapshotInterval);
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      if (this.config.persistState) {
        this.saveState();
      }
    }, 10000); // Auto-save every 10 seconds
  }

  private triggerAutoSave(): void {
    if (this.config.autoSave && this.config.persistState) {
      // Debounced save - only save if no activity for 2 seconds
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
      }
      
      this.autoSaveTimer = setTimeout(() => {
        this.saveState();
      }, 2000);
    }
  }

  public async saveState(): Promise<boolean> {
    try {
      await fs.ensureDir(path.dirname(this.stateFilePath));
      
      const stateData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        state: this.currentState,
        snapshots: this.snapshots.slice(-10) // Save last 10 snapshots
      };
      
      await fs.writeJson(this.stateFilePath, stateData, { spaces: 2 });
      
      console.error(chalk.green(`💾 State saved to ${this.stateFilePath}`));
      this.emit('stateSaved', this.stateFilePath);
      return true;
      
    } catch (error) {
      console.error(chalk.red(`❌ Failed to save state: ${error}`));
      this.emit('stateSaveError', error);
      return false;
    }
  }

  private async loadPersistedState(): Promise<boolean> {
    try {
      if (await fs.pathExists(this.stateFilePath)) {
        const stateData = await fs.readJson(this.stateFilePath);
        
        if (stateData.state) {
          // Merge persisted state with current state, preserving session info
          const persistedState = stateData.state;
          persistedState.sessionId = this.currentState.sessionId; // Keep new session ID
          persistedState.startTime = this.currentState.startTime; // Keep new start time
          
          this.currentState = persistedState;
          
          if (stateData.snapshots) {
            this.snapshots = stateData.snapshots.map((s: any) => ({
              ...s,
              timestamp: new Date(s.timestamp)
            }));
          }
          
          console.error(chalk.green(`📂 State loaded from ${this.stateFilePath}`));
          this.emit('stateLoaded', this.stateFilePath);
          return true;
        }
      }
    } catch (error) {
      console.error(chalk.yellow(`⚠️ Failed to load persisted state: ${error}`));
      this.emit('stateLoadError', error);
    }
    
    return false;
  }

  public getState(): Readonly<ServerState> {
    return JSON.parse(JSON.stringify(this.currentState)); // Return deep clone
  }

  public getSnapshots(): StateSnapshot[] {
    return [...this.snapshots]; // Return copy
  }

  public getStateMetrics() {
    return {
      sessionId: this.currentState.sessionId,
      uptime: Date.now() - this.currentState.startTime.getTime(),
      lastActivity: this.currentState.lastActivity,
      snapshotCount: this.snapshots.length,
      toolCallCount: this.currentState.toolState.toolCallCount,
      errorCount: this.currentState.errorState.errorCount,
      healthScore: this.currentState.healthState.healthScore,
      isConnected: this.currentState.connectionState.isConnected,
      activeOperations: this.currentState.toolState.activeOperations.length
    };
  }

  public destroy(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }
    
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    
    if (this.config.persistState) {
      this.saveState();
    }
    
    this.removeAllListeners();
    console.error(chalk.gray(`🗑️ StateManager destroyed`));
  }
}
