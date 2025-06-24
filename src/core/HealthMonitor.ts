import chalk from "chalk";
import { EventEmitter } from "events";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface HealthMetrics {
  timestamp: Date;
  comfyuiServerHealth: {
    isRunning: boolean;
    responseTime: number | null;
    queueSize: number | null;
    isProcessing: boolean;
    lastError: string | null;
  };
  mcpServerHealth: {
    isResponsive: boolean;
    memoryUsage: NodeJS.MemoryUsage | null;
    uptime: number;
    lastError: string | null;
  };
  systemHealth: {
    availableMemory: number | null;
    cpuUsage: number | null;
    diskSpace: number | null;
    networkConnectivity: boolean;
  };
  processHealth: {
    comfyuiProcesses: ProcessInfo[];
    zombieProcesses: ProcessInfo[];
    portStatus: PortStatus[];
  };
  overallHealth: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
  healthScore: number; // 0-100
}

export interface ProcessInfo {
  pid: number;
  name: string;
  commandLine: string;
  memoryUsage: number;
  cpuUsage: number;
  status: string;
}

export interface PortStatus {
  port: number;
  isOpen: boolean;
  processId: number | null;
  processName: string | null;
}

export interface HealthMonitorConfig {
  checkInterval?: number;
  comfyuiUrl?: string;
  healthThreshold?: number;
  criticalThreshold?: number;
  maxConsecutiveFailures?: number;
  enableSystemMetrics?: boolean;
  enableProcessMonitoring?: boolean;
}

export class HealthMonitor extends EventEmitter {
  private config: Required<HealthMonitorConfig>;
  private monitorTimer: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private consecutiveFailures: number = 0;
  private lastHealthMetrics: HealthMetrics | null = null;
  private healthHistory: HealthMetrics[] = [];
  private readonly maxHistorySize = 100;

  constructor(config: HealthMonitorConfig = {}) {
    super();
    
    this.config = {
      checkInterval: config.checkInterval ?? 5000,
      comfyuiUrl: config.comfyuiUrl ?? 'http://127.0.0.1:8188',
      healthThreshold: config.healthThreshold ?? 70,
      criticalThreshold: config.criticalThreshold ?? 30,
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
      enableSystemMetrics: config.enableSystemMetrics ?? true,
      enableProcessMonitoring: config.enableProcessMonitoring ?? true
    };

    console.error(chalk.blue(`💚 HealthMonitor initialized with ${this.config.checkInterval}ms interval`));
  }

  public startMonitoring(): void {
    if (this.isMonitoring) {
      console.error(chalk.yellow(`⚠️ Health monitoring already running`));
      return;
    }

    this.isMonitoring = true;
    console.error(chalk.green(`🚀 Starting health monitoring...`));
    
    // Perform initial health check
    this.performHealthCheck();
    
    // Schedule regular health checks
    this.monitorTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.checkInterval);

