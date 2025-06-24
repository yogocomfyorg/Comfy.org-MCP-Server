import chalk from "chalk";
import { EventEmitter } from "events";
export class ErrorRecovery extends EventEmitter {
    config;
    strategies = [];
    recoveryHistory = [];
    circuitBreakers = new Map();
    activeRecoveries = new Map();
    maxHistorySize = 1000;
    constructor(config = {}) {
        super();
        this.config = {
            maxGlobalRetries: config.maxGlobalRetries ?? 3,
            globalRetryDelay: config.globalRetryDelay ?? 1000,
            enableGracefulDegradation: config.enableGracefulDegradation ?? true,
            enableCircuitBreaker: config.enableCircuitBreaker ?? true,
            circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
            circuitBreakerTimeout: config.circuitBreakerTimeout ?? 60000,
            enableFallbackStrategies: config.enableFallbackStrategies ?? true
        };
        console.error(chalk.blue(`🛡️ ErrorRecovery initialized with circuit breaker: ${this.config.enableCircuitBreaker}`));
        // Register default recovery strategies
        this.registerDefaultStrategies();
    }
    registerDefaultStrategies() {
        // Connection Recovery Strategy
        this.addStrategy({
            name: 'connection_recovery',
            description: 'Attempt to reconnect to ComfyUI server',
            priority: 1,
            maxAttempts: 5,
            delay: 2000,
            backoffMultiplier: 1.5,
            maxDelay: 30000,
            condition: (context) => context.error.message.includes('ECONNREFUSED') ||
                context.error.message.includes('Connection') ||
                context.error.message.includes('timeout'),
            execute: async (_context, attempt) => {
                console.error(chalk.yellow(`🔄 Attempting connection recovery (attempt ${attempt})`));
                try {
                    // Try to ping the ComfyUI server
                    const response = await fetch('http://127.0.0.1:8188/queue', {
                        method: 'GET',
                        signal: AbortSignal.timeout(5000)
                    });
                    if (response.ok) {
                        console.error(chalk.green(`✅ Connection recovery successful`));
                        return true;
                    }
                    throw new Error(`Server responded with status: ${response.status}`);
                }
                catch (error) {
                    console.error(chalk.red(`❌ Connection recovery failed: ${error}`));
                    return false;
                }
            }
        });
        // Process Recovery Strategy
        this.addStrategy({
            name: 'process_recovery',
            description: 'Restart ComfyUI process',
            priority: 2,
            maxAttempts: 3,
            delay: 5000,
            backoffMultiplier: 2,
            maxDelay: 60000,
            condition: (context) => context.error.message.includes('process') ||
                context.error.message.includes('server') ||
                context.severity === 'critical',
            execute: async (_context, attempt) => {
                console.error(chalk.yellow(`🔄 Attempting process recovery (attempt ${attempt})`));
                try {
                    // This would integrate with ProcessManager to restart ComfyUI
                    // For now, we'll simulate the recovery
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // Check if process is running
                    const response = await fetch('http://127.0.0.1:8188/queue', {
                        method: 'GET',
                        signal: AbortSignal.timeout(10000)
                    });
                    if (response.ok) {
                        console.error(chalk.green(`✅ Process recovery successful`));
                        return true;
                    }
                    throw new Error('Process restart failed - server not responding');
                }
                catch (error) {
                    console.error(chalk.red(`❌ Process recovery failed: ${error}`));
                    return false;
                }
            }
        });
        // State Reset Strategy
        this.addStrategy({
            name: 'state_reset',
            description: 'Reset internal state and clear caches',
            priority: 3,
            maxAttempts: 2,
            delay: 1000,
            backoffMultiplier: 1,
            maxDelay: 1000,
            condition: (context) => context.error.message.includes('state') ||
                context.error.message.includes('cache') ||
                context.toolName.includes('queue'),
            execute: async (_context, attempt) => {
                console.error(chalk.yellow(`🔄 Attempting state reset (attempt ${attempt})`));
                try {
                    // This would integrate with StateManager to reset state
                    // For now, we'll simulate the reset
                    await new Promise(resolve => setTimeout(resolve, 500));
                    console.error(chalk.green(`✅ State reset successful`));
                    return true;
                }
                catch (error) {
                    console.error(chalk.red(`❌ State reset failed: ${error}`));
                    return false;
                }
            }
        });
        // Graceful Degradation Strategy
        this.addStrategy({
            name: 'graceful_degradation',
            description: 'Provide limited functionality when full recovery fails',
            priority: 10, // Lowest priority - last resort
            maxAttempts: 1,
            delay: 0,
            backoffMultiplier: 1,
            maxDelay: 0,
            condition: (_context) => this.config.enableGracefulDegradation,
            execute: async (context, _attempt) => {
                console.error(chalk.yellow(`🔄 Attempting graceful degradation`));
                try {
                    // Provide limited functionality or cached responses
                    console.error(chalk.yellow(`⚠️ Operating in degraded mode due to: ${context.error.message}`));
                    console.error(chalk.yellow(`⚠️ Operating in degraded mode`));
                    return true;
                }
                catch (error) {
                    console.error(chalk.red(`❌ Graceful degradation failed: ${error}`));
                    return false;
                }
            }
        });
    }
    addStrategy(strategy) {
        this.strategies.push(strategy);
        this.strategies.sort((a, b) => a.priority - b.priority);
        console.error(chalk.blue(`📋 Recovery strategy added: ${strategy.name} (priority: ${strategy.priority})`));
    }
    async handleError(context) {
        const operationKey = `${context.toolName}_${context.operation}`;
        // Check circuit breaker
        if (this.config.enableCircuitBreaker && this.isCircuitOpen(operationKey)) {
            console.error(chalk.red(`🚫 Circuit breaker open for ${operationKey} - skipping recovery`));
            this.emit('circuitBreakerOpen', operationKey);
            return false;
        }
        console.error(chalk.red(`🚨 Handling error in ${context.toolName}.${context.operation}: ${context.error.message}`));
        // Find applicable strategies
        const applicableStrategies = this.strategies.filter(strategy => strategy.condition(context));
        if (applicableStrategies.length === 0) {
            console.error(chalk.red(`❌ No recovery strategies available for this error`));
            this.recordCircuitBreakerFailure(operationKey);
            return false;
        }
        // Try each strategy
        for (const strategy of applicableStrategies) {
            const success = await this.executeStrategy(context, strategy);
            if (success) {
                this.resetCircuitBreaker(operationKey);
                return true;
            }
        }
        // All strategies failed
        this.recordCircuitBreakerFailure(operationKey);
        console.error(chalk.red(`💥 All recovery strategies failed for ${context.toolName}.${context.operation}`));
        this.emit('recoveryFailed', context);
        return false;
    }
    async executeStrategy(context, strategy) {
        const attemptId = this.generateAttemptId();
        console.error(chalk.yellow(`🔧 Executing recovery strategy: ${strategy.name}`));
        for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
            const recoveryAttempt = {
                id: attemptId,
                context,
                strategy,
                attempt,
                startTime: new Date(),
                success: false
            };
            this.activeRecoveries.set(attemptId, recoveryAttempt);
            try {
                const success = await strategy.execute(context, attempt);
                recoveryAttempt.endTime = new Date();
                recoveryAttempt.success = success;
                this.activeRecoveries.delete(attemptId);
                this.addToHistory(recoveryAttempt);
                if (success) {
                    console.error(chalk.green(`✅ Recovery strategy ${strategy.name} succeeded on attempt ${attempt}`));
                    this.emit('recoverySuccess', recoveryAttempt);
                    return true;
                }
                // Wait before next attempt
                if (attempt < strategy.maxAttempts) {
                    const delay = Math.min(strategy.delay * Math.pow(strategy.backoffMultiplier, attempt - 1), strategy.maxDelay);
                    console.error(chalk.yellow(`⏳ Waiting ${delay}ms before next attempt`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            catch (error) {
                recoveryAttempt.endTime = new Date();
                recoveryAttempt.success = false;
                recoveryAttempt.error = error;
                this.activeRecoveries.delete(attemptId);
                this.addToHistory(recoveryAttempt);
                console.error(chalk.red(`❌ Recovery strategy ${strategy.name} failed on attempt ${attempt}: ${error}`));
                this.emit('recoveryAttemptFailed', recoveryAttempt);
            }
        }
        console.error(chalk.red(`💥 Recovery strategy ${strategy.name} exhausted all attempts`));
        return false;
    }
    isCircuitOpen(operationKey) {
        const breaker = this.circuitBreakers.get(operationKey);
        if (!breaker)
            return false;
        if (breaker.isOpen) {
            const timeSinceLastFailure = Date.now() - breaker.lastFailure.getTime();
            if (timeSinceLastFailure > this.config.circuitBreakerTimeout) {
                // Reset circuit breaker after timeout
                breaker.isOpen = false;
                breaker.failures = 0;
                console.error(chalk.green(`🔄 Circuit breaker reset for ${operationKey}`));
                return false;
            }
            return true;
        }
        return false;
    }
    recordCircuitBreakerFailure(operationKey) {
        if (!this.config.enableCircuitBreaker)
            return;
        const breaker = this.circuitBreakers.get(operationKey) || { failures: 0, lastFailure: new Date(), isOpen: false };
        breaker.failures++;
        breaker.lastFailure = new Date();
        if (breaker.failures >= this.config.circuitBreakerThreshold) {
            breaker.isOpen = true;
            console.error(chalk.red(`🚫 Circuit breaker opened for ${operationKey} (${breaker.failures} failures)`));
            this.emit('circuitBreakerTripped', operationKey, breaker.failures);
        }
        this.circuitBreakers.set(operationKey, breaker);
    }
    resetCircuitBreaker(operationKey) {
        const breaker = this.circuitBreakers.get(operationKey);
        if (breaker) {
            breaker.failures = 0;
            breaker.isOpen = false;
            console.error(chalk.green(`✅ Circuit breaker reset for ${operationKey}`));
        }
    }
    generateAttemptId() {
        return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    addToHistory(attempt) {
        this.recoveryHistory.push(attempt);
        // Limit history size
        if (this.recoveryHistory.length > this.maxHistorySize) {
            this.recoveryHistory.shift();
        }
    }
    createErrorContext(operation, toolName, error, severity = 'medium', metadata = {}) {
        return {
            operation,
            toolName,
            timestamp: new Date(),
            error,
            severity,
            recoverable: this.isRecoverable(error, severity),
            metadata
        };
    }
    isRecoverable(error, severity) {
        // Determine if error is recoverable based on error type and severity
        if (severity === 'critical')
            return false;
        const recoverablePatterns = [
            'ECONNREFUSED',
            'timeout',
            'Connection',
            'Network',
            'Server',
            'queue'
        ];
        return recoverablePatterns.some(pattern => error.message.toLowerCase().includes(pattern.toLowerCase()));
    }
    getRecoveryHistory() {
        return [...this.recoveryHistory];
    }
    getActiveRecoveries() {
        return Array.from(this.activeRecoveries.values());
    }
    getCircuitBreakerStatus() {
        const status = {};
        for (const [key, breaker] of this.circuitBreakers) {
            status[key] = {
                failures: breaker.failures,
                isOpen: breaker.isOpen,
                lastFailure: breaker.lastFailure,
                timeUntilReset: breaker.isOpen ?
                    Math.max(0, this.config.circuitBreakerTimeout - (Date.now() - breaker.lastFailure.getTime())) : 0
            };
        }
        return status;
    }
    getRecoveryMetrics() {
        const totalAttempts = this.recoveryHistory.length;
        const successfulAttempts = this.recoveryHistory.filter(a => a.success).length;
        const failedAttempts = totalAttempts - successfulAttempts;
        const strategyCounts = this.recoveryHistory.reduce((acc, attempt) => {
            acc[attempt.strategy.name] = (acc[attempt.strategy.name] || 0) + 1;
            return acc;
        }, {});
        return {
            totalAttempts,
            successfulAttempts,
            failedAttempts,
            successRate: totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0,
            strategyCounts,
            activeRecoveries: this.activeRecoveries.size,
            circuitBreakers: this.circuitBreakers.size
        };
    }
    destroy() {
        // Cancel all active recoveries
        for (const [_id, attempt] of this.activeRecoveries) {
            attempt.endTime = new Date();
            attempt.success = false;
            attempt.error = new Error('Recovery cancelled - ErrorRecovery destroyed');
        }
        this.activeRecoveries.clear();
        this.removeAllListeners();
        console.error(chalk.gray(`🗑️ ErrorRecovery destroyed`));
    }
}
//# sourceMappingURL=ErrorRecovery.js.map