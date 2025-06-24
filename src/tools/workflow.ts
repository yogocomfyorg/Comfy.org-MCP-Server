import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from 'url';
import { makeComfyUIRequest } from './comfyuiApi.js';

// Get the directory of the current module for reliable path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to get the server base directory (MCP/ComfyUI_MCP)
function getServerBaseDir(): string {
  // Go up from src/tools to the server root
  return path.resolve(__dirname, '..', '..');
}

// Helper function to resolve workflows directory with multiple fallback strategies
function resolveWorkflowsDir(): string {
  const serverBase = getServerBaseDir();
  const workflowsDir = path.join(serverBase, 'workflows');

  console.error(chalk.blue(`🔍 Debug: __dirname = ${__dirname}`));
  console.error(chalk.blue(`🔍 Debug: serverBase = ${serverBase}`));
  console.error(chalk.blue(`🔍 Debug: workflowsDir = ${workflowsDir}`));
  console.error(chalk.blue(`🔍 Debug: process.cwd() = ${process.cwd()}`));

  // Verify the workflows directory exists
  if (fs.existsSync(workflowsDir)) {
    console.error(chalk.green(`✅ Found workflows directory: ${workflowsDir}`));
    return workflowsDir;
  }

  // Fallback strategies
  const fallbacks = [
    path.join(process.cwd(), 'workflows'),
    path.join(process.cwd(), 'MCP', 'ComfyUI_MCP', 'workflows'),
    path.join(__dirname, '..', '..', 'workflows')
  ];

  console.error(chalk.yellow(`⚠️  Primary workflows directory not found: ${workflowsDir}`));
  console.error(chalk.blue(`🔍 Trying fallback strategies...`));

  for (const fallback of fallbacks) {
    console.error(chalk.gray(`  Checking: ${fallback}`));
    if (fs.existsSync(fallback)) {
      console.error(chalk.yellow(`⚠️  Using fallback workflows directory: ${fallback}`));
      return fallback;
    }
  }

  // If no existing directory found, return the expected location
  console.error(chalk.red(`❌ No workflows directory found! Using expected location: ${workflowsDir}`));
  return workflowsDir;
}

// Types
interface WorkflowNode {
  class_type: string;
  inputs: Record<string, any>;
  _meta?: {
    title?: string;
  };
}

interface Workflow {
  [nodeId: string]: WorkflowNode;
}


interface WorkflowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  nodeCount: number;
  connectionCount: number;
}

