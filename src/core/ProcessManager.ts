import chalk from "chalk";
import { EventEmitter } from "events";
import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
// import fs from "fs-extra";
// import path from "path";

const execAsync = promisify(exec);

export interface ProcessInfo {
  pid: number;
  name: string;
  commandLine: string;
  status: 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
  startTime: Date | null;
  endTime: Date | null;
  restartCount: number;
  lastError: string | null;
}

export interface ProcessConfig {
  name: string;
  command: string;
  args?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
  killTimeout?: number;
  healthCheckUrl?: string;
  healthCheckInterval?: number;
}

export interface CleanupResult {
  processesKilled: number;
  portsCleared: number;
  resourcesFreed: string[];
  errors: string[];
  success: boolean;
}

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private configs: Map<string, ProcessConfig> = new Map();
  private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    console.error(chalk.blue(`🔧 ProcessManager initialized`));
    
    // Handle process cleanup on exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  public async startProcess(config: ProcessConfig): Promise<boolean> {
    try {
      console.error(chalk.yellow(`🚀 Starting process: ${config.name}`));
      
      // Check if process is already running
      if (this.processes.has(config.name)) {
        const existing = this.processes.get(config.name)!;
        if (existing.status === 'running') {
          console.error(chalk.yellow(`⚠️ Process ${config.name} is already running`));
          return true;
        }
      }

      // Store config
      this.configs.set(config.name, config);

      // Create process info
      const processInfo: ProcessInfo = {
        pid: 0,
        name: config.name,
        commandLine: `${config.command} ${config.args?.join(' ') || ''}`,
        status: 'starting',
        startTime: new Date(),
        endTime: null,
        restartCount: this.processes.get(config.name)?.restartCount || 0,
        lastError: null
      };

      this.processes.set(config.name, processInfo);

      // Start the process
      const childProcess = spawn(config.command, config.args || [], {
        cwd: config.workingDirectory || process.cwd(),
        env: { ...process.env, ...config.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      if (!childProcess.pid) {
        throw new Error('Failed to start process - no PID assigned');
      }

      processInfo.pid = childProcess.pid;
      processInfo.status = 'running';
      this.childProcesses.set(config.name, childProcess);

      console.error(chalk.green(`✅ Process ${config.name} started with PID: ${childProcess.pid}`));

      // Set up process event handlers
      this.setupProcessHandlers(config.name, childProcess);

      // Start health checking if configured
      if (config.healthCheckUrl && config.healthCheckInterval) {
        this.startHealthCheck(config.name);
      }

      this.emit('processStarted', config.name, processInfo);
      return true;

    } catch (error) {
      const processInfo = this.processes.get(config.name);
      if (processInfo) {
        processInfo.status = 'error';
        processInfo.lastError = error instanceof Error ? error.message : String(error);
        processInfo.endTime = new Date();
      }

      console.error(chalk.red(`❌ Failed to start process ${config.name}: ${error}`));
      this.emit('processError', config.name, error);
      return false;
    }
  }

  private setupProcessHandlers(name: string, childProcess: ChildProcess): void {
    const processInfo = this.processes.get(name)!;
    const config = this.configs.get(name)!;

    childProcess.on('exit', (code, signal) => {
      processInfo.status = 'stopped';
      processInfo.endTime = new Date();
      
      console.error(chalk.yellow(`🛑 Process ${name} exited with code: ${code}, signal: ${signal}`));
      
      this.stopHealthCheck(name);
      this.childProcesses.delete(name);
      
      this.emit('processExited', name, code, signal);

      // Handle auto-restart
      if (config.autoRestart && processInfo.restartCount < (config.maxRestarts || 5)) {
        this.scheduleRestart(name);
      }
    });

    childProcess.on('error', (error) => {
      processInfo.status = 'error';
      processInfo.lastError = error.message;
      processInfo.endTime = new Date();
      
      console.error(chalk.red(`❌ Process ${name} error: ${error.message}`));
      this.emit('processError', name, error);
    });

    // Log output for debugging
    childProcess.stdout?.on('data', (data) => {
      this.emit('processOutput', name, 'stdout', data.toString());
    });

    childProcess.stderr?.on('data', (data) => {
      this.emit('processOutput', name, 'stderr', data.toString());
    });
  }

  private scheduleRestart(name: string): void {
    const config = this.configs.get(name)!;
    const processInfo = this.processes.get(name)!;
    const delay = config.restartDelay || 5000;

    console.error(chalk.yellow(`⏳ Scheduling restart for ${name} in ${delay}ms`));

    const timer = setTimeout(async () => {
      processInfo.restartCount++;
      console.error(chalk.blue(`🔄 Restarting process ${name} (attempt ${processInfo.restartCount})`));
      
      await this.startProcess(config);
      this.restartTimers.delete(name);
    }, delay);

    this.restartTimers.set(name, timer);
  }

  public async stopProcess(name: string, force: boolean = false): Promise<boolean> {
    try {
      const processInfo = this.processes.get(name);
      const childProcess = this.childProcesses.get(name);
      const config = this.configs.get(name);

      if (!processInfo || !childProcess) {
        console.error(chalk.yellow(`⚠️ Process ${name} not found or not running`));
        return true;
      }

      console.error(chalk.yellow(`🛑 Stopping process: ${name} (PID: ${processInfo.pid})`));
      
      processInfo.status = 'stopping';
      this.stopHealthCheck(name);

      // Cancel any pending restart
      const restartTimer = this.restartTimers.get(name);
      if (restartTimer) {
        clearTimeout(restartTimer);
        this.restartTimers.delete(name);
      }

      if (force) {
        childProcess.kill('SIGKILL');
      } else {
        childProcess.kill('SIGTERM');
        
        // Force kill after timeout
        const killTimeout = config?.killTimeout || 10000;
        setTimeout(() => {
          if (this.childProcesses.has(name)) {
            console.error(chalk.red(`⚡ Force killing process ${name} after timeout`));
            childProcess.kill('SIGKILL');
          }
        }, killTimeout);
      }

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const checkExit = () => {
          if (!this.childProcesses.has(name)) {
            resolve();
          } else {
            setTimeout(checkExit, 100);
          }
        };
        checkExit();
      });

      console.error(chalk.green(`✅ Process ${name} stopped successfully`));
      this.emit('processStopped', name);
      return true;

    } catch (error) {
      console.error(chalk.red(`❌ Failed to stop process ${name}: ${error}`));
      this.emit('processError', name, error);
      return false;
    }
  }

  public async restartProcess(name: string): Promise<boolean> {
    console.error(chalk.blue(`🔄 Restarting process: ${name}`));
    
    const config = this.configs.get(name);
    if (!config) {
      console.error(chalk.red(`❌ No configuration found for process ${name}`));
      return false;
    }

    // Stop the process first
    await this.stopProcess(name);
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start the process again
    return await this.startProcess(config);
  }

  private startHealthCheck(name: string): void {
    const config = this.configs.get(name)!;
    
    const timer = setInterval(async () => {
      try {
        const response = await fetch(config.healthCheckUrl!, {
          method: 'GET',
          signal: AbortSignal.timeout(3000)
        });
        
        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status}`);
        }
        
        this.emit('healthCheckPassed', name);
      } catch (error) {
        console.error(chalk.red(`💔 Health check failed for ${name}: ${error}`));
        this.emit('healthCheckFailed', name, error);
        
        // Consider restarting if health check fails
        const processInfo = this.processes.get(name);
        if (processInfo && config.autoRestart) {
          console.error(chalk.yellow(`🔄 Health check failed, restarting ${name}`));
          this.restartProcess(name);
        }
      }
    }, config.healthCheckInterval!);

    this.healthCheckTimers.set(name, timer);
  }

  private stopHealthCheck(name: string): void {
    const timer = this.healthCheckTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(name);
    }
  }

  public async killAllComfyUIProcesses(): Promise<CleanupResult> {
    const result: CleanupResult = {
      processesKilled: 0,
      portsCleared: 0,
      resourcesFreed: [],
      errors: [],
      success: false
    };

    try {
      console.error(chalk.yellow(`🧹 Performing comprehensive ComfyUI process cleanup...`));

      // Kill managed processes first
      for (const [name, processInfo] of this.processes) {
        if (name.toLowerCase().includes('comfyui') || processInfo.commandLine.includes('ComfyUI')) {
          await this.stopProcess(name, true);
          result.processesKilled++;
        }
      }

      // Kill any remaining ComfyUI processes
      const killCommands = [
        'taskkill /F /IM python.exe /FI "WINDOWTITLE eq ComfyUI*"',
        'wmic process where "commandline like \'%ComfyUI%\'" delete',
        'wmic process where "commandline like \'%main.py%\'" delete'
      ];

      for (const command of killCommands) {
        try {
          await execAsync(command);
          result.processesKilled++;
        } catch (error) {
          // Ignore errors - processes might not exist
        }
      }

      // Clear ports
      const ports = [8188, 8189, 8190, 7860, 7861, 7862];
      for (const port of ports) {
        try {
          const netstat = await execAsync(`netstat -ano | findstr :${port}`);
          if (netstat.stdout.trim()) {
            const lines = netstat.stdout.trim().split('\n');
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              const pid = parts[parts.length - 1];
              if (pid && pid !== '0') {
                await execAsync(`taskkill /F /PID ${pid}`);
                result.portsCleared++;
              }
            }
          }
        } catch (error) {
          // Port might not be in use
        }
      }

      // Force network reset
      try {
        await execAsync('netsh winsock reset');
        result.resourcesFreed.push('Network stack reset');
      } catch (error) {
        result.errors.push(`Failed to reset network stack: ${error}`);
      }

      result.success = true;
      console.error(chalk.green(`✅ Cleanup completed: ${result.processesKilled} processes killed, ${result.portsCleared} ports cleared`));

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      console.error(chalk.red(`❌ Cleanup failed: ${error}`));
    }

    return result;
  }

  public getProcessInfo(name: string): ProcessInfo | null {
    return this.processes.get(name) || null;
  }

  public getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  public isProcessRunning(name: string): boolean {
    const processInfo = this.processes.get(name);
    return processInfo?.status === 'running';
  }

  private async cleanup(): Promise<void> {
    console.error(chalk.yellow(`🧹 ProcessManager cleanup started...`));
    
    // Stop all health checks
    for (const timer of this.healthCheckTimers.values()) {
      clearInterval(timer);
    }
    this.healthCheckTimers.clear();

    // Cancel all restart timers
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();

    // Stop all managed processes
    const stopPromises = Array.from(this.processes.keys()).map(name => 
      this.stopProcess(name, true)
    );
    
    await Promise.allSettled(stopPromises);
    
    console.error(chalk.green(`✅ ProcessManager cleanup completed`));
  }

  public destroy(): void {
    this.cleanup();
    this.removeAllListeners();
    console.error(chalk.gray(`🗑️ ProcessManager destroyed`));
  }
}
