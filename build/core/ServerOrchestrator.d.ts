import { EventEmitter } from "events";
export interface OrchestratorConfig {
    comfyuiUrl?: string;
    sandboxPath?: string;
    autoRestart?: boolean;
    healthMonitoring?: boolean;
    errorRecovery?: boolean;
    stateManagement?: boolean;
    connectionManagement?: boolean;
}
export declare class ServerOrchestrator extends EventEmitter {
    private connectionManager;
    private healthMonitor;
    private processManager;
    private stateManager;
    private errorRecovery;
    private config;
    private isInitialized;
    private isShuttingDown;
    constructor(config?: OrchestratorConfig);
    private initializeComponents;
    private setupComponentInteractions;
    initialize(): Promise<boolean>;
    executeWithRecovery<T>(operation: string, toolName: string, executor: () => Promise<T>, metadata?: Record<string, any>): Promise<T>;
    private handleCriticalFailure;
    private handleProcessFailure;
    private handleProcessError;
    private handleRecoveryFailure;
    private emergencyRestart;
    private emergencyCleanup;
    getStatus(): {
        isInitialized: boolean;
        isShuttingDown: boolean;
        connection: Readonly<import("./ConnectionManager.js").ConnectionState> | undefined;
        health: import("./HealthMonitor.js").HealthMetrics | null | undefined;
        processes: import("./ProcessManager.js").ProcessInfo[];
        state: {
            sessionId: string;
            uptime: number;
            lastActivity: Date;
            snapshotCount: number;
            toolCallCount: number;
            errorCount: number;
            healthScore: number;
            isConnected: boolean;
            activeOperations: number;
        } | undefined;
        recovery: {
            totalAttempts: number;
            successfulAttempts: number;
            failedAttempts: number;
            successRate: number;
            strategyCounts: Record<string, number>;
            activeRecoveries: number;
            circuitBreakers: number;
        } | undefined;
        circuitBreakers: Record<string, any> | undefined;
    };
    shutdown(): Promise<void>;
}
//# sourceMappingURL=ServerOrchestrator.d.ts.map