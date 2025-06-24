import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { makeComfyUIRequest } from './comfyuiApi.js';
import { v4 as uuidv4 } from "uuid";

// Types for workflow orchestration
interface WorkflowStep {
  id: string;
  name: string;
  workflowFile: string;
  parameters?: Record<string, any> | undefined;
  dependencies?: string[] | undefined;
  condition?: string | undefined;
  retryCount: number;
  timeout?: number | undefined;
  onSuccess?: string[] | undefined;
  onFailure?: string[] | undefined;
}

interface WorkflowChain {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  globalParameters?: Record<string, any> | undefined;
  maxConcurrency: number;
  failureStrategy: 'stop' | 'continue' | 'retry';
  created: Date;
  lastExecuted?: Date | undefined;
}

interface ExecutionContext {
  chainId: string;
  executionId: string;
  currentStep: number;
  stepResults: Record<string, any>;
  globalVariables: Record<string, any>;
  startTime: Date;
  status: 'running' | 'completed' | 'failed' | 'paused';
}

// In-memory storage for workflow chains and executions
const workflowChains = new Map<string, WorkflowChain>();
const activeExecutions = new Map<string, ExecutionContext>();

// Helper functions
function validateWorkflowChain(chain: WorkflowChain): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!chain.name || chain.name.trim() === '') {
    errors.push('Chain name is required');
  }
  
  if (!chain.steps || chain.steps.length === 0) {
    errors.push('At least one step is required');
  }
  
  // Check for circular dependencies
  const stepIds = new Set(chain.steps.map(s => s.id));
  for (const step of chain.steps) {
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (!stepIds.has(dep)) {
          errors.push(`Step ${step.id} depends on non-existent step ${dep}`);
        }
      }
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

function resolveDependencies(steps: WorkflowStep[]): WorkflowStep[][] {
  const resolved: WorkflowStep[][] = [];
  const remaining = [...steps];
  const completed = new Set<string>();

  while (remaining.length > 0) {
    const batch: WorkflowStep[] = [];

    for (let i = remaining.length - 1; i >= 0; i--) {
      const step = remaining[i];
      if (!step) continue;

      const canExecute = !step.dependencies ||
        step.dependencies.every(dep => completed.has(dep));

      if (canExecute) {
        batch.push(step);
        remaining.splice(i, 1);
        completed.add(step.id);
      }
    }

    if (batch.length === 0 && remaining.length > 0) {
      throw new Error('Circular dependency detected in workflow steps');
    }

    if (batch.length > 0) {
      resolved.push(batch);
    }
  }

  return resolved;
}

async function executeWorkflowStep(
  step: WorkflowStep, 
  context: ExecutionContext,
  baseUrl: string = 'http://127.0.0.1:8188'
): Promise<any> {
  try {
    console.error(chalk.blue(`🔄 Executing step: ${step.name} (${step.id})`));
    
    // Load workflow file
    const workflowPath = path.join(process.cwd(), 'workflows', step.workflowFile);
    if (!await fs.pathExists(workflowPath)) {
      throw new Error(`Workflow file not found: ${step.workflowFile}`);
    }
    
    const workflow = await fs.readJson(workflowPath);
    
    // Apply parameters and variable substitution
    if (step.parameters || context.globalVariables) {
      const allParams = { ...context.globalVariables, ...step.parameters };
      applyParametersToWorkflow(workflow, allParams);
    }
    
    // Execute workflow
    const clientId = uuidv4();
    const payload = {
      prompt: workflow,
      client_id: clientId
    };
    
    const result = await makeComfyUIRequest('/prompt', baseUrl, 'POST', payload);
    
    console.error(chalk.green(`✅ Step completed: ${step.name}`));
    
    return {
      stepId: step.id,
      promptId: result.prompt_id,
      queueNumber: result.number,
      clientId,
      timestamp: new Date(),
      success: true
    };
    
  } catch (error) {
    console.error(chalk.red(`❌ Step failed: ${step.name} - ${error}`));
    throw error;
  }
}

function applyParametersToWorkflow(workflow: any, parameters: Record<string, any>): void {
  const workflowStr = JSON.stringify(workflow);
  let updatedStr = workflowStr;
  
  // Replace parameter placeholders like {{parameter_name}}
  for (const [key, value] of Object.entries(parameters)) {
    const placeholder = `{{${key}}}`;
    updatedStr = updatedStr.replace(new RegExp(placeholder, 'g'), String(value));
  }
  
  // Update the workflow object
  const updated = JSON.parse(updatedStr);
  Object.assign(workflow, updated);
}

