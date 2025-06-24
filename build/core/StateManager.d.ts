import { EventEmitter } from "events";
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
export declare class StateManager extends EventEmitter {
    private currentState;
    private config;
    private snapshots;
    private snapshotTimer;
    private autoSaveTimer;
    private stateFilePath;
    constructor(config?: StateManagerConfig);
    private createInitialState;
    private generateSessionId;
    updateConnectionState(updates: Partial<ServerState['connectionState']>): void;
    updateProcessState(updates: Partial<ServerState['processState']>): void;
    updateHealthState(updates: Partial<ServerState['healthState']>): void;
    updateToolState(updates: Partial<ServerState['toolState']>): void;
    updateErrorState(updates: Partial<ServerState['errorState']>): void;
    updateConfiguration(updates: Partial<ServerState['configuration']>): void;
    recordToolCall(toolName: string, success: boolean): void;
    addActiveOperation(operationId: string): void;
    removeActiveOperation(operationId: string): void;
    recordError(error: Error, isCritical?: boolean): void;
    recordRecoveryAttempt(): void;
    resetState(preserveConfiguration?: boolean): void;
    createSnapshot(): StateSnapshot;
    private calculateChecksum;
    restoreFromSnapshot(snapshotIndex: number): boolean;
    private startSnapshotTimer;
    private startAutoSave;
    private triggerAutoSave;
    saveState(): Promise<boolean>;
    private loadPersistedState;
    getState(): Readonly<ServerState>;
    getSnapshots(): StateSnapshot[];
    getStateMetrics(): {
        sessionId: string;
        uptime: number;
        lastActivity: Date;
        snapshotCount: number;
        toolCallCount: number;
        errorCount: number;
        healthScore: number;
        isConnected: boolean;
        activeOperations: number;
    };
    destroy(): void;
}
//# sourceMappingURL=StateManager.d.ts.map