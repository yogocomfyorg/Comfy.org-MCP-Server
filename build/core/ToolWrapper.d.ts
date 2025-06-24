import { ServerOrchestrator } from "./ServerOrchestrator.js";
export interface ToolExecutionContext {
    toolName: string;
    operation: string;
    parameters: any;
    metadata?: Record<string, any>;
}
export interface ToolResult {
    [x: string]: unknown;
    content: Array<{
        type: "text";
        text: string;
        _meta?: {
            [x: string]: unknown;
        } | undefined;
    }>;
    _meta?: {
        [x: string]: unknown;
    } | undefined;
    structuredContent?: {
        [x: string]: unknown;
    } | undefined;
    isError?: boolean;
}
/**
 * Wrapper function to execute tool operations with orchestrator error recovery
 */
export declare function executeWithOrchestrator<T>(orchestrator: ServerOrchestrator | null, context: ToolExecutionContext, executor: () => Promise<T>): Promise<T>;
/**
 * Helper function to create standardized error responses
 */
export declare function createErrorResponse(toolName: string, operation: string, error: Error | string, metadata?: Record<string, any>): ToolResult;
/**
 * Helper function to create standardized success responses
 */
export declare function createSuccessResponse(data: any, message?: string): ToolResult;
/**
 * Decorator function to wrap tool handlers with orchestrator integration
 */
export declare function withOrchestrator(orchestrator: () => ServerOrchestrator | null, toolName: string): <T extends any[], R>(_target: any, propertyKey: string, descriptor: TypedPropertyDescriptor<(...args: T) => Promise<R>>) => TypedPropertyDescriptor<(...args: T) => Promise<R>>;
/**
 * Utility function to validate tool parameters
 */
export declare function validateParameters(parameters: any, requiredFields: string[], toolName: string, operation: string): void;
/**
 * Utility function to sanitize parameters for logging
 */
export declare function sanitizeParameters(parameters: any): any;
/**
 * Utility function to measure execution time
 */
export declare function measureExecutionTime<T>(operation: () => Promise<T>): Promise<{
    result: T;
    duration: number;
}>;
/**
 * Utility function to create tool execution metadata
 */
export declare function createExecutionMetadata(toolName: string, operation: string, parameters: any, duration?: number): Record<string, any>;
/**
 * Helper function to handle common tool patterns
 */
export declare function executeToolOperation<T>(orchestrator: ServerOrchestrator | null, toolName: string, operation: string, parameters: any, executor: () => Promise<T>, options?: {
    validateRequired?: string[];
    measureTime?: boolean;
    logExecution?: boolean;
}): Promise<ToolResult>;
//# sourceMappingURL=ToolWrapper.d.ts.map