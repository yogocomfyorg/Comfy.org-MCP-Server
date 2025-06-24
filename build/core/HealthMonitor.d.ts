import { EventEmitter } from "events";
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
    healthScore: number;
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
export declare class HealthMonitor extends EventEmitter {
    private config;
    private monitorTimer;
    private isMonitoring;
    private consecutiveFailures;
    private lastHealthMetrics;
    private healthHistory;
    private readonly maxHistorySize;
    constructor(config?: HealthMonitorConfig);
    startMonitoring(): void;
    stopMonitoring(): void;
    private performHealthCheck;
    private collectHealthMetrics;
    private checkComfyUIHealth;
    private checkMCPServerHealth;
    private checkSystemHealth;
    private checkProcessHealth;
    private checkPortStatus;
    private getEmptySystemHealth;
    private getEmptyProcessHealth;
    private calculateHealthScore;
    private determineOverallHealth;
    private analyzeHealthStatus;
    getLastMetrics(): HealthMetrics | null;
    getHealthHistory(): HealthMetrics[];
    isHealthy(): boolean;
    getHealthScore(): number;
    destroy(): void;
}
//# sourceMappingURL=HealthMonitor.d.ts.map