    this.emit('monitoringStarted');
  }

  public stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    console.error(chalk.yellow(`🛑 Health monitoring stopped`));
    this.emit('monitoringStopped');
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const metrics = await this.collectHealthMetrics();
      this.lastHealthMetrics = metrics;
      
      // Add to history
      this.healthHistory.push(metrics);
      if (this.healthHistory.length > this.maxHistorySize) {
        this.healthHistory.shift();
      }

      // Analyze health status
      this.analyzeHealthStatus(metrics);
      
      this.emit('healthCheck', metrics);
      
    } catch (error) {
      console.error(chalk.red(`❌ Health check failed: ${error}`));
      this.consecutiveFailures++;
      this.emit('healthCheckError', error, this.consecutiveFailures);
      
      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        this.emit('criticalFailure', this.consecutiveFailures);
      }
    }
  }

  private async collectHealthMetrics(): Promise<HealthMetrics> {
    const timestamp = new Date();
    
    // Collect ComfyUI server health
    const comfyuiHealth = await this.checkComfyUIHealth();
    
    // Collect MCP server health
    const mcpHealth = this.checkMCPServerHealth();
    
    // Collect system health
    const systemHealth = this.config.enableSystemMetrics 
      ? await this.checkSystemHealth() 
      : this.getEmptySystemHealth();
    
    // Collect process health
    const processHealth = this.config.enableProcessMonitoring 
      ? await this.checkProcessHealth() 
      : this.getEmptyProcessHealth();

    // Calculate overall health
    const healthScore = this.calculateHealthScore(comfyuiHealth, mcpHealth, systemHealth, processHealth);
    const overallHealth = this.determineOverallHealth(healthScore);

    return {
      timestamp,
      comfyuiServerHealth: comfyuiHealth,
      mcpServerHealth: mcpHealth,
      systemHealth,
      processHealth,
      overallHealth,
      healthScore
    };
  }

  private async checkComfyUIHealth() {
    try {
      const startTime = Date.now();
      const response = await fetch(`${this.config.comfyuiUrl}/queue`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        const queueData = await response.json();
        return {
          isRunning: true,
          responseTime,
          queueSize: (queueData.queue_pending?.length || 0) + (queueData.queue_running?.length || 0),
          isProcessing: (queueData.queue_running?.length || 0) > 0,
          lastError: null
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      return {
        isRunning: false,
        responseTime: null,
        queueSize: null,
        isProcessing: false,
        lastError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private checkMCPServerHealth() {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    return {
      isResponsive: true, // If we're executing this, we're responsive
      memoryUsage,
      uptime,
      lastError: null
    };
  }

  private async checkSystemHealth() {
    try {
      // Get memory info
      const memInfo = await execAsync('wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /value');
      const memLines = memInfo.stdout.split('\n').filter(line => line.includes('='));
      const memData: Record<string, number> = {};
      memLines.forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
          memData[key.trim()] = parseInt(value.trim()) * 1024; // Convert KB to bytes
        }
      });

      // Simple network connectivity check
      const networkCheck = await fetch('http://127.0.0.1:8188', {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000)
      }).then(() => true).catch(() => false);

      return {
        availableMemory: memData['FreePhysicalMemory'] || null,
        cpuUsage: null, // Would need more complex implementation
        diskSpace: null, // Would need more complex implementation
        networkConnectivity: networkCheck
      };
    } catch (error) {
      return this.getEmptySystemHealth();
    }
  }

  private async checkProcessHealth() {
    try {
      // Check for ComfyUI processes
      const processInfo = await execAsync('wmic process where "commandline like \'%ComfyUI%\' or name like \'%python%\'" get ProcessId,Name,CommandLine,WorkingSetSize /format:csv');
      
      const processes: ProcessInfo[] = [];
      const lines = processInfo.stdout.split('\n').slice(1); // Skip header
      
      for (const line of lines) {
        if (line.trim()) {
          const parts = line.split(',');
          if (parts.length >= 4) {
            processes.push({
              pid: parseInt(parts[3] || '0') || 0,
              name: parts[1] || '',
              commandLine: parts[0] || '',
              memoryUsage: parseInt(parts[4] || '0') || 0,
              cpuUsage: 0, // Would need more complex implementation
              status: 'running'
            });
          }
        }
      }

      // Check port status
      const portStatus = await this.checkPortStatus([8188, 8189, 8190]);

      return {
        comfyuiProcesses: processes.filter(p => p.commandLine.includes('ComfyUI')),
        zombieProcesses: [], // Would need more complex detection
        portStatus
      };
    } catch (error) {
      return this.getEmptyProcessHealth();
    }
  }

  private async checkPortStatus(ports: number[]): Promise<PortStatus[]> {
    const results: PortStatus[] = [];
    
    for (const port of ports) {
      try {
        const netstat = await execAsync(`netstat -ano | findstr :${port}`);
        const isOpen = netstat.stdout.trim().length > 0;
        
        let processId: number | null = null;
        let processName: string | null = null;
        
        if (isOpen) {
          const lines = netstat.stdout.trim().split('\n');
          if (lines.length > 0 && lines[0]) {
            const parts = lines[0].trim().split(/\s+/);
            processId = parseInt(parts[parts.length - 1] || '0') || null;
          }
        }
        
        results.push({
          port,
          isOpen,
          processId,
          processName
        });
      } catch {
        results.push({
          port,
          isOpen: false,
          processId: null,
          processName: null
        });
      }
    }
    
    return results;
  }

  private getEmptySystemHealth() {
    return {
      availableMemory: null,
      cpuUsage: null,
      diskSpace: null,
      networkConnectivity: false
    };
  }

  private getEmptyProcessHealth() {
    return {
      comfyuiProcesses: [],
      zombieProcesses: [],
      portStatus: []
    };
  }

  private calculateHealthScore(comfyui: any, mcp: any, system: any, process: any): number {
    let score = 0;
    let maxScore = 0;

    // ComfyUI health (40% weight)
    maxScore += 40;
    if (comfyui.isRunning) score += 30;
    if (comfyui.responseTime && comfyui.responseTime < 1000) score += 10;

    // MCP health (30% weight)
    maxScore += 30;
    if (mcp.isResponsive) score += 20;
    if (mcp.memoryUsage && mcp.memoryUsage.heapUsed < 100 * 1024 * 1024) score += 10; // < 100MB

    // System health (20% weight)
    maxScore += 20;
    if (system.networkConnectivity) score += 10;
    if (system.availableMemory && system.availableMemory > 1024 * 1024 * 1024) score += 10; // > 1GB

    // Process health (10% weight)
    maxScore += 10;
    if (process.comfyuiProcesses.length > 0) score += 5;
    if (process.portStatus.some((p: PortStatus) => p.port === 8188 && p.isOpen)) score += 5;

    return Math.round((score / maxScore) * 100);
  }

  private determineOverallHealth(score: number): 'healthy' | 'degraded' | 'unhealthy' | 'critical' {
    if (score >= this.config.healthThreshold) return 'healthy';
    if (score >= this.config.criticalThreshold) return 'degraded';
    if (score > 0) return 'unhealthy';
    return 'critical';
  }

  private analyzeHealthStatus(metrics: HealthMetrics): void {
    const prevHealth = this.lastHealthMetrics?.overallHealth;
    const currentHealth = metrics.overallHealth;

    if (prevHealth !== currentHealth) {
      console.error(chalk.blue(`🔄 Health status changed: ${prevHealth} → ${currentHealth} (score: ${metrics.healthScore})`));
      this.emit('healthStatusChanged', currentHealth, prevHealth, metrics);
    }

    if (currentHealth === 'healthy') {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
    }

    // Emit specific health events
    if (currentHealth === 'critical') {
      this.emit('criticalHealth', metrics);
    } else if (currentHealth === 'unhealthy') {
      this.emit('unhealthyStatus', metrics);
    } else if (currentHealth === 'degraded') {
      this.emit('degradedPerformance', metrics);
    }
  }

  public getLastMetrics(): HealthMetrics | null {
    return this.lastHealthMetrics;
  }

  public getHealthHistory(): HealthMetrics[] {
    return [...this.healthHistory];
  }

  public isHealthy(): boolean {
    return this.lastHealthMetrics?.overallHealth === 'healthy';
  }

  public getHealthScore(): number {
    return this.lastHealthMetrics?.healthScore || 0;
  }

  public destroy(): void {
    this.stopMonitoring();
    this.removeAllListeners();
    console.error(chalk.gray(`🗑️ HealthMonitor destroyed`));
  }
}
