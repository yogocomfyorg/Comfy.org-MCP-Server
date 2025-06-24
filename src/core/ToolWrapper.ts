import chalk from "chalk";
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
    _meta?: { [x: string]: unknown; } | undefined;
  }>;
  _meta?: { [x: string]: unknown; } | undefined;
  structuredContent?: { [x: string]: unknown; } | undefined;
  isError?: boolean;
}

/**
 * Wrapper function to execute tool operations with orchestrator error recovery
 */
export async function executeWithOrchestrator<T>(
  orchestrator: ServerOrchestrator | null,
  context: ToolExecutionContext,
  executor: () => Promise<T>
): Promise<T> {
  if (!orchestrator) {
    // Fallback to direct execution if orchestrator is not available
    console.error(chalk.yellow(`⚠️ Orchestrator not available, executing ${context.toolName}.${context.operation} directly`));
    return await executor();
  }

  try {
    return await orchestrator.executeWithRecovery(
      context.operation,
      context.toolName,
      executor,
      {
        parameters: context.parameters,
        ...context.metadata
      }
    );
  } catch (error) {
    console.error(chalk.red(`❌ Tool execution failed: ${context.toolName}.${context.operation} - ${error}`));
    throw error;
  }
}

/**
 * Helper function to create standardized error responses
 */
export function createErrorResponse(
  toolName: string,
  operation: string,
  error: Error | string,
  metadata?: Record<string, any>
): ToolResult {
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
export function createSuccessResponse(
  data: any,
  message?: string
): ToolResult {
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
export function withOrchestrator(
  orchestrator: () => ServerOrchestrator | null,
  toolName: string
) {
  return function<T extends any[], R>(
    _target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: T) => Promise<R>>
  ) {
    const originalMethod = descriptor.value;
    
    if (!originalMethod) {
      return descriptor;
    }

    descriptor.value = async function(...args: T): Promise<R> {
      const context: ToolExecutionContext = {
        toolName,
        operation: propertyKey,
        parameters: args[0] || {},
        metadata: {
          methodName: propertyKey,
          argumentCount: args.length
        }
      };

      return await executeWithOrchestrator(
        orchestrator(),
        context,
        () => originalMethod.apply(this, args)
      );
    };

    return descriptor;
  };
}

/**
 * Utility function to validate tool parameters
 */
export function validateParameters(
  parameters: any,
  requiredFields: string[],
  toolName: string,
  operation: string
): void {
  const missing = requiredFields.filter(field => 
    parameters[field] === undefined || parameters[field] === null
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required parameters for ${toolName}.${operation}: ${missing.join(', ')}`
    );
  }
}

/**
 * Utility function to sanitize parameters for logging
 */
export function sanitizeParameters(parameters: any): any {
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
export async function measureExecutionTime<T>(
  operation: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const startTime = Date.now();
  
  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    return { result, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(chalk.red(`⏱️ Operation failed after ${duration}ms: ${error}`));
    throw error;
  }
}

/**
 * Utility function to create tool execution metadata
 */
export function createExecutionMetadata(
  toolName: string,
  operation: string,
  parameters: any,
  duration?: number
): Record<string, any> {
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
export async function executeToolOperation<T>(
  orchestrator: ServerOrchestrator | null,
  toolName: string,
  operation: string,
  parameters: any,
  executor: () => Promise<T>,
  options: {
    validateRequired?: string[];
    measureTime?: boolean;
    logExecution?: boolean;
  } = {}
): Promise<ToolResult> {
  try {
    // Validate required parameters
    if (options.validateRequired) {
      validateParameters(parameters, options.validateRequired, toolName, operation);
    }

    // Log execution if requested
    if (options.logExecution) {
      console.error(chalk.blue(`🔧 Executing ${toolName}.${operation} with parameters:`, 
        sanitizeParameters(parameters)));
    }

    // Create execution context
    const context: ToolExecutionContext = {
      toolName,
      operation,
      parameters,
      metadata: createExecutionMetadata(toolName, operation, parameters)
    };

    // Execute with or without time measurement
    let result: T;
    let duration: number | undefined;

    if (options.measureTime) {
      const measured = await measureExecutionTime(() => 
        executeWithOrchestrator(orchestrator, context, executor)
      );
      result = measured.result;
      duration = measured.duration;
      
      console.error(chalk.green(`✅ ${toolName}.${operation} completed in ${duration}ms`));
    } else {
      result = await executeWithOrchestrator(orchestrator, context, executor);
    }

    // Return standardized success response
    return createSuccessResponse(result);

  } catch (error) {
    console.error(chalk.red(`❌ ${toolName}.${operation} failed:`, error));
    return createErrorResponse(toolName, operation, error as Error, { parameters });
  }
}
