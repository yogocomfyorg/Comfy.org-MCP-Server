import chalk from "chalk";
import { ServerOrchestrator } from "./ServerOrchestrator.js";
/**
 * Wrapper function to execute tool operations with orchestrator error recovery
 */
export async function executeWithOrchestrator(orchestrator, context, executor) {
    if (!orchestrator) {
        // Fallback to direct execution if orchestrator is not available
        console.error(chalk.yellow(`⚠️ Orchestrator not available, executing ${context.toolName}.${context.operation} directly`));
        return await executor();
    }
    try {
        return await orchestrator.executeWithRecovery(context.operation, context.toolName, executor, {
            parameters: context.parameters,
            ...context.metadata
        });
    }
    catch (error) {
        console.error(chalk.red(`❌ Tool execution failed: ${context.toolName}.${context.operation} - ${error}`));
        throw error;
    }
}
/**
 * Helper function to create standardized error responses
 */
export function createErrorResponse(toolName, operation, error, metadata) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorData = {
        tool: toolName,
        operation,
        error: errorMessage,
        timestamp: new Date().toISOString(),
        ...metadata
    };
    return {
        content: [{
                type: "text",
                text: JSON.stringify(errorData, null, 2)
            }],
        isError: true
    };
}
/**
 * Helper function to create standardized success responses
 */
export function createSuccessResponse(data, message) {
    const responseData = {
        success: true,
        timestamp: new Date().toISOString(),
        message: message || "Operation completed successfully",
        data
    };
    return {
        content: [{
                type: "text",
                text: typeof data === 'string' ? data : JSON.stringify(responseData, null, 2)
            }]
    };
}
/**
 * Decorator function to wrap tool handlers with orchestrator integration
 */
export function withOrchestrator(orchestrator, toolName) {
    return function (_target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (!originalMethod) {
            return descriptor;
        }
        descriptor.value = async function (...args) {
            const context = {
                toolName,
                operation: propertyKey,
                parameters: args[0] || {},
                metadata: {
                    methodName: propertyKey,
                    argumentCount: args.length
                }
            };
            return await executeWithOrchestrator(orchestrator(), context, () => originalMethod.apply(this, args));
        };
        return descriptor;
    };
}
/**
 * Utility function to validate tool parameters
 */
export function validateParameters(parameters, requiredFields, toolName, operation) {
    const missing = requiredFields.filter(field => parameters[field] === undefined || parameters[field] === null);
    if (missing.length > 0) {
        throw new Error(`Missing required parameters for ${toolName}.${operation}: ${missing.join(', ')}`);
    }
}
/**
 * Utility function to sanitize parameters for logging
 */
export function sanitizeParameters(parameters) {
    const sensitiveFields = ['password', 'token', 'key', 'secret', 'auth'];
    if (typeof parameters !== 'object' || parameters === null) {
        return parameters;
    }
    const sanitized = { ...parameters };
    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '[REDACTED]';
        }
    }
    return sanitized;
}
/**
 * Utility function to measure execution time
 */
export async function measureExecutionTime(operation) {
    const startTime = Date.now();
    try {
        const result = await operation();
        const duration = Date.now() - startTime;
        return { result, duration };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        console.error(chalk.red(`⏱️ Operation failed after ${duration}ms: ${error}`));
        throw error;
    }
}
/**
 * Utility function to create tool execution metadata
 */
export function createExecutionMetadata(toolName, operation, parameters, duration) {
    return {
        toolName,
        operation,
        parameters: sanitizeParameters(parameters),
        timestamp: new Date().toISOString(),
        duration,
        sessionId: process.env['SESSION_ID'] || 'unknown'
    };
}
/**
 * Helper function to handle common tool patterns
 */
export async function executeToolOperation(orchestrator, toolName, operation, parameters, executor, options = {}) {
    try {
        // Validate required parameters
        if (options.validateRequired) {
            validateParameters(parameters, options.validateRequired, toolName, operation);
        }
        // Log execution if requested
        if (options.logExecution) {
            console.error(chalk.blue(`🔧 Executing ${toolName}.${operation} with parameters:`, sanitizeParameters(parameters)));
        }
        // Create execution context
        const context = {
            toolName,
            operation,
            parameters,
            metadata: createExecutionMetadata(toolName, operation, parameters)
        };
        // Execute with or without time measurement
        let result;
        let duration;
        if (options.measureTime) {
            const measured = await measureExecutionTime(() => executeWithOrchestrator(orchestrator, context, executor));
            result = measured.result;
            duration = measured.duration;
            console.error(chalk.green(`✅ ${toolName}.${operation} completed in ${duration}ms`));
        }
        else {
            result = await executeWithOrchestrator(orchestrator, context, executor);
        }
        // Return standardized success response
        return createSuccessResponse(result);
    }
    catch (error) {
        console.error(chalk.red(`❌ ${toolName}.${operation} failed:`, error));
        return createErrorResponse(toolName, operation, error, { parameters });
    }
}
//# sourceMappingURL=ToolWrapper.js.map