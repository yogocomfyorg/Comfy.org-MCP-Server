import { EventEmitter } from "events";
export interface ErrorContext {
    operation: string;
    toolName: string;
    timestamp: Date;
    error: Error;
    severity: 'low' | 'medium' | 'high' | 'critical';
    recoverable: boolean;
    metadata: Record<string, any>;
}
export interface RecoveryStrategy {
    name: string;
    description: string;
    priority: number;
    maxAttempts: number;
    delay: number;
    backoffMultiplier: number;
    maxDelay: number;
    condition: (context: ErrorContext) => boolean;
    execute: (context: ErrorContext, attempt: number) => Promise<boolean>;
}
export interface RecoveryAttempt {
    id: string;
    context: ErrorContext;
    strategy: RecoveryStrategy;
    attempt: number;
    startTime: Date;
    endTime?: Date;
    success: boolean;
    result?: any;
    error?: Error;
}
export interface ErrorRecoveryConfig {
    maxGlobalRetries?: number;
    globalRetryDelay?: number;
    enableGracefulDegradation?: boolean;
    enableCircuitBreaker?: boolean;
    circuitBreakerThreshold?: number;
    circuitBreakerTimeout?: number;
    enableFallbackStrategies?: boolean;
}
export declare class ErrorRecovery extends EventEmitter {
    private config;
    private strategies;
    private recoveryHistory;
    private circuitBreakers;
    private activeRecoveries;
    private readonly maxHistorySize;
    constructor(config?: ErrorRecoveryConfig);
    private registerDefaultStrategies;
    addStrategy(strategy: RecoveryStrategy): void;
    handleError(context: ErrorContext): Promise<boolean>;
    private executeStrategy;
    private isCircuitOpen;
    private recordCircuitBreakerFailure;
    private resetCircuitBreaker;
    private generateAttemptId;
    private addToHistory;
    createErrorContext(operation: string, toolName: string, error: Error, severity?: ErrorContext['severity'], metadata?: Record<string, any>): ErrorContext;
    private isRecoverable;
    getRecoveryHistory(): RecoveryAttempt[];
    getActiveRecoveries(): RecoveryAttempt[];
    getCircuitBreakerStatus(): Record<string, any>;
    getRecoveryMetrics(): {
        totalAttempts: number;
        successfulAttempts: number;
        failedAttempts: number;
        successRate: number;
        strategyCounts: Record<string, number>;
        activeRecoveries: number;
        circuitBreakers: number;
    };
    destroy(): void;
}
//# sourceMappingURL=ErrorRecovery.d.ts.map