// Helper functions
function validateWorkflow(workflow: Workflow): WorkflowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = Object.keys(workflow);
  const nodeCount = nodeIds.length;
  let connectionCount = 0;

  // Check for empty workflow
  if (nodeCount === 0) {
    errors.push("Workflow is empty");
    return { isValid: false, errors, warnings, nodeCount: 0, connectionCount: 0 };
  }

  // Validate each node
  for (const [nodeId, node] of Object.entries(workflow)) {
    // Check required fields
    if (!node.class_type) {
      errors.push(`Node ${nodeId}: Missing class_type`);
    }
    
    if (!node.inputs) {
      errors.push(`Node ${nodeId}: Missing inputs object`);
      continue;
    }

    // Count connections and validate references
    for (const [inputName, inputValue] of Object.entries(node.inputs)) {
      if (Array.isArray(inputValue) && inputValue.length === 2) {
        const [sourceNodeId] = inputValue;
        connectionCount++;
        
        // Check if referenced node exists
        if (!workflow[sourceNodeId]) {
          errors.push(`Node ${nodeId}: Input '${inputName}' references non-existent node '${sourceNodeId}'`);
        }
      }
    }
  }

  // Check for isolated nodes (nodes with no connections)
  const connectedNodes = new Set<string>();
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const inputValue of Object.values(node.inputs)) {
      if (Array.isArray(inputValue) && inputValue.length === 2) {
        connectedNodes.add(nodeId);
        connectedNodes.add(inputValue[0]);
      }
    }
  }

  const isolatedNodes = nodeIds.filter(id => !connectedNodes.has(id));
  if (isolatedNodes.length > 0) {
    warnings.push(`Isolated nodes detected: ${isolatedNodes.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    nodeCount,
    connectionCount
  };
}

function generateNodeId(): string {
  return Math.floor(Math.random() * 1000000).toString();
}

function createBasicNode(classType: string, inputs: Record<string, any> = {}, title?: string): WorkflowNode {
  const node: WorkflowNode = {
    class_type: classType,
    inputs
  };
  
  if (title) {
    node._meta = { title };
  }
  
  return node;
}

function optimizeWorkflow(workflow: Workflow): { optimized: Workflow; changes: string[] } {
  const optimized = JSON.parse(JSON.stringify(workflow));
  const changes: string[] = [];

  // Remove unused nodes (nodes that don't contribute to any output)
  const usedNodes = new Set<string>();
  const outputNodes = ['SaveImage', 'PreviewImage', 'VHS_VideoCombine'];
  
  // Find all output nodes
  for (const [nodeId, node] of Object.entries(optimized as Workflow)) {
    if (outputNodes.includes(node.class_type)) {
      usedNodes.add(nodeId);
    }
  }

  // Trace back from output nodes to find all used nodes
  const traceUsedNodes = (nodeId: string) => {
    if (usedNodes.has(nodeId)) return;
    usedNodes.add(nodeId);
    
    const node = optimized[nodeId];
    if (!node) return;
    
    for (const inputValue of Object.values(node.inputs)) {
      if (Array.isArray(inputValue) && inputValue.length === 2) {
        traceUsedNodes(inputValue[0]);
      }
    }
  };

  // Start tracing from output nodes
  for (const nodeId of usedNodes) {
    traceUsedNodes(nodeId);
  }

  // Remove unused nodes
  const allNodeIds = Object.keys(optimized);
  const unusedNodes = allNodeIds.filter(id => !usedNodes.has(id));
  
  for (const nodeId of unusedNodes) {
    const node = (workflow as Workflow)[nodeId];
    if (node) {
      delete (optimized as Workflow)[nodeId];
      changes.push(`Removed unused node: ${nodeId} (${node.class_type})`);
    }
  }

  return { optimized, changes };
}



// Dynamic parameter injection - works with any workflow type
interface ParameterMatch {
  nodeId: string;
  node: any;
  inputPath: string;
  inputName: string;
}

// Helper functions for dynamic parameter detection
function isTextParameter(paramName: string): boolean {
  const textParams = ['positive_prompt', 'negative_prompt', 'prompt', 'text', 'clip_l', 't5xxl'];
  return textParams.some(param => paramName.toLowerCase().includes(param.toLowerCase()));
}

function isTextInput(inputName: string, inputValue: any): boolean {
  // Check if it's a text input (string value, not an array connection)
  return typeof inputValue === 'string' &&
         ['text', 'prompt', 'clip_l', 't5xxl', 'positive', 'negative'].some(
           keyword => inputName.toLowerCase().includes(keyword)
         );
}

function isDimensionParameter(paramName: string): boolean {
  return ['width', 'height', 'batch_size'].includes(paramName.toLowerCase());
}

function isSamplingParameter(paramName: string): boolean {
  return ['steps', 'cfg', 'seed', 'noise_seed', 'sampler_name', 'scheduler', 'guidance', 'denoise'].includes(paramName.toLowerCase());
}

function isModelParameter(paramName: string): boolean {
  return ['strength_model', 'strength_clip', 'lora_name', 'ckpt_name', 'unet_name'].includes(paramName.toLowerCase());
}

function convertParameterValue(value: any, inputName: string): any {
  const inputLower = inputName.toLowerCase();

  // Integer parameters
  if (['width', 'height', 'steps', 'batch_size', 'seed', 'noise_seed'].some(param => inputLower.includes(param))) {
    const intVal = parseInt(String(value));
    return isNaN(intVal) ? value : intVal;
  }

  // Float parameters
  if (['cfg', 'guidance', 'strength', 'denoise'].some(param => inputLower.includes(param))) {
    const floatVal = parseFloat(String(value));
    return isNaN(floatVal) ? value : floatVal;
  }

  // Keep as string for text inputs and other parameters
  return String(value);
}

function findNodesForParameter(workflow: any, paramName: string, _paramValue: any): ParameterMatch[] {
  const matches: ParameterMatch[] = [];
  const paramLower = paramName.toLowerCase();

  for (const [nodeId, node] of Object.entries(workflow)) {
    const nodeInputs = (node as any).inputs || {};

    // Direct field name match (highest priority)
    if (nodeInputs.hasOwnProperty(paramName)) {
      matches.push({
        nodeId,
        node,
        inputPath: `inputs.${paramName}`,
        inputName: paramName
      });
      continue;
    }

    // Semantic matching for different parameter types
    for (const [inputName, inputValue] of Object.entries(nodeInputs)) {
      const inputLower = inputName.toLowerCase();

      // Text parameter matching
      if (isTextParameter(paramName) && isTextInput(inputName, inputValue)) {
        // Handle positive/negative prompt filtering
        if (paramLower.includes('positive') && !inputLower.includes('negative') && !inputLower.includes('unconditional')) {
          matches.push({ nodeId, node, inputPath: `inputs.${inputName}`, inputName });
        } else if (paramLower.includes('negative') && (inputLower.includes('negative') || inputLower.includes('unconditional'))) {
          matches.push({ nodeId, node, inputPath: `inputs.${inputName}`, inputName });
        } else if (!paramLower.includes('positive') && !paramLower.includes('negative') && inputLower.includes('text')) {
          matches.push({ nodeId, node, inputPath: `inputs.${inputName}`, inputName });
        }
      }

      // Dimension parameter matching
      else if (isDimensionParameter(paramName) && inputLower === paramLower) {
        matches.push({ nodeId, node, inputPath: `inputs.${inputName}`, inputName });
      }

      // Sampling parameter matching
      else if (isSamplingParameter(paramName) && inputLower === paramLower) {
        matches.push({ nodeId, node, inputPath: `inputs.${inputName}`, inputName });
      }

      // Model parameter matching
      else if (isModelParameter(paramName) && inputLower === paramLower) {
        matches.push({ nodeId, node, inputPath: `inputs.${inputName}`, inputName });
      }
    }
  }

  return matches;
}

const WORKFLOW_PRESETS: Record<string, Record<string, any>> = {
  'single_image': { batch_size: 1 },
  'batch_4': { batch_size: 4 },
  'high_res': { width: 1920, height: 1080 },
  'square': { width: 1024, height: 1024 },
  'portrait': { width: 768, height: 1024 },
  'landscape': { width: 1024, height: 768 },
  'quick_test': { steps: 10, cfg: 7.0 },
  'high_quality': { steps: 50, cfg: 8.0 }
};





function setNestedProperty(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  const finalKey = keys[keys.length - 1];
  if (finalKey) {
    current[finalKey] = value;
  }
}

async function applyDynamicParameters(workflow: any, parameters: Record<string, any>): Promise<void> {
  // Apply preset if specified
  if (parameters['preset'] && WORKFLOW_PRESETS[parameters['preset']]) {
    console.error(chalk.blue(`🎯 Applying preset: ${parameters['preset']}`));
    Object.assign(parameters, WORKFLOW_PRESETS[parameters['preset']]);
    delete parameters['preset'];
  }

  let totalApplied = 0;

  // Apply each parameter dynamically
  for (const [paramName, paramValue] of Object.entries(parameters)) {
    if (paramName === 'preset') continue; // Skip preset as it's already processed

    console.error(chalk.blue(`🔍 Searching for parameter: ${paramName}`));

    const matches = findNodesForParameter(workflow, paramName, paramValue);

    if (matches.length === 0) {
      console.error(chalk.yellow(`⚠️ Parameter ${paramName} not applied - no matching inputs found`));
      continue;
    }

    for (const match of matches) {
      const convertedValue = convertParameterValue(paramValue, match.inputName);

      // Set the parameter using the input path
      setNestedProperty(match.node, match.inputPath, convertedValue);
      totalApplied++;

      console.error(chalk.gray(`  ✓ Applied ${paramName}=${convertedValue} to node ${match.nodeId}.${match.inputName} (${(match.node as any).class_type})`));
    }
  }

  console.error(chalk.green(`✅ Applied ${totalApplied} parameter assignments across ${Object.keys(parameters).length - (parameters['preset'] ? 1 : 0)} parameters`));
}

function validateWorkflowStructure(workflow: any): { valid: boolean; errors: string[]; warnings?: string[] } {
  const errors: string[] = [];

  // Basic validation
  if (!workflow || typeof workflow !== 'object') {
    errors.push('Workflow is not a valid object');
    return { valid: false, errors };
  }

  // Check for required node types (more flexible for different workflow types)
  const nodeTypes = Object.values(workflow).map((node: any) => node.class_type);

  // Model loading (supports both traditional and Flux workflows)
  const hasModel = nodeTypes.includes('CheckpointLoaderSimple') ||
                   nodeTypes.includes('UNETLoader') ||
                   nodeTypes.includes('DualCLIPLoader');

  // Latent generation
  const hasLatent = nodeTypes.includes('EmptyLatentImage');

  // Sampling (supports both traditional and Flux workflows)
  const hasSampler = nodeTypes.includes('KSampler') ||
                     nodeTypes.includes('SamplerCustomAdvanced') ||
                     nodeTypes.includes('BasicScheduler');

  // Image output
  const hasOutput = nodeTypes.includes('SaveImage') ||
                    nodeTypes.includes('VAEDecode');

  // Only require essential components, be more flexible
  if (!hasModel) {
    errors.push('No model loader found (CheckpointLoaderSimple, UNETLoader, or DualCLIPLoader)');
  }
  if (!hasLatent) {
    errors.push('No latent image generator found (EmptyLatentImage)');
  }
  if (!hasSampler) {
    errors.push('No sampler found (KSampler, SamplerCustomAdvanced, or BasicScheduler)');
  }
  if (!hasOutput) {
    errors.push('No output node found (SaveImage or VAEDecode)');
  }

  // Warn about missing connections but don't fail validation
  const warnings: string[] = [];
  if (nodeTypes.includes('VAEDecode') && !nodeTypes.includes('SaveImage')) {
    warnings.push('VAEDecode found but no SaveImage node - images may not be saved');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Register workflow tools
export async function registerWorkflowTools(server: McpServer): Promise<void> {
  
  // Create workflow
  server.tool(
    "create_workflow",
    "Create a new workflow from scratch or template",
    {
        template: z.string().optional().describe("Template type (basic, txt2img, img2img, etc.)"),
        name: z.string().optional().describe("Workflow name"),
        description: z.string().optional().describe("Workflow description")
    },
    async ({ template, name, description }) => {
      try {
        let workflow: Workflow = {};
        const workflowName = name || `workflow_${Date.now()}`;
        
        // Create basic templates
        if (template === 'txt2img' || !template) {
          // Basic text-to-image workflow
          const checkpointId = generateNodeId();
          const clipTextEncodeId = generateNodeId();
          const emptyLatentId = generateNodeId();
          const ksampleId = generateNodeId();
          const vaeDecodeId = generateNodeId();
          const saveImageId = generateNodeId();
          
          workflow = {
            [checkpointId]: createBasicNode("CheckpointLoaderSimple", {
              ckpt_name: "model.safetensors"
            }, "Load Checkpoint"),
            
            [clipTextEncodeId]: createBasicNode("CLIPTextEncode", {
              text: "a beautiful landscape",
              clip: [checkpointId, 1]
            }, "Positive Prompt"),
            
            [emptyLatentId]: createBasicNode("EmptyLatentImage", {
              width: 512,
              height: 512,
              batch_size: 1
            }, "Empty Latent"),
            
            [ksampleId]: createBasicNode("KSampler", {
              seed: Math.floor(Math.random() * 1000000),
              steps: 20,
              cfg: 8.0,
              sampler_name: "euler",
              scheduler: "normal",
              denoise: 1.0,
              model: [checkpointId, 0],
              positive: [clipTextEncodeId, 0],
              negative: [clipTextEncodeId, 0],
              latent_image: [emptyLatentId, 0]
            }, "KSampler"),
            
            [vaeDecodeId]: createBasicNode("VAEDecode", {
              samples: [ksampleId, 0],
              vae: [checkpointId, 2]
            }, "VAE Decode"),
            
            [saveImageId]: createBasicNode("SaveImage", {
              filename_prefix: "ComfyUI",
              images: [vaeDecodeId, 0]
            }, "Save Image")
          };
        }
        
        const validation = validateWorkflow(workflow);
        
        
        console.error(chalk.green(`✅ Created workflow: ${workflowName}`));
        
        return {
          content: [{
            type: "text",
            text: `Workflow created successfully!\n\nName: ${workflowName}\nDescription: ${description || "Generated workflow"}\nNodes: ${validation.nodeCount}\nConnections: ${validation.connectionCount}\nValid: ${validation.isValid}\n\nWorkflow JSON:\n${JSON.stringify(workflow, null, 2)}`
          }]
        };
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Failed to create workflow: ${errorMsg}`));
        
        return {
          content: [{
            type: "text",
            text: `Failed to create workflow: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Load workflow
  server.tool(
    "load_workflow",
    "Load workflow from file",
    {
        filePath: z.string().describe("Path to workflow file (can be relative to workflows directory or absolute)"),
        validate: z.boolean().default(true).describe("Validate workflow after loading")
    },
    async ({ filePath, validate }) => {
      try {
        console.error(chalk.blue(`📂 Loading workflow from: ${filePath}`));

        // Try multiple path resolution strategies
        let resolvedPath = filePath;

        // If it's not an absolute path and doesn't exist, try workflows directory
        if (!await fs.pathExists(resolvedPath)) {
          const workflowsDir = resolveWorkflowsDir();
          const workflowPath = path.join(workflowsDir, filePath);

          if (await fs.pathExists(workflowPath)) {
            resolvedPath = workflowPath;
          } else {
            // Try with .json extension if not present
            const withExtension = filePath.endsWith('.json') ? filePath : `${filePath}.json`;
            const workflowPathWithExt = path.join(workflowsDir, withExtension);

            if (await fs.pathExists(workflowPathWithExt)) {
              resolvedPath = workflowPathWithExt;
            } else {
              throw new Error(`File not found: ${filePath}. Tried:\n- ${filePath}\n- ${workflowPath}\n- ${workflowPathWithExt}`);
            }
          }
        }

        console.error(chalk.gray(`📁 Resolved path: ${resolvedPath}`));

        const fileContent = await fs.readFile(resolvedPath, 'utf-8');
        const workflow: Workflow = JSON.parse(fileContent);
        
        let validation: WorkflowValidationResult | null = null;
        if (validate) {
          validation = validateWorkflow(workflow);
        }
        
        const output = [
          `Workflow loaded successfully from: ${filePath}`,
          `Nodes: ${Object.keys(workflow).length}`,
          ''
        ];
        
        if (validation) {
          output.push(`Validation: ${validation.isValid ? 'PASSED' : 'FAILED'}`);
          output.push(`Connections: ${validation.connectionCount}`);
          
          if (validation.errors.length > 0) {
            output.push('\nErrors:');
            validation.errors.forEach(error => output.push(`  - ${error}`));
          }
          
          if (validation.warnings.length > 0) {
            output.push('\nWarnings:');
            validation.warnings.forEach(warning => output.push(`  - ${warning}`));
          }
        }
        
        output.push('\nWorkflow JSON:');
        output.push(JSON.stringify(workflow, null, 2));
        
        console.error(chalk.green(`✅ Workflow loaded successfully`));
        
        return {
          content: [{
            type: "text",
            text: output.join('\n')
          }],
          isError: validation ? !validation.isValid : false
        };
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Failed to load workflow: ${errorMsg}`));
        
        return {
          content: [{
            type: "text",
            text: `Failed to load workflow: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Validate workflow
  server.tool(
    "validate_workflow",
    "Validate workflow structure and connections",
    {
        workflow: z.object({}).passthrough().describe("Workflow JSON object")
    },
    async ({ workflow }) => {
      try {
        const validation = validateWorkflow(workflow as Workflow);
        
        const output = [
          `Workflow Validation Report`,
          `========================`,
          `Status: ${validation.isValid ? 'VALID' : 'INVALID'}`,
          `Nodes: ${validation.nodeCount}`,
          `Connections: ${validation.connectionCount}`,
          ''
        ];
        
        if (validation.errors.length > 0) {
          output.push('ERRORS:');
          validation.errors.forEach((error, index) => {
            output.push(`  ${index + 1}. ${error}`);
          });
          output.push('');
        }
        
        if (validation.warnings.length > 0) {
          output.push('WARNINGS:');
          validation.warnings.forEach((warning, index) => {
            output.push(`  ${index + 1}. ${warning}`);
          });
          output.push('');
        }
        
        if (validation.isValid && validation.errors.length === 0 && validation.warnings.length === 0) {
          output.push('✅ Workflow is valid with no issues detected.');
        }
        
        return {
          content: [{
            type: "text",
            text: output.join('\n')
          }],
          isError: !validation.isValid
        };
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to validate workflow: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Optimize workflow
  server.tool(
    "optimize_workflow",
    "Optimize workflow for performance by removing unused nodes",
    {
        workflow: z.object({}).passthrough().describe("Workflow JSON object")
    },
    async ({ workflow }) => {
      try {
        const { optimized, changes } = optimizeWorkflow(workflow as Workflow);
        const originalValidation = validateWorkflow(workflow as Workflow);
        const optimizedValidation = validateWorkflow(optimized);
        
        const output = [
          'Workflow Optimization Report',
          '============================',
          `Original nodes: ${originalValidation.nodeCount}`,
          `Optimized nodes: ${optimizedValidation.nodeCount}`,
          `Nodes removed: ${originalValidation.nodeCount - optimizedValidation.nodeCount}`,
          `Original connections: ${originalValidation.connectionCount}`,
          `Optimized connections: ${optimizedValidation.connectionCount}`,
          ''
        ];
        
        if (changes.length > 0) {
          output.push('Changes made:');
          changes.forEach((change, index) => {
            output.push(`  ${index + 1}. ${change}`);
          });
          output.push('');
        } else {
          output.push('No optimizations needed - workflow is already optimal.');
          output.push('');
        }
        
        output.push('Optimized Workflow:');
        output.push(JSON.stringify(optimized, null, 2));
        
        console.error(chalk.green(`✅ Workflow optimized: ${changes.length} changes made`));
        
        return {
          content: [{
            type: "text",
            text: output.join('\n')
          }]
        };
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Failed to optimize workflow: ${errorMsg}`));
        
        return {
          content: [{
            type: "text",
            text: `Failed to optimize workflow: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  // Enhanced workflow execution with parameter support
  server.tool(
    "run_workflow_with_parameters",
    "Load and execute a workflow with enhanced parameter modification support",
    {
      workflowName: z.string().describe("Name of the workflow file (without .json extension)"),
      parameters: z.record(z.any()).optional().describe("Parameters to modify in the workflow (batch_size, width, height, positive_prompt, negative_prompt, steps, cfg, seed, etc.)"),
      preset: z.string().optional().describe("Apply a preset configuration (single_image, batch_4, high_res, square, portrait, landscape, quick_test, high_quality)"),
      baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
      clientId: z.string().optional().describe("Client ID for tracking (auto-generated if not provided)"),
      validateParameters: z.boolean().default(true).describe("Validate parameters before applying"),
      dryRun: z.boolean().default(false).describe("Preview changes without executing")
    },
    async ({ workflowName, parameters = {}, preset, baseUrl, clientId, validateParameters, dryRun }) => {
      try {
        const workflowsDir = resolveWorkflowsDir();
        const workflowPath = path.join(workflowsDir, `${workflowName}.json`);

        console.error(chalk.blue(`🔍 Loading workflow: ${workflowName}.json`));

        if (!await fs.pathExists(workflowPath)) {
          const availableWorkflows = await fs.readdir(workflowsDir)
            .then(files => files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')))
            .catch(() => []);

          return {
            content: [{
              type: "text",
              text: `Workflow '${workflowName}.json' not found in workflows folder.\n\nAvailable workflows:\n${availableWorkflows.length > 0 ? availableWorkflows.map(w => `- ${w}`).join('\n') : 'No workflows found'}`
            }],
            isError: true
          };
        }

        const workflowContent = await fs.readFile(workflowPath, 'utf-8');
        const workflow = JSON.parse(workflowContent);

        console.error(chalk.blue(`📋 Workflow loaded: ${workflowName}.json (${Object.keys(workflow).length} nodes)`));

        // Apply preset if specified
        if (preset) {
          parameters['preset'] = preset;
        }

        // Apply dynamic parameters
        if (Object.keys(parameters).length > 0) {
          console.error(chalk.yellow(`🔧 Applying ${Object.keys(parameters).length} parameters dynamically...`));
          await applyDynamicParameters(workflow, parameters);
          console.error(chalk.green(`✅ Dynamic parameters applied successfully`));
        }

        // Validate if requested
        if (validateParameters) {
          const validation = validateWorkflowStructure(workflow);
          if (!validation.valid) {
            return {
              content: [{
                type: "text",
                text: `❌ Workflow validation failed:\n${validation.errors.map(e => `- ${e}`).join('\n')}`
              }],
              isError: true
            };
          }
          console.error(chalk.green(`✅ Workflow structure validated`));
        }

        // Return dry run results
        if (dryRun) {
          return {
            content: [{
              type: "text",
              text: `🔍 Dry run completed for '${workflowName}':\n\n📋 Workflow: ${workflowName}.json\n🔢 Nodes: ${Object.keys(workflow).length}\n\n🔧 Parameters applied:\n${JSON.stringify(parameters, null, 2)}\n\n✅ Workflow structure validated\n\n🚀 Ready for execution - remove dryRun parameter to execute.`
            }]
          };
        }

        // Execute workflow
        const actualClientId = clientId || `mcp-enhanced-${Date.now()}`;
        const payload = {
          prompt: workflow,
          client_id: actualClientId
        };

        console.error(chalk.blue(`🚀 Executing enhanced workflow via API...`));

        const result = await makeComfyUIRequest('/prompt', baseUrl, 'POST', payload);

        console.error(chalk.green(`✅ Enhanced workflow executed successfully`));

        return {
          content: [{
            type: "text",
            text: `🎉 Enhanced workflow '${workflowName}' executed successfully!\n\n📋 Details:\n- Workflow: ${workflowName}.json\n- Nodes: ${Object.keys(workflow).length}\n- Parameters applied: ${Object.keys(parameters).length}\n- Prompt ID: ${result.prompt_id}\n- Queue Number: ${result.number}\n- Client ID: ${actualClientId}\n- Server: ${baseUrl}\n\n🔧 Applied parameters:\n${Object.keys(parameters).length > 0 ? JSON.stringify(parameters, null, 2) : 'None'}\n\n🎨 The enhanced workflow is now processing in ComfyUI. You can check the queue status or monitor progress in the ComfyUI interface.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Enhanced workflow execution failed: ${errorMsg}`));

        return {
          content: [{
            type: "text",
            text: `❌ Failed to execute enhanced workflow '${workflowName}': ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "run_workflow",
    "Load and execute a workflow from the workflows folder (legacy - use run_workflow_with_parameters for enhanced features)",
    {
        workflowName: z.string().describe("Name of the workflow file (without .json extension)"),
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
        clientId: z.string().optional().describe("Client ID for tracking (auto-generated if not provided)")
    },
    async ({ workflowName, baseUrl, clientId }) => {
      try {
        const workflowsDir = resolveWorkflowsDir();
        const workflowPath = path.join(workflowsDir, `${workflowName}.json`);

        console.error(chalk.blue(`🔍 Loading workflow: ${workflowName}.json`));

        if (!await fs.pathExists(workflowPath)) {
          const availableWorkflows = await fs.readdir(workflowsDir)
            .then(files => files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')))
            .catch(() => []);

          return {
            content: [{
              type: "text",
              text: `Workflow '${workflowName}.json' not found in workflows folder.\n\nAvailable workflows:\n${availableWorkflows.length > 0 ? availableWorkflows.map(w => `- ${w}`).join('\n') : 'No workflows found'}`
            }],
            isError: true
          };
        }

        const workflowContent = await fs.readFile(workflowPath, 'utf-8');
        const workflow = JSON.parse(workflowContent);

        console.error(chalk.blue(`📋 Workflow loaded, nodes: ${Object.keys(workflow).length}`));

        const actualClientId = clientId || `mcp-${Date.now()}`;
        const payload = {
          prompt: workflow,
          client_id: actualClientId
        };

        console.error(chalk.blue(`🚀 Executing workflow via API...`));

        const result = await makeComfyUIRequest('/prompt', baseUrl, 'POST', payload);

        console.error(chalk.green(`✅ Workflow executed successfully`));

        return {
          content: [{
            type: "text",
            text: `Workflow '${workflowName}' executed successfully!\n\nDetails:\n- Workflow: ${workflowName}.json\n- Nodes: ${Object.keys(workflow).length}\n- Prompt ID: ${result.prompt_id}\n- Queue Number: ${result.number}\n- Client ID: ${actualClientId}\n- Server: ${baseUrl}\n\nThe workflow is now processing in ComfyUI. You can check the queue status or monitor progress in the ComfyUI interface.`
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`❌ Failed to run workflow: ${errorMsg}`));

        return {
          content: [{
            type: "text",
            text: `Failed to run workflow '${workflowName}': ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  console.error(chalk.green("✅ Workflow tools registered"));
}
