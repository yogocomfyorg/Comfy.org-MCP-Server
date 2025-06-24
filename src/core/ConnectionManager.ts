import chalk from "chalk";
import { EventEmitter } from "events";

export interface ConnectionState {
  isConnected: boolean;
  lastConnected: Date | null;
  lastDisconnected: Date | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  baseReconnectDelay: number;
  maxReconnectDelay: number;
  connectionId: string;
  healthCheckInterval: number;
  lastHealthCheck: Date | null;
  isHealthy: boolean;
}

export interface ConnectionConfig {
  maxReconnectAttempts?: number;
  baseReconnectDelay?: number;
  maxReconnectDelay?: number;
  healthCheckInterval?: number;
  connectionTimeout?: number;
}

export class ConnectionManager extends EventEmitter {
  private state: ConnectionState;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: Required<ConnectionConfig>;

  constructor(config: ConnectionConfig = {}) {
    super();
    
    this.config = {
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      baseReconnectDelay: config.baseReconnectDelay ?? 1000,
      maxReconnectDelay: config.maxReconnectDelay ?? 30000,
      healthCheckInterval: config.healthCheckInterval ?? 5000,
      connectionTimeout: config.connectionTimeout ?? 10000
    };

    this.state = {
      isConnected: false,
      lastConnected: null,
      lastDisconnected: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      reconnectDelay: this.config.baseReconnectDelay,
      baseReconnectDelay: this.config.baseReconnectDelay,
      maxReconnectDelay: this.config.maxReconnectDelay,
      connectionId: this.generateConnectionId(),
      healthCheckInterval: this.config.healthCheckInterval,
      lastHealthCheck: null,
      isHealthy: false
    };

    console.error(chalk.blue(`🔗 ConnectionManager initialized with ID: ${this.state.connectionId}`));
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public async connect(connectionHandler: () => Promise<boolean>): Promise<boolean> {
    try {
      console.error(chalk.yellow(`🔄 Attempting connection (attempt ${this.state.reconnectAttempts + 1}/${this.state.maxReconnectAttempts})`));
      
      const connected = await Promise.race([
        connectionHandler(),
        new Promise<boolean>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout)
        )
      ]);

      if (connected) {
        this.onConnectionSuccess();
        return true;
      } else {
        this.onConnectionFailure(new Error('Connection handler returned false'));
        return false;
      }
    } catch (error) {
      this.onConnectionFailure(error as Error);
      return false;
    }
  }

  private onConnectionSuccess(): void {
    this.state.isConnected = true;
    this.state.lastConnected = new Date();
    this.state.reconnectAttempts = 0;
    this.state.reconnectDelay = this.state.baseReconnectDelay;
    this.state.isHealthy = true;
    this.state.lastHealthCheck = new Date();

    console.error(chalk.green(`✅ Connection established successfully (ID: ${this.state.connectionId})`));
    
    this.emit('connected', this.state.connectionId);
    this.startHealthCheck();
  }

  private onConnectionFailure(error: Error): void {
    this.state.isConnected = false;
    this.state.lastDisconnected = new Date();
    this.state.reconnectAttempts++;
    this.state.isHealthy = false;

    console.error(chalk.red(`❌ Connection failed: ${error.message} (attempt ${this.state.reconnectAttempts}/${this.state.maxReconnectAttempts})`));
    
    this.emit('connectionFailed', error, this.state.reconnectAttempts);
    
    if (this.state.reconnectAttempts < this.state.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      console.error(chalk.red(`💥 Max reconnection attempts reached. Connection abandoned.`));
      this.emit('connectionAbandoned', this.state.reconnectAttempts);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    console.error(chalk.yellow(`⏳ Scheduling reconnection in ${this.state.reconnectDelay}ms`));
    
    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnectAttempt', this.state.reconnectAttempts + 1);
    }, this.state.reconnectDelay);

    // Exponential backoff with jitter
    this.state.reconnectDelay = Math.min(
      this.state.reconnectDelay * 2 + Math.random() * 1000,
      this.state.maxReconnectDelay
    );
  }

  public disconnect(): void {
    this.state.isConnected = false;
    this.state.lastDisconnected = new Date();
    this.state.isHealthy = false;
    
    this.stopHealthCheck();
    this.stopReconnectTimer();
    
    console.error(chalk.yellow(`🔌 Connection disconnected (ID: ${this.state.connectionId})`));
    this.emit('disconnected', this.state.connectionId);
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    
    this.healthCheckTimer = setInterval(async () => {
      try {
        const isHealthy = await this.performHealthCheck();
        this.state.lastHealthCheck = new Date();
        
        if (isHealthy !== this.state.isHealthy) {
          this.state.isHealthy = isHealthy;
          this.emit('healthChanged', isHealthy);
          
          if (!isHealthy) {
            console.error(chalk.red(`💔 Health check failed - connection unhealthy`));
            this.handleUnhealthyConnection();
          } else {
            console.error(chalk.green(`💚 Health check passed - connection restored`));
          }
        }
      } catch (error) {
        console.error(chalk.red(`❌ Health check error: ${error}`));
        this.state.isHealthy = false;
        this.emit('healthCheckError', error);
      }
    }, this.state.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<boolean> {
    try {
      // Try to make a simple request to ComfyUI server
      const response = await fetch('http://127.0.0.1:8188/queue', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private handleUnhealthyConnection(): void {
    if (this.state.isConnected) {
      console.error(chalk.yellow(`🔄 Connection unhealthy, triggering reconnection...`));
      this.disconnect();
      this.emit('reconnectRequired');
    }
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public getState(): Readonly<ConnectionState> {
    return { ...this.state };
  }

  public isConnected(): boolean {
    return this.state.isConnected && this.state.isHealthy;
  }

  public resetReconnectAttempts(): void {
    this.state.reconnectAttempts = 0;
    this.state.reconnectDelay = this.state.baseReconnectDelay;
    console.error(chalk.blue(`🔄 Reconnection attempts reset`));
  }

  public destroy(): void {
    this.stopHealthCheck();
    this.stopReconnectTimer();
    this.removeAllListeners();
    console.error(chalk.gray(`🗑️ ConnectionManager destroyed (ID: ${this.state.connectionId})`));
  }
}
