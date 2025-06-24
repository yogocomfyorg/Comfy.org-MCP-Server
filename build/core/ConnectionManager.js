import chalk from "chalk";
import { EventEmitter } from "events";
export class ConnectionManager extends EventEmitter {
    state;
    healthCheckTimer = null;
    reconnectTimer = null;
    config;
    constructor(config = {}) {
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
    generateConnectionId() {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    async connect(connectionHandler) {
        try {
            console.error(chalk.yellow(`🔄 Attempting connection (attempt ${this.state.reconnectAttempts + 1}/${this.state.maxReconnectAttempts})`));
            const connected = await Promise.race([
                connectionHandler(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout))
            ]);
            if (connected) {
                this.onConnectionSuccess();
                return true;
            }
            else {
                this.onConnectionFailure(new Error('Connection handler returned false'));
                return false;
            }
        }
        catch (error) {
            this.onConnectionFailure(error);
            return false;
        }
    }
    onConnectionSuccess() {
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
    onConnectionFailure(error) {
        this.state.isConnected = false;
        this.state.lastDisconnected = new Date();
        this.state.reconnectAttempts++;
        this.state.isHealthy = false;
        console.error(chalk.red(`❌ Connection failed: ${error.message} (attempt ${this.state.reconnectAttempts}/${this.state.maxReconnectAttempts})`));
        this.emit('connectionFailed', error, this.state.reconnectAttempts);
        if (this.state.reconnectAttempts < this.state.maxReconnectAttempts) {
            this.scheduleReconnect();
        }
        else {
            console.error(chalk.red(`💥 Max reconnection attempts reached. Connection abandoned.`));
            this.emit('connectionAbandoned', this.state.reconnectAttempts);
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        console.error(chalk.yellow(`⏳ Scheduling reconnection in ${this.state.reconnectDelay}ms`));
        this.reconnectTimer = setTimeout(() => {
            this.emit('reconnectAttempt', this.state.reconnectAttempts + 1);
        }, this.state.reconnectDelay);
        // Exponential backoff with jitter
        this.state.reconnectDelay = Math.min(this.state.reconnectDelay * 2 + Math.random() * 1000, this.state.maxReconnectDelay);
    }
    disconnect() {
        this.state.isConnected = false;
        this.state.lastDisconnected = new Date();
        this.state.isHealthy = false;
        this.stopHealthCheck();
        this.stopReconnectTimer();
        console.error(chalk.yellow(`🔌 Connection disconnected (ID: ${this.state.connectionId})`));
        this.emit('disconnected', this.state.connectionId);
    }
    startHealthCheck() {
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
                    }
                    else {
                        console.error(chalk.green(`💚 Health check passed - connection restored`));
                    }
                }
            }
            catch (error) {
                console.error(chalk.red(`❌ Health check error: ${error}`));
                this.state.isHealthy = false;
                this.emit('healthCheckError', error);
            }
        }, this.state.healthCheckInterval);
    }
    async performHealthCheck() {
        try {
            // Try to make a simple request to ComfyUI server
            const response = await fetch('http://127.0.0.1:8188/queue', {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    handleUnhealthyConnection() {
        if (this.state.isConnected) {
            console.error(chalk.yellow(`🔄 Connection unhealthy, triggering reconnection...`));
            this.disconnect();
            this.emit('reconnectRequired');
        }
    }
    stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }
    stopReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    getState() {
        return { ...this.state };
    }
    isConnected() {
        return this.state.isConnected && this.state.isHealthy;
    }
    resetReconnectAttempts() {
        this.state.reconnectAttempts = 0;
        this.state.reconnectDelay = this.state.baseReconnectDelay;
        console.error(chalk.blue(`🔄 Reconnection attempts reset`));
    }
    destroy() {
        this.stopHealthCheck();
        this.stopReconnectTimer();
        this.removeAllListeners();
        console.error(chalk.gray(`🗑️ ConnectionManager destroyed (ID: ${this.state.connectionId})`));
    }
}
//# sourceMappingURL=ConnectionManager.js.map