// Register workflow orchestration tools
export async function registerWorkflowOrchestrationTools(server: McpServer): Promise<void> {
  
  // Create workflow chain
  server.tool(
    "create_workflow_chain",
    "Create a new workflow chain for orchestrating multiple workflows",
    {
      name: z.string().describe("Name of the workflow chain"),
      description: z.string().describe("Description of what this chain does"),
      steps: z.array(z.object({
        id: z.string().describe("Unique identifier for this step"),
        name: z.string().describe("Human-readable name for this step"),
        workflowFile: z.string().describe("Filename of the workflow to execute (without .json)"),
        parameters: z.record(z.any()).optional().describe("Parameters to pass to this workflow"),
        dependencies: z.array(z.string()).optional().describe("IDs of steps that must complete before this one"),
        condition: z.string().optional().describe("Condition that must be true to execute this step"),
        retryCount: z.number().default(0).describe("Number of times to retry on failure"),
        timeout: z.number().optional().describe("Timeout in milliseconds"),
        onSuccess: z.array(z.string()).optional().describe("Steps to execute on success"),
        onFailure: z.array(z.string()).optional().describe("Steps to execute on failure")
      })).describe("Array of workflow steps"),
      globalParameters: z.record(z.any()).optional().describe("Global parameters available to all steps"),
      maxConcurrency: z.number().default(1).describe("Maximum number of concurrent step executions"),
      failureStrategy: z.enum(['stop', 'continue', 'retry']).default('stop').describe("How to handle step failures")
    },
    async ({ name, description, steps, globalParameters, maxConcurrency, failureStrategy }) => {
      try {
        const chainId = uuidv4();
        // Ensure steps have proper defaults
        const processedSteps: WorkflowStep[] = steps.map(step => ({
          ...step,
          retryCount: step.retryCount ?? 0,
          parameters: step.parameters ?? undefined,
          dependencies: step.dependencies ?? undefined,
          condition: step.condition ?? undefined,
          timeout: step.timeout ?? undefined,
          onSuccess: step.onSuccess ?? undefined,
          onFailure: step.onFailure ?? undefined
        }));

        const chain: WorkflowChain = {
          id: chainId,
          name,
          description,
          steps: processedSteps,
          globalParameters: globalParameters ?? undefined,
          maxConcurrency: maxConcurrency ?? 1,
          failureStrategy: failureStrategy ?? 'stop',
          created: new Date(),
          lastExecuted: undefined
        };
        
        // Validate the chain
        const validation = validateWorkflowChain(chain);
        if (!validation.isValid) {
          return {
            content: [{
              type: "text",
              text: `Failed to create workflow chain:\n${validation.errors.join('\n')}`
            }],
            isError: true
          };
        }
        
        // Store the chain
        workflowChains.set(chainId, chain);
        
        console.error(chalk.green(`✅ Created workflow chain: ${name} (${chainId})`));
        
        return {
          content: [{
            type: "text",
            text: `Workflow chain created successfully!\n\nID: ${chainId}\nName: ${name}\nDescription: ${description}\nSteps: ${steps.length}\nMax Concurrency: ${maxConcurrency}\nFailure Strategy: ${failureStrategy}\n\nUse 'execute_workflow_chain' with ID '${chainId}' to run this chain.`
          }]
        };
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to create workflow chain: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // List workflow chains
  server.tool(
    "list_workflow_chains",
    "List all available workflow chains",
    {},
    async () => {
      try {
        const chains = Array.from(workflowChains.values());
        
        if (chains.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No workflow chains found. Create one using 'create_workflow_chain'."
            }]
          };
        }
        
        const chainList = chains.map(chain => 
          `• ${chain.name} (${chain.id})\n  Description: ${chain.description}\n  Steps: ${chain.steps.length}\n  Created: ${chain.created.toISOString()}\n  Last Executed: ${chain.lastExecuted?.toISOString() || 'Never'}`
        ).join('\n\n');
        
        return {
          content: [{
            type: "text",
            text: `Available Workflow Chains (${chains.length}):\n\n${chainList}`
          }]
        };
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to list workflow chains: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Execute workflow chain
  server.tool(
    "execute_workflow_chain",
    "Execute a workflow chain with all its steps",
    {
      chainId: z.string().describe("ID of the workflow chain to execute"),
      baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
      runtimeParameters: z.record(z.any()).optional().describe("Runtime parameters to override global parameters"),
      dryRun: z.boolean().default(false).describe("If true, validate and show execution plan without running")
    },
    async ({ chainId, baseUrl, runtimeParameters, dryRun }) => {
      try {
        const chain = workflowChains.get(chainId);
        if (!chain) {
          return {
            content: [{
              type: "text",
              text: `Workflow chain not found: ${chainId}`
            }],
            isError: true
          };
        }

        // Create execution context
        const executionId = uuidv4();
        const context: ExecutionContext = {
          chainId,
          executionId,
          currentStep: 0,
          stepResults: {},
          globalVariables: { ...chain.globalParameters, ...runtimeParameters },
          startTime: new Date(),
          status: 'running'
        };

        // Resolve step dependencies
        const executionBatches = resolveDependencies(chain.steps);

        if (dryRun) {
          const plan = executionBatches.map((batch, index) =>
            `Batch ${index + 1}: ${batch.map(s => s.name).join(', ')}`
          ).join('\n');

          return {
            content: [{
              type: "text",
              text: `Execution Plan for '${chain.name}':\n\n${plan}\n\nTotal batches: ${executionBatches.length}\nTotal steps: ${chain.steps.length}\nGlobal parameters: ${JSON.stringify(context.globalVariables, null, 2)}`
            }]
          };
        }

        // Store execution context
        activeExecutions.set(executionId, context);

        console.error(chalk.blue(`🚀 Starting workflow chain execution: ${chain.name}`));

        const results = [];
        let totalSteps = 0;

        // Execute batches sequentially, steps within batch can be concurrent
        for (let batchIndex = 0; batchIndex < executionBatches.length; batchIndex++) {
          const batch = executionBatches[batchIndex];
          if (!batch) continue;

          console.error(chalk.yellow(`📦 Executing batch ${batchIndex + 1}/${executionBatches.length} (${batch.length} steps)`));

          // Execute steps in batch (potentially concurrent)
          const batchPromises = batch.map(step => executeWorkflowStep(step, context, baseUrl));
          const batchResults = await Promise.allSettled(batchPromises);

          // Process batch results
          for (let i = 0; i < batchResults.length; i++) {
            const result = batchResults[i];
            const step = batch[i];
            if (!result || !step) continue;

            totalSteps++;

            if (result.status === 'fulfilled') {
              context.stepResults[step.id] = result.value;
              results.push(`✅ ${step.name}: Success (Prompt ID: ${result.value.promptId})`);
            } else if (result.status === 'rejected') {
              context.stepResults[step.id] = { error: result.reason };
              results.push(`❌ ${step.name}: Failed - ${result.reason}`);

              if (chain.failureStrategy === 'stop') {
                context.status = 'failed';
                break;
              }
            }
          }

          if (context.status === 'failed' && chain.failureStrategy === 'stop') {
            break;
          }
        }

        // Update chain last executed time
        chain.lastExecuted = new Date();
        context.status = context.status === 'running' ? 'completed' : context.status;

        const duration = Date.now() - context.startTime.getTime();

        console.error(chalk.green(`🎉 Workflow chain execution completed: ${chain.name}`));

        return {
          content: [{
            type: "text",
            text: `Workflow Chain Execution Results\n\nChain: ${chain.name}\nExecution ID: ${executionId}\nStatus: ${context.status}\nDuration: ${duration}ms\nSteps Executed: ${totalSteps}/${chain.steps.length}\n\nStep Results:\n${results.join('\n')}\n\nUse 'get_execution_status' with execution ID '${executionId}' for detailed status.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to execute workflow chain: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Get execution status
  server.tool(
    "get_execution_status",
    "Get the status of a workflow chain execution",
    {
      executionId: z.string().describe("ID of the execution to check")
    },
    async ({ executionId }) => {
      try {
        const context = activeExecutions.get(executionId);
        if (!context) {
          return {
            content: [{
              type: "text",
              text: `Execution not found: ${executionId}`
            }],
            isError: true
          };
        }

        const chain = workflowChains.get(context.chainId);
        const duration = Date.now() - context.startTime.getTime();

        const stepStatuses = Object.entries(context.stepResults).map(([stepId, result]) => {
          const step = chain?.steps.find(s => s.id === stepId);
          const status = result.error ? '❌ Failed' : '✅ Success';
          return `  ${step?.name || stepId}: ${status}`;
        }).join('\n');

        return {
          content: [{
            type: "text",
            text: `Execution Status\n\nExecution ID: ${executionId}\nChain: ${chain?.name || 'Unknown'}\nStatus: ${context.status}\nDuration: ${duration}ms\nCurrent Step: ${context.currentStep}\nCompleted Steps: ${Object.keys(context.stepResults).length}/${chain?.steps.length || 0}\n\nStep Status:\n${stepStatuses}\n\nGlobal Variables:\n${JSON.stringify(context.globalVariables, null, 2)}`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to get execution status: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Delete workflow chain
  server.tool(
    "delete_workflow_chain",
    "Delete a workflow chain",
    {
      chainId: z.string().describe("ID of the workflow chain to delete")
    },
    async ({ chainId }) => {
      try {
        const chain = workflowChains.get(chainId);
        if (!chain) {
          return {
            content: [{
              type: "text",
              text: `Workflow chain not found: ${chainId}`
            }],
            isError: true
          };
        }

        workflowChains.delete(chainId);

        return {
          content: [{
            type: "text",
            text: `Workflow chain '${chain.name}' (${chainId}) deleted successfully.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to delete workflow chain: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Load workflow chain from file
  server.tool(
    "load_workflow_chain_from_file",
    "Load a workflow chain configuration from a JSON file",
    {
      filename: z.string().describe("Name of the JSON file containing the chain configuration (without .json extension)")
    },
    async ({ filename }) => {
      try {
        const configPath = path.join(process.cwd(), 'workflows', `${filename}.json`);

        if (!await fs.pathExists(configPath)) {
          return {
            content: [{
              type: "text",
              text: `Configuration file not found: ${filename}.json`
            }],
            isError: true
          };
        }

        const config = await fs.readJson(configPath);

        // Create chain from config
        const chainId = uuidv4();
        const chain: WorkflowChain = {
          id: chainId,
          name: config.name,
          description: config.description,
          steps: config.steps,
          globalParameters: config.globalParameters,
          maxConcurrency: config.maxConcurrency || 1,
          failureStrategy: config.failureStrategy || 'stop',
          created: new Date()
        };

        // Validate the chain
        const validation = validateWorkflowChain(chain);
        if (!validation.isValid) {
          return {
            content: [{
              type: "text",
              text: `Invalid workflow chain configuration:\n${validation.errors.join('\n')}`
            }],
            isError: true
          };
        }

        // Store the chain
        workflowChains.set(chainId, chain);

        console.error(chalk.green(`✅ Loaded workflow chain from file: ${filename}.json`));

        return {
          content: [{
            type: "text",
            text: `Workflow chain loaded successfully from '${filename}.json'!\n\nID: ${chainId}\nName: ${chain.name}\nDescription: ${chain.description}\nSteps: ${chain.steps.length}\nMax Concurrency: ${chain.maxConcurrency}\nFailure Strategy: ${chain.failureStrategy}\n\nUse 'execute_workflow_chain' with ID '${chainId}' to run this chain.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to load workflow chain from file: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Save workflow chain to file
  server.tool(
    "save_workflow_chain_to_file",
    "Save a workflow chain configuration to a JSON file",
    {
      chainId: z.string().describe("ID of the workflow chain to save"),
      filename: z.string().describe("Name for the JSON file (without .json extension)")
    },
    async ({ chainId, filename }) => {
      try {
        const chain = workflowChains.get(chainId);
        if (!chain) {
          return {
            content: [{
              type: "text",
              text: `Workflow chain not found: ${chainId}`
            }],
            isError: true
          };
        }

        const configPath = path.join(process.cwd(), 'workflows', `${filename}.json`);

        const config = {
          name: chain.name,
          description: chain.description,
          steps: chain.steps,
          globalParameters: chain.globalParameters,
          maxConcurrency: chain.maxConcurrency,
          failureStrategy: chain.failureStrategy
        };

        await fs.writeJson(configPath, config, { spaces: 2 });

        return {
          content: [{
            type: "text",
            text: `Workflow chain '${chain.name}' saved to '${filename}.json' successfully.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to save workflow chain to file: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Clone workflow chain
  server.tool(
    "clone_workflow_chain",
    "Clone an existing workflow chain with modifications",
    {
      sourceChainId: z.string().describe("ID of the workflow chain to clone"),
      newName: z.string().describe("Name for the cloned chain"),
      newDescription: z.string().optional().describe("Description for the cloned chain"),
      parameterOverrides: z.record(z.any()).optional().describe("Global parameters to override in the clone")
    },
    async ({ sourceChainId, newName, newDescription, parameterOverrides }) => {
      try {
        const sourceChain = workflowChains.get(sourceChainId);
        if (!sourceChain) {
          return {
            content: [{
              type: "text",
              text: `Source workflow chain not found: ${sourceChainId}`
            }],
            isError: true
          };
        }

        const cloneId = uuidv4();
        const clonedChain: WorkflowChain = {
          id: cloneId,
          name: newName,
          description: newDescription || `Clone of ${sourceChain.name}`,
          steps: JSON.parse(JSON.stringify(sourceChain.steps)), // Deep clone
          globalParameters: { ...sourceChain.globalParameters, ...parameterOverrides },
          maxConcurrency: sourceChain.maxConcurrency || 1,
          failureStrategy: sourceChain.failureStrategy || 'stop',
          created: new Date()
        };

        workflowChains.set(cloneId, clonedChain);

        return {
          content: [{
            type: "text",
            text: `Workflow chain cloned successfully!\n\nOriginal: ${sourceChain.name} (${sourceChainId})\nClone: ${newName} (${cloneId})\nDescription: ${clonedChain.description}\nSteps: ${clonedChain.steps.length}\nParameter Overrides: ${Object.keys(parameterOverrides || {}).length}`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to clone workflow chain: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  console.error(chalk.green("✅ Workflow orchestration tools registered"));
}
