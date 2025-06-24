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
export declare class ConnectionManager extends EventEmitter {
    private state;
    private healthCheckTimer;
    private reconnectTimer;
    private config;
    constructor(config?: ConnectionConfig);
    private generateConnectionId;
    connect(connectionHandler: () => Promise<boolean>): Promise<boolean>;
    private onConnectionSuccess;
    private onConnectionFailure;
    private scheduleReconnect;
    disconnect(): void;
    private startHealthCheck;
    private performHealthCheck;
    private handleUnhealthyConnection;
    private stopHealthCheck;
    private stopReconnectTimer;
    getState(): Readonly<ConnectionState>;
    isConnected(): boolean;
    resetReconnectAttempts(): void;
    destroy(): void;
}
//# sourceMappingURL=ConnectionManager.d.ts.map