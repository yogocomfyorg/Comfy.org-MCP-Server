import { EventEmitter } from "events";
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
export declare class ProcessManager extends EventEmitter {
    private processes;
    private childProcesses;
    private configs;
    private healthCheckTimers;
    private restartTimers;
    constructor();
    startProcess(config: ProcessConfig): Promise<boolean>;
    private setupProcessHandlers;
    private scheduleRestart;
    stopProcess(name: string, force?: boolean): Promise<boolean>;
    restartProcess(name: string): Promise<boolean>;
    private startHealthCheck;
    private stopHealthCheck;
    killAllComfyUIProcesses(): Promise<CleanupResult>;
    getProcessInfo(name: string): ProcessInfo | null;
    getAllProcesses(): ProcessInfo[];
    isProcessRunning(name: string): boolean;
    private cleanup;
    destroy(): void;
}
//# sourceMappingURL=ProcessManager.d.ts.map