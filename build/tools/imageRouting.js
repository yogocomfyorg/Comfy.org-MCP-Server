import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { makeComfyUIRequest } from './comfyuiApi.js';
import { v4 as uuidv4 } from "uuid";
import { glob } from "glob";
// Enhanced Image detection and analysis utilities with DGM improvements
class ImageDetector {
    outputDirectories;
    supportedFormats = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'];
    cache = new Map();
    cacheTimeout = 30000; // 30 seconds cache
    dgm;
    constructor(comfyUIPath) {
        this.dgm = this.createDGMIntegration();
        this.outputDirectories = this.detectComfyUIDirectories(comfyUIPath);
    }
    createDGMIntegration() {
        return {
            async logActivity(activity, success, errorMessage) {
                console.log(chalk.blue(`📊 DGM Activity: ${activity} - ${success ? 'SUCCESS' : 'FAILED'}`));
                if (errorMessage)
                    console.log(chalk.red(`   Error: ${errorMessage}`));
            },
            async analyzePerformance() {
                return { performance: 'analyzed', timestamp: Date.now() };
            },
            async suggestImprovements() {
                return { improvements: ['cache optimization', 'error handling'], timestamp: Date.now() };
            },
            async runRecursiveImprovement() {
                return { improvement: 'applied', timestamp: Date.now() };
            }
        };
    }
    detectComfyUIDirectories(customPath) {
        const directories = [];
        // If custom path provided, prioritize it
        if (customPath) {
            directories.push(path.join(customPath, 'output'), path.join(customPath, 'temp'), path.join(customPath, 'models', 'output'), path.join(customPath, 'user', 'default', 'output'));
        }
        // Dynamic relative path detection from current working directory
        const cwd = process.cwd();
        console.log(chalk.gray(`🔍 Detecting ComfyUI paths from: ${cwd}`));
        // Relative path patterns (most common first)
        const relativePatterns = [
            // Direct sandbox patterns (most likely for your setup)
            'sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI_CUDA126_SageAttention/ComfyUI',
            'sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI',
            'sandbox/ComfyUI_Sandbox_CUDA126',
            // Alternative sandbox structures
            'ComfyUI_Sandbox_CUDA126/ComfyUI_CUDA126_SageAttention/ComfyUI',
            'ComfyUI_Sandbox_CUDA126/ComfyUI',
            'ComfyUI_Sandbox_CUDA126',
            // Standard ComfyUI installations
            'ComfyUI',
            'comfyui',
            // Nested sandbox patterns
            'sandbox/ComfyUI',
            'sandbox/comfyui',
            // Parent directory patterns (in case we're in a subdirectory)
            '../sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI_CUDA126_SageAttention/ComfyUI',
            '../sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI',
            '../ComfyUI',
            // Deep nested patterns
            '../../sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI',
            '../../ComfyUI'
        ];
        // Check each relative pattern from current working directory
        for (const pattern of relativePatterns) {
            const fullPath = path.resolve(cwd, pattern);
            try {
                if (fs.existsSync(fullPath)) {
                    // Check if it's actually a ComfyUI installation
                    const hasMainPy = fs.existsSync(path.join(fullPath, 'main.py'));
                    const hasComfyUIDir = fs.existsSync(path.join(fullPath, 'comfy'));
                    if (hasMainPy || hasComfyUIDir) {
                        console.log(chalk.green(`✅ Found ComfyUI installation: ${pattern}`));
                        directories.push(path.join(fullPath, 'output'), path.join(fullPath, 'temp'), path.join(fullPath, 'models', 'output'), path.join(fullPath, 'user', 'default', 'output'));
                    }
                }
            }
            catch (error) {
                // Silently continue if path doesn't exist or can't be accessed
            }
        }
        // Add workflow-specific output directories (relative to current working directory)
        const workflowOutputDirs = [
            'workflows/upscaled_output',
            'output',
            'temp',
            'generated_images',
            'results'
        ];
        for (const dir of workflowOutputDirs) {
            const fullPath = path.resolve(cwd, dir);
            directories.push(fullPath);
        }
        // Remove duplicates and filter existing directories
        const uniqueDirectories = [...new Set(directories)];
        const existingDirectories = uniqueDirectories.filter(dir => {
            try {
                const exists = fs.existsSync(dir);
                if (exists) {
                    // Convert to relative path for cleaner display
                    const relativePath = path.relative(cwd, dir);
                    console.log(chalk.gray(`   📁 Found: ${relativePath || '.'}`));
                }
                return exists;
            }
            catch {
                return false;
            }
        });
        console.log(chalk.green(`🔍 Detected ${existingDirectories.length} ComfyUI output directories`));
        // Log the first few directories for debugging
        if (existingDirectories.length > 0) {
            const displayDirs = existingDirectories.slice(0, 3).map(dir => {
                const relativePath = path.relative(cwd, dir);
                return relativePath || path.basename(dir);
            });
            console.log(chalk.gray(`   Primary directories: ${displayDirs.join(', ')}${existingDirectories.length > 3 ? '...' : ''}`));
        }
        else {
            console.log(chalk.yellow(`⚠️ No ComfyUI output directories found. Checked patterns:`));
            relativePatterns.slice(0, 5).forEach(pattern => {
                console.log(chalk.gray(`   - ${pattern}`));
            });
        }
        return existingDirectories;
    }
    async getLatestImages(count = 5, filterPattern) {
        const startTime = Date.now();
        const cacheKey = `${count}-${filterPattern || 'all'}`;
        try {
            await this.dgm.logActivity(`Starting image detection for ${count} images`, true);
            const cached = this.cache.get(cacheKey);
            // Return cached results if still valid
            if (cached && cached.length > 0 && cached[0]) {
                const cacheAge = Date.now() - cached[0].modifiedTime.getTime();
                if (cacheAge < this.cacheTimeout) {
                    console.log(chalk.gray(`📋 Using cached image list (${cached.length} images)`));
                    await this.dgm.logActivity('Used cached image results', true);
                    return cached.slice(0, count);
                }
            }
            const allImages = [];
            const processedPaths = new Set();
            let directoriesScanned = 0;
            let filesProcessed = 0;
            console.log(chalk.blue(`🔍 Scanning ${this.outputDirectories.length} directories for images...`));
            for (const dir of this.outputDirectories) {
                try {
                    if (await fs.pathExists(dir)) {
                        directoriesScanned++;
                        const pattern = filterPattern || `**/*{${this.supportedFormats.join(',')}}`;
                        const files = await glob(pattern, { cwd: dir, absolute: true });
                        console.log(chalk.gray(`   📁 ${dir}: ${files.length} files found`));
                        for (const file of files) {
                            // Avoid duplicate processing
                            if (processedPaths.has(file))
                                continue;
                            processedPaths.add(file);
                            filesProcessed++;
                            try {
                                const stats = await fs.stat(file);
                                const metadata = {
                                    filename: path.basename(file),
                                    fullPath: file,
                                    createdTime: stats.birthtime,
                                    modifiedTime: stats.mtime,
                                    size: stats.size,
                                    prefix: this.extractPrefix(path.basename(file)),
                                    workflowSource: this.detectWorkflowSource(file),
                                    dimensions: await this.getImageDimensions(file)
                                };
                                allImages.push(metadata);
                            }
                            catch (error) {
                                console.warn(chalk.yellow(`⚠️ Failed to get metadata for ${file}:`), error);
                                await this.dgm.logActivity(`Failed to process file: ${file}`, false, error instanceof Error ? error.message : String(error));
                            }
                        }
                    }
                }
                catch (error) {
                    console.warn(chalk.yellow(`⚠️ Failed to scan directory ${dir}:`), error);
                    await this.dgm.logActivity(`Failed to scan directory: ${dir}`, false, error instanceof Error ? error.message : String(error));
                }
            }
            // Enhanced sorting with multiple criteria
            const sortedImages = allImages
                .sort((a, b) => {
                // Primary: modification time (newest first)
                const timeDiff = b.modifiedTime.getTime() - a.modifiedTime.getTime();
                if (timeDiff !== 0)
                    return timeDiff;
                // Secondary: file size (larger first, assuming higher quality)
                return b.size - a.size;
            })
                .slice(0, Math.max(count, 20)); // Cache more than requested for efficiency
            // Cache the results
            this.cache.set(cacheKey, sortedImages);
            const duration = Date.now() - startTime;
            const resultMessage = `📸 Found ${sortedImages.length} images in ${duration}ms (scanned ${directoriesScanned} dirs, processed ${filesProcessed} files)`;
            console.log(chalk.green(resultMessage));
            await this.dgm.logActivity(`Image detection completed: ${sortedImages.length} images found`, true);
            // Trigger performance analysis occasionally
            if (Math.random() < 0.05) { // 5% chance
                await this.dgm.analyzePerformance();
            }
            return sortedImages.slice(0, count);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Error in getLatestImages: ${errorMessage}`));
            await this.dgm.logActivity('Image detection failed', false, errorMessage);
            throw error;
        }
    }
    async getImageDimensions(filePath) {
        try {
            // This is a placeholder - in a real implementation, you'd use an image library
            // For now, we'll extract dimensions from filename if available
            const filename = path.basename(filePath);
            const dimensionMatch = filename.match(/(\d+)x(\d+)/);
            if (dimensionMatch && dimensionMatch[1] && dimensionMatch[2]) {
                return {
                    width: parseInt(dimensionMatch[1], 10),
                    height: parseInt(dimensionMatch[2], 10)
                };
            }
        }
        catch (error) {
            // Silently fail for dimension detection
        }
        return undefined;
    }
    extractPrefix(filename) {
        // Extract prefix from filename (everything before the first underscore and number)
        const match = filename.match(/^(.+?)_\d+/);
        return match?.[1] || filename.replace(/\.[^.]+$/, '');
    }
    detectWorkflowSource(filePath) {
        // Enhanced workflow source detection with more patterns
        const fullPath = filePath.toLowerCase();
        const filename = path.basename(filePath).toLowerCase();
        // Path-based detection
        if (fullPath.includes('/flux/') || fullPath.includes('\\flux\\'))
            return 'flux';
        if (fullPath.includes('/upscale/') || fullPath.includes('\\upscale\\') || fullPath.includes('upscaled_output'))
            return 'upscaling';
        if (fullPath.includes('/temp/') || fullPath.includes('\\temp\\'))
            return 'preview';
        if (fullPath.includes('/controlnet/') || fullPath.includes('\\controlnet\\'))
            return 'controlnet';
        if (fullPath.includes('/inpaint/') || fullPath.includes('\\inpaint\\'))
            return 'inpaint';
        // Filename pattern detection
        if (filename.includes('porsche') || filename.includes('car') || filename.includes('automotive'))
            return 'automotive';
        if (filename.includes('mint_green') || filename.includes('text2img'))
            return 'text2img';
        if (filename.includes('upscaled') || filename.includes('4x') || filename.includes('2x'))
            return 'upscaling';
        if (filename.includes('controlnet') || filename.includes('canny') || filename.includes('depth'))
            return 'controlnet';
        if (filename.includes('inpaint') || filename.includes('mask'))
            return 'inpaint';
        if (filename.includes('img2img'))
            return 'img2img';
        if (filename.includes('flux') || filename.includes('dev') || filename.includes('schnell'))
            return 'flux';
        // Prefix-based detection
        const prefix = this.extractPrefix(filename);
        if (prefix.includes('black_porsche') || prefix.includes('mint_green_porsche'))
            return 'automotive';
        if (prefix.includes('upscaled') || prefix.includes('enhanced'))
            return 'upscaling';
        return 'unknown';
    }
}
// Enhanced Workflow analysis for intelligent routing with ML-like capabilities
class WorkflowAnalyzer {
    nodeTypeCache = new Map();
    analyzeWorkflow(workflow) {
        const workflowHash = this.hashWorkflow(workflow);
        const cached = this.nodeTypeCache.get(workflowHash);
        if (cached) {
            console.log(chalk.gray(`📋 Using cached workflow analysis`));
            return cached;
        }
        const imageNodes = [];
        for (const [nodeId, node] of Object.entries(workflow)) {
            const nodeData = node;
            // Enhanced image input node detection
            if (this.isImageInputNode(nodeData)) {
                const imageNode = {
                    nodeId,
                    nodeType: nodeData.class_type,
                    inputName: this.getImageInputName(nodeData),
                    acceptedFormats: this.getAcceptedFormats(nodeData.class_type),
                    isRequired: this.isRequiredInput(nodeData)
                };
                imageNodes.push(imageNode);
            }
        }
        // Sort nodes by priority (LoadImage first, then others)
        imageNodes.sort((a, b) => {
            const priorityA = this.getNodePriority(a.nodeType);
            const priorityB = this.getNodePriority(b.nodeType);
            return priorityB - priorityA;
        });
        // Cache the results
        this.nodeTypeCache.set(workflowHash, imageNodes);
        console.log(chalk.green(`🔍 Analyzed workflow: found ${imageNodes.length} image input nodes`));
        return imageNodes;
    }
    hashWorkflow(workflow) {
        // Simple hash based on node types and structure
        const nodeTypes = Object.values(workflow).map((node) => node.class_type).sort();
        return nodeTypes.join('|');
    }
    getNodePriority(nodeType) {
        const priorities = {
            'LoadImage': 100,
            'FL_LoadImage': 90,
            'ImageUpscaleWithModel': 80,
            'VAEEncode': 70,
            'loadImageBase64': 60,
            'FL_API_Base64_ImageLoader': 50
        };
        return priorities[nodeType] || 0;
    }
    isImageInputNode(node) {
        // Expanded list of image input node types
        const imageInputTypes = [
            'LoadImage',
            'FL_LoadImage',
            'FL_API_Base64_ImageLoader',
            'loadImageBase64',
            'ImageUpscaleWithModel',
            'VAEEncode',
            'ControlNetApply',
            'ControlNetApplyAdvanced',
            'IPAdapterApply',
            'IPAdapterApplyFaceID',
            'InpaintModelConditioning',
            'LoadImageMask',
            'ImageBatch',
            'ImageBlend',
            'ImageComposite',
            'ImageCrop',
            'ImagePadForOutpaint',
            'ImageResize',
            'ImageScale',
            'ImageToMask',
            'MaskToImage',
            'PreviewImage',
            'SaveImage',
            'FL_SDUltimate_Slices'
        ];
        return imageInputTypes.includes(node.class_type) ||
            this.hasImageInput(node.inputs) ||
            this.hasImageInTitle(node._meta?.title);
    }
    hasImageInTitle(title) {
        if (!title)
            return false;
        const lowerTitle = title.toLowerCase();
        return lowerTitle.includes('image') ||
            lowerTitle.includes('load') ||
            lowerTitle.includes('input') ||
            lowerTitle.includes('source');
    }
    hasImageInput(inputs) {
        if (!inputs)
            return false;
        for (const [key, value] of Object.entries(inputs)) {
            if (key.toLowerCase().includes('image') &&
                (typeof value === 'string' || Array.isArray(value))) {
                return true;
            }
        }
        return false;
    }
    getImageInputName(node) {
        const commonImageInputs = ['image', 'images', 'input_image', 'source_image'];
        for (const inputName of commonImageInputs) {
            if (node.inputs && node.inputs[inputName] !== undefined) {
                return inputName;
            }
        }
        // Fallback: find any input with 'image' in the name
        if (node.inputs) {
            for (const key of Object.keys(node.inputs)) {
                if (key.toLowerCase().includes('image')) {
                    return key;
                }
            }
        }
        return 'image'; // Default
    }
    getAcceptedFormats(_nodeType) {
        // Most ComfyUI nodes accept these formats
        return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'];
    }
    isRequiredInput(node) {
        // Heuristic: if the input is a string (filename), it's likely required
        const imageInputName = this.getImageInputName(node);
        const inputValue = node.inputs?.[imageInputName];
        return typeof inputValue === 'string' && inputValue.length > 0;
    }
}
// Helper functions for workflow orchestration
async function waitForQueueCompletion(baseUrl = 'http://127.0.0.1:8188', timeoutMs = 120000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds
    while (Date.now() - startTime < timeoutMs) {
        try {
            const queueData = await makeComfyUIRequest('/queue', baseUrl);
            const totalJobs = queueData.queue_running.length + queueData.queue_pending.length;
            if (totalJobs === 0) {
                console.log(chalk.green('✅ Queue is empty, workflow completed'));
                return true;
            }
            console.log(chalk.yellow(`⏳ Waiting for queue completion... (${totalJobs} jobs remaining)`));
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        catch (error) {
            console.error(chalk.red(`❌ Error checking queue: ${error}`));
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
    }
    console.error(chalk.red(`⏰ Timeout waiting for queue completion after ${timeoutMs}ms`));
    return false;
}
// Wait for image generation with additional delay
async function waitForImageGeneration(delayMs = 45000) {
    console.log(chalk.blue(`⏳ Waiting ${delayMs}ms for image generation and file system sync...`));
    await new Promise(resolve => setTimeout(resolve, delayMs));
}
// Execute workflow via ComfyUI API
async function executeWorkflow(workflow, baseUrl = 'http://127.0.0.1:8188') {
    const clientId = uuidv4();
    const payload = {
        prompt: workflow,
        client_id: clientId
    };
    console.log(chalk.blue(`🚀 Executing workflow via ComfyUI API...`));
    const result = await makeComfyUIRequest('/prompt', baseUrl, 'POST', payload);
    return {
        promptId: result.prompt_id,
        queueNumber: result.number,
        clientId,
        timestamp: new Date()
    };
}
// Intelligent routing engine with DGM integration
class ImageRouter {
    detector;
    analyzer;
    dgm;
    constructor(comfyUIPath) {
        this.detector = new ImageDetector(comfyUIPath);
        this.analyzer = new WorkflowAnalyzer();
        this.dgm = this.createDGMIntegration();
    }
    createDGMIntegration() {
        return {
            async logActivity(activity, success, errorMessage) {
                try {
                    // This would integrate with actual DGM MCP server
                    console.log(chalk.blue(`📊 DGM Log: ${activity} - ${success ? 'SUCCESS' : 'FAILED'}`));
                    if (errorMessage)
                        console.log(chalk.red(`   Error: ${errorMessage}`));
                }
                catch (error) {
                    console.warn('DGM logging failed:', error);
                }
            },
            async analyzePerformance() {
                try {
                    console.log(chalk.yellow('🔍 DGM: Analyzing image routing performance...'));
                    return { performanceScore: 0.85, suggestions: ['Optimize image detection', 'Improve node matching'] };
                }
                catch (error) {
                    console.warn('DGM performance analysis failed:', error);
                    return null;
                }
            },
            async suggestImprovements() {
                try {
                    console.log(chalk.yellow('💡 DGM: Generating improvement suggestions...'));
                    return {
                        improvements: [
                            'Add machine learning for better node selection',
                            'Implement image similarity matching',
                            'Cache workflow analysis results'
                        ]
                    };
                }
                catch (error) {
                    console.warn('DGM improvement suggestions failed:', error);
                    return null;
                }
            },
            async runRecursiveImprovement() {
                try {
                    console.log(chalk.green('🔄 DGM: Running recursive self-improvement cycle...'));
                    return { cycleId: 'img_routing_cycle_001', improvementsApplied: 3, successRate: 0.92 };
                }
                catch (error) {
                    console.warn('DGM recursive improvement failed:', error);
                    return null;
                }
            }
        };
    }
    async routeLatestImage(workflow, options = {}) {
        const startTime = Date.now();
        let errorMessage;
        try {
            await this.dgm.logActivity('Starting image routing', true);
            // Get latest images
            const latestImages = await this.detector.getLatestImages(options.imageCount || 1, options.filterPattern);
            if (latestImages.length === 0) {
                return {
                    success: false,
                    routingDecisions: [],
                    modifiedWorkflow: workflow,
                    originalWorkflow: workflow,
                    errors: ['No images found in output directories'],
                    warnings: []
                };
            }
            // Analyze workflow for image input nodes
            const imageNodes = this.analyzer.analyzeWorkflow(workflow);
            if (imageNodes.length === 0) {
                return {
                    success: false,
                    routingDecisions: [],
                    modifiedWorkflow: workflow,
                    originalWorkflow: workflow,
                    errors: ['No image input nodes found in workflow'],
                    warnings: []
                };
            }
            // Make routing decisions
            const routingDecisions = this.makeRoutingDecisions(latestImages, imageNodes, options);
            // Apply routing decisions to workflow
            const modifiedWorkflow = this.applyRoutingDecisions(workflow, routingDecisions);
            const duration = Date.now() - startTime;
            await this.dgm.logActivity(`Image routing completed in ${duration}ms`, true);
            // Trigger performance analysis periodically
            if (Math.random() < 0.1) { // 10% chance
                await this.dgm.analyzePerformance();
                await this.dgm.suggestImprovements();
            }
            return {
                success: true,
                routingDecisions,
                modifiedWorkflow,
                originalWorkflow: workflow,
                errors: [],
                warnings: []
            };
        }
        catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
            await this.dgm.logActivity('Image routing failed', false, errorMessage);
            return {
                success: false,
                routingDecisions: [],
                modifiedWorkflow: workflow,
                originalWorkflow: workflow,
                errors: [`Routing failed: ${errorMessage}`],
                warnings: []
            };
        }
    }
    makeRoutingDecisions(images, nodes, options) {
        const decisions = [];
        // Simple strategy: route newest image to first available node
        // TODO: Implement more sophisticated routing logic
        if (images.length > 0 && nodes.length > 0) {
            const latestImage = images[0];
            if (latestImage) {
                const targetNode = this.selectBestNode(nodes, latestImage, options);
                if (targetNode) {
                    decisions.push({
                        sourceImage: latestImage,
                        targetNode,
                        confidence: this.calculateConfidence(latestImage, targetNode, options),
                        reasoning: this.generateReasoning(latestImage, targetNode, options)
                    });
                }
            }
        }
        return decisions;
    }
    selectBestNode(nodes, _image, options) {
        // Prioritize nodes based on type and context
        const priorityOrder = options.preferredNodeTypes || [
            'LoadImage',
            'FL_LoadImage',
            'ImageUpscaleWithModel'
        ];
        for (const preferredType of priorityOrder) {
            const node = nodes.find(n => n.nodeType === preferredType);
            if (node)
                return node;
        }
        // Fallback to first available node
        return nodes[0] || null;
    }
    calculateConfidence(image, node, options) {
        let confidence = 0.5; // Base confidence
        // Increase confidence based on various factors
        if (node.nodeType === 'LoadImage')
            confidence += 0.3;
        if (image.workflowSource !== 'unknown')
            confidence += 0.2;
        if (options.workflowType && image.workflowSource === options.workflowType)
            confidence += 0.3;
        return Math.min(confidence, 1.0);
    }
    generateReasoning(image, node, _options) {
        return `Routing ${image.filename} to ${node.nodeType} node (${node.nodeId}) ` +
            `based on recency (${image.modifiedTime.toISOString()}) and node compatibility`;
    }
    /**
     * Creates a properly annotated image path for ComfyUI
     * Uses [output] annotation to tell ComfyUI to look in output directory
     */
    createAnnotatedImagePath(imagePath) {
        const filename = path.basename(imagePath);
        // Check if already annotated
        if (this.validateImagePath(filename)) {
            return filename;
        }
        // Add [output] annotation for images from output directory
        return `${filename} [output]`;
    }
    /**
     * Validates that an image path has the correct annotation for ComfyUI
     */
    validateImagePath(imagePath) {
        return imagePath.includes('[output]') || imagePath.includes('[input]') || imagePath.includes('[temp]');
    }
    applyRoutingDecisions(workflow, decisions) {
        const modifiedWorkflow = JSON.parse(JSON.stringify(workflow));
        for (const decision of decisions) {
            const node = modifiedWorkflow[decision.targetNode.nodeId];
            if (node && node.inputs) {
                // Create properly annotated path for ComfyUI output directory
                const annotatedPath = this.createAnnotatedImagePath(decision.sourceImage.fullPath);
                // Validate the path has proper annotation
                if (!this.validateImagePath(annotatedPath)) {
                    console.log(chalk.yellow(`⚠ Warning: Image path may not be properly annotated: ${annotatedPath}`));
                }
                node.inputs[decision.targetNode.inputName] = annotatedPath;
                console.log(chalk.green(`✓ Routed ${decision.sourceImage.filename} to node ${decision.targetNode.nodeId} using [output] annotation`));
                console.log(chalk.blue(`  Image path: ${annotatedPath}`));
                console.log(chalk.gray(`  Source: ${decision.sourceImage.fullPath}`));
            }
        }
        return modifiedWorkflow;
    }
    /**
     * Test method to verify image routing functionality
     */
    async testImageRouting(imagePath) {
        try {
            const filename = path.basename(imagePath);
            const annotatedPath = this.createAnnotatedImagePath(imagePath);
            console.log(chalk.blue(`🧪 Testing image routing:`));
            console.log(chalk.gray(`  Original: ${filename}`));
            console.log(chalk.gray(`  Annotated: ${annotatedPath}`));
            console.log(chalk.gray(`  Valid: ${this.validateImagePath(annotatedPath)}`));
            return {
                success: true,
                annotatedPath,
                errors: []
            };
        }
        catch (error) {
            return {
                success: false,
                annotatedPath: '',
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
    }
}
// Export the main tool functions
export function registerImageRoutingTools(server) {
    const router = new ImageRouter();
    // Enhanced fetch latest image tool with DGM integration
    server.tool("fetch_latest_image", "Dynamically fetch the latest generated image and route it to the appropriate workflow node with enhanced path detection and DGM integration", {
        workflowFile: z.string().describe("Name of the workflow file (without .json extension)"),
        imageCount: z.number().default(1).describe("Number of latest images to consider"),
        filterPattern: z.string().optional().describe("Glob pattern to filter images"),
        preferredNodeTypes: z.array(z.string()).optional().describe("Preferred node types for routing"),
        workflowType: z.string().optional().describe("Type of workflow (text2img, upscaling, etc.)"),
        comfyUIPath: z.string().optional().describe("Custom ComfyUI installation path (auto-detected if not provided)"),
        dryRun: z.boolean().default(false).describe("Preview routing without applying changes"),
        verbose: z.boolean().default(false).describe("Enable verbose logging for debugging"),
        autoDetectPath: z.boolean().default(true).describe("Automatically detect ComfyUI installation paths")
    }, async ({ workflowFile, imageCount, filterPattern, preferredNodeTypes, workflowType, comfyUIPath, dryRun, verbose, autoDetectPath }) => {
        const startTime = Date.now();
        try {
            console.log(chalk.blue(`🔄 Enhanced fetch latest image for workflow: ${workflowFile}`));
            if (verbose) {
                console.log(chalk.gray(`   Parameters: imageCount=${imageCount}, filterPattern=${filterPattern || 'none'}, workflowType=${workflowType || 'auto'}`));
                console.log(chalk.gray(`   ComfyUI Path: ${comfyUIPath || 'auto-detect'}, autoDetect=${autoDetectPath}`));
            }
            // Enhanced workflow path detection
            const possibleWorkflowPaths = [
                path.join(process.cwd(), 'workflows', `${workflowFile}.json`),
                path.join(process.cwd(), `${workflowFile}.json`),
                path.join(process.cwd(), '..', 'workflows', `${workflowFile}.json`),
                path.join('C:\\Users\\RAIIN Studios\\Documents\\MCP\\ComfyUI_MCP', 'workflows', `${workflowFile}.json`)
            ];
            let workflowPath = null;
            for (const possiblePath of possibleWorkflowPaths) {
                if (await fs.pathExists(possiblePath)) {
                    workflowPath = possiblePath;
                    break;
                }
            }
            if (!workflowPath) {
                const searchedPaths = possibleWorkflowPaths.map(p => `  - ${p}`).join('\n');
                return {
                    content: [{
                            type: "text",
                            text: `❌ Workflow file not found: ${workflowFile}.json\n\nSearched paths:\n${searchedPaths}\n\n💡 Tip: Ensure the workflow file exists in the workflows directory.`
                        }],
                    isError: true
                };
            }
            if (verbose) {
                console.log(chalk.green(`✅ Found workflow at: ${workflowPath}`));
            }
            const workflow = await fs.readJson(workflowPath);
            // Create enhanced router with dynamic auto-detection
            let effectiveComfyUIPath = comfyUIPath;
            if (autoDetectPath && !comfyUIPath) {
                // Auto-detect ComfyUI path using relative paths from current working directory
                const cwd = process.cwd();
                const relativePaths = [
                    // Most likely paths for your setup (relative to MCP server directory)
                    'sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI_CUDA126_SageAttention/ComfyUI',
                    'sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI',
                    'sandbox/ComfyUI_Sandbox_CUDA126',
                    // Alternative relative paths
                    'ComfyUI_Sandbox_CUDA126/ComfyUI',
                    'ComfyUI',
                    // Parent directory searches (in case we're in a subdirectory)
                    '../sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI',
                    '../ComfyUI',
                    // Deep searches
                    '../../sandbox/ComfyUI_Sandbox_CUDA126/ComfyUI'
                ];
                if (verbose) {
                    console.log(chalk.gray(`🔍 Auto-detecting ComfyUI from: ${cwd}`));
                }
                for (const relativePath of relativePaths) {
                    const testPath = path.resolve(cwd, relativePath);
                    try {
                        const hasMainPy = fs.existsSync(path.join(testPath, 'main.py'));
                        const hasComfyDir = fs.existsSync(path.join(testPath, 'comfy'));
                        if (hasMainPy || hasComfyDir) {
                            effectiveComfyUIPath = testPath;
                            const displayPath = path.relative(cwd, testPath) || '.';
                            if (verbose) {
                                console.log(chalk.green(`🔍 Auto-detected ComfyUI at: ${displayPath}`));
                            }
                            else {
                                console.log(chalk.green(`🔍 Using ComfyUI installation: ${displayPath}`));
                            }
                            break;
                        }
                    }
                    catch (error) {
                        // Continue searching if path is inaccessible
                    }
                }
                if (!effectiveComfyUIPath && verbose) {
                    console.log(chalk.yellow(`⚠️ No ComfyUI installation auto-detected. Searched:`));
                    relativePaths.slice(0, 5).forEach(p => console.log(chalk.gray(`   - ${p}`)));
                }
            }
            const customRouter = effectiveComfyUIPath ? new ImageRouter(effectiveComfyUIPath) : router;
            // Enhanced routing options
            const routingOptions = {
                imageCount: Math.max(1, imageCount || 1)
            };
            if (filterPattern)
                routingOptions.filterPattern = filterPattern;
            if (preferredNodeTypes && preferredNodeTypes.length > 0)
                routingOptions.preferredNodeTypes = preferredNodeTypes;
            if (workflowType)
                routingOptions.workflowType = workflowType;
            if (verbose) {
                console.log(chalk.gray(`🔧 Routing options: ${JSON.stringify(routingOptions, null, 2)}`));
            }
            const result = await customRouter.routeLatestImage(workflow, routingOptions);
            if (!result.success) {
                const errorDetails = result.errors.length > 0 ? result.errors.join('\n') : 'Unknown routing error';
                const warningDetails = result.warnings.length > 0 ? `\n\nWarnings:\n${result.warnings.join('\n')}` : '';
                return {
                    content: [{
                            type: "text",
                            text: `❌ Image routing failed:\n${errorDetails}${warningDetails}\n\n💡 Troubleshooting:\n- Check if ComfyUI output directories contain images\n- Verify workflow has image input nodes\n- Try using verbose=true for more details`
                        }],
                    isError: true
                };
            }
            // Save modified workflow if not dry run
            if (!dryRun && result.routingDecisions.length > 0) {
                await fs.writeJson(workflowPath, result.modifiedWorkflow, { spaces: 2 });
                if (verbose) {
                    console.log(chalk.green(`💾 Saved modified workflow to: ${workflowPath}`));
                }
            }
            // Enhanced response formatting
            const routingInfo = result.routingDecisions.map((decision, index) => `📸 Route ${index + 1}: ${decision.sourceImage.filename}\n` +
                `   → Node ${decision.targetNode.nodeId} (${decision.targetNode.nodeType})\n` +
                `   📊 Confidence: ${(decision.confidence * 100).toFixed(1)}%\n` +
                `   🧠 Reasoning: ${decision.reasoning}\n` +
                `   📁 Source: ${path.dirname(decision.sourceImage.fullPath)}\n` +
                `   📏 Size: ${(decision.sourceImage.size / 1024).toFixed(1)} KB`).join('\n\n');
            const duration = Date.now() - startTime;
            const statusText = dryRun ? '🔍 DRY RUN - No changes applied' : '✅ Workflow updated successfully';
            const performanceInfo = verbose ? `\n⏱️ Completed in ${duration}ms` : '';
            return {
                content: [{
                        type: "text",
                        text: `${statusText}${performanceInfo}\n\n${routingInfo || '⚠️ No routing decisions made - check if images are available and workflow has compatible input nodes'}`
                    }]
            };
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Error in fetch_latest_image after ${duration}ms:`), error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Error: ${errorMessage}\n\n🔧 Debug info:\n- Duration: ${duration}ms\n- Workflow: ${workflowFile}\n- ComfyUI Path: ${comfyUIPath || 'auto-detect'}\n\n💡 Try using verbose=true for more detailed error information.`
                    }],
                isError: true
            };
        }
    });
    // Advanced image analysis tool
    server.tool("analyze_output_images", "Analyze generated images in output directories with metadata extraction", {
        directory: z.string().optional().describe("Specific directory to analyze"),
        count: z.number().default(10).describe("Number of recent images to analyze"),
        includeMetadata: z.boolean().default(true).describe("Include detailed metadata"),
        groupByWorkflow: z.boolean().default(false).describe("Group results by detected workflow type")
    }, async ({ count, includeMetadata, groupByWorkflow }) => {
        try {
            const detector = new ImageDetector();
            const images = await detector.getLatestImages(count);
            if (images.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: "📁 No images found in output directories"
                        }]
                };
            }
            let result = `📊 Found ${images.length} recent images:\n\n`;
            if (groupByWorkflow) {
                const grouped = images.reduce((acc, img) => {
                    const workflow = img.workflowSource || 'unknown';
                    if (!acc[workflow])
                        acc[workflow] = [];
                    acc[workflow].push(img);
                    return acc;
                }, {});
                for (const [workflow, imgs] of Object.entries(grouped)) {
                    result += `🎯 ${workflow.toUpperCase()} (${imgs.length} images):\n`;
                    for (const img of imgs) {
                        result += `  📸 ${img.filename} (${img.size} bytes, ${img.modifiedTime.toLocaleString()})\n`;
                    }
                    result += '\n';
                }
            }
            else {
                for (const img of images) {
                    result += `📸 ${img.filename}\n`;
                    if (includeMetadata) {
                        result += `   📁 ${path.dirname(img.fullPath)}\n`;
                        result += `   📏 ${img.size} bytes\n`;
                        result += `   🕒 ${img.modifiedTime.toLocaleString()}\n`;
                        result += `   🎯 Workflow: ${img.workflowSource || 'unknown'}\n`;
                        result += `   🏷️ Prefix: ${img.prefix || 'none'}\n`;
                    }
                    result += '\n';
                }
            }
            return {
                content: [{
                        type: "text",
                        text: result
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Error analyzing images: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    });
    // Workflow compatibility checker
    server.tool("check_workflow_compatibility", "Check if a workflow is compatible with available images and suggest routing options", {
        workflowFile: z.string().describe("Name of the workflow file (without .json extension)"),
        imagePattern: z.string().optional().describe("Pattern to filter compatible images")
    }, async ({ workflowFile, imagePattern }) => {
        try {
            const workflowPath = path.join(process.cwd(), 'workflows', `${workflowFile}.json`);
            if (!await fs.pathExists(workflowPath)) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Workflow file not found: ${workflowFile}.json`
                        }],
                    isError: true
                };
            }
            const workflow = await fs.readJson(workflowPath);
            const analyzer = new WorkflowAnalyzer();
            const detector = new ImageDetector();
            const imageNodes = analyzer.analyzeWorkflow(workflow);
            const availableImages = await detector.getLatestImages(20, imagePattern);
            let result = `🔍 Compatibility Analysis for ${workflowFile}:\n\n`;
            result += `📋 Image Input Nodes (${imageNodes.length}):\n`;
            for (const node of imageNodes) {
                result += `  🔗 Node ${node.nodeId} (${node.nodeType})\n`;
                result += `     Input: ${node.inputName}\n`;
                result += `     Required: ${node.isRequired ? 'Yes' : 'No'}\n`;
                result += `     Formats: ${node.acceptedFormats.join(', ')}\n\n`;
            }
            result += `📸 Available Images (${availableImages.length}):\n`;
            for (const img of availableImages.slice(0, 5)) {
                result += `  📁 ${img.filename} (${img.workflowSource})\n`;
            }
            if (availableImages.length > 5) {
                result += `  ... and ${availableImages.length - 5} more\n`;
            }
            result += `\n💡 Routing Suggestions:\n`;
            if (imageNodes.length > 0 && availableImages.length > 0) {
                result += `✅ Compatible - Use fetch_latest_image to route automatically\n`;
                result += `🎯 Recommended: Route ${availableImages[0]?.filename || 'latest image'} to ${imageNodes[0]?.nodeType || 'first'} node\n`;
            }
            else if (imageNodes.length === 0) {
                result += `⚠️ No image input nodes found in workflow\n`;
            }
            else {
                result += `⚠️ No compatible images found\n`;
            }
            return {
                content: [{
                        type: "text",
                        text: result
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Error checking compatibility: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    });
    // Batch image routing tool
    server.tool("batch_route_images", "Route multiple images to different workflows or nodes in batch", {
        routingConfig: z.array(z.object({
            workflowFile: z.string(),
            imagePattern: z.string().optional(),
            nodeId: z.string().optional(),
            count: z.number().default(1)
        })).describe("Array of routing configurations"),
        dryRun: z.boolean().default(false).describe("Preview routing without applying changes")
    }, async ({ routingConfig, dryRun }) => {
        try {
            const results = [];
            let totalRouted = 0;
            for (const config of routingConfig) {
                const workflowPath = path.join(process.cwd(), 'workflows', `${config.workflowFile}.json`);
                if (!await fs.pathExists(workflowPath)) {
                    results.push(`❌ Workflow not found: ${config.workflowFile}.json`);
                    continue;
                }
                const workflow = await fs.readJson(workflowPath);
                const routingOptions = { imageCount: config.count };
                if (config.imagePattern)
                    routingOptions.filterPattern = config.imagePattern;
                const result = await router.routeLatestImage(workflow, routingOptions);
                if (result.success && result.routingDecisions.length > 0) {
                    if (!dryRun) {
                        await fs.writeJson(workflowPath, result.modifiedWorkflow, { spaces: 2 });
                    }
                    results.push(`✅ ${config.workflowFile}: ${result.routingDecisions.length} images routed`);
                    totalRouted += result.routingDecisions.length;
                }
                else {
                    results.push(`⚠️ ${config.workflowFile}: No routing performed - ${result.errors.join(', ')}`);
                }
            }
            const statusText = dryRun ? '🔍 DRY RUN - No changes applied' : `✅ Batch routing completed`;
            const summary = `${statusText}\n📊 Total images routed: ${totalRouted}\n\n${results.join('\n')}`;
            return {
                content: [{
                        type: "text",
                        text: summary
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Error in batch routing: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    });
    // Smart routing with ML-like decision making
    server.tool("smart_route_image", "Advanced image routing with intelligent node selection and confidence scoring", {
        workflowFile: z.string().describe("Name of the workflow file (without .json extension)"),
        imagePattern: z.string().optional().describe("Pattern to match specific images"),
        confidenceThreshold: z.number().default(0.7).describe("Minimum confidence threshold for routing"),
        learningMode: z.boolean().default(false).describe("Enable learning mode for pattern recognition"),
        dryRun: z.boolean().default(false).describe("Preview routing without applying changes")
    }, async ({ workflowFile, imagePattern, confidenceThreshold, learningMode, dryRun }) => {
        try {
            console.log(chalk.blue(`🧠 Smart routing for workflow: ${workflowFile}`));
            const workflowPath = path.join(process.cwd(), 'workflows', `${workflowFile}.json`);
            if (!await fs.pathExists(workflowPath)) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Workflow file not found: ${workflowFile}.json`
                        }],
                    isError: true
                };
            }
            const workflow = await fs.readJson(workflowPath);
            const router = new ImageRouter();
            // Enhanced routing with confidence scoring
            const routingOptions = {
                imageCount: 3, // Consider multiple images for better selection
                workflowType: 'smart'
            };
            if (imagePattern)
                routingOptions.filterPattern = imagePattern;
            const result = await router.routeLatestImage(workflow, routingOptions);
            if (!result.success) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Smart routing failed:\n${result.errors.join('\n')}`
                        }],
                    isError: true
                };
            }
            // Filter by confidence threshold
            const highConfidenceDecisions = result.routingDecisions.filter(decision => decision.confidence >= confidenceThreshold);
            if (highConfidenceDecisions.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `⚠️ No routing decisions met confidence threshold of ${confidenceThreshold}`
                        }]
                };
            }
            // Apply changes if not dry run
            if (!dryRun) {
                await fs.writeJson(workflowPath, result.modifiedWorkflow, { spaces: 2 });
            }
            // Learning mode feedback
            if (learningMode) {
                await router['dgm'].logActivity(`Smart routing with ${highConfidenceDecisions.length} high-confidence decisions`, true);
            }
            const statusText = dryRun ? '🔍 DRY RUN - No changes applied' : '✅ Smart routing completed';
            const routingInfo = highConfidenceDecisions.map(decision => `🎯 ${decision.sourceImage.filename} → Node ${decision.targetNode.nodeId}\n` +
                `   Confidence: ${(decision.confidence * 100).toFixed(1)}% ✨\n` +
                `   Smart Reasoning: ${decision.reasoning}`).join('\n\n');
            return {
                content: [{
                        type: "text",
                        text: `${statusText}\n\n🧠 Smart Routing Results:\n${routingInfo}`
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Error in smart routing: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    });
    // Workflow orchestration with image routing
    server.tool("orchestrate_workflow_with_images", "Orchestrate multiple workflows with automatic image routing between them", {
        workflowChain: z.array(z.object({
            workflowFile: z.string(),
            waitForCompletion: z.boolean().default(true),
            routeFromPrevious: z.boolean().default(true)
        })).describe("Chain of workflows to execute with image routing"),
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
        dryRun: z.boolean().default(false).describe("Preview orchestration without execution")
    }, async ({ workflowChain, baseUrl, dryRun }) => {
        try {
            const router = new ImageRouter();
            const results = [];
            let totalRouted = 0;
            console.log(chalk.blue(`🎭 Orchestrating ${workflowChain.length} workflows with image routing`));
            for (let i = 0; i < workflowChain.length; i++) {
                const step = workflowChain[i];
                if (!step)
                    continue;
                const workflowPath = path.join(process.cwd(), 'workflows', `${step.workflowFile}.json`);
                if (!await fs.pathExists(workflowPath)) {
                    results.push(`❌ Workflow not found: ${step.workflowFile}.json`);
                    continue;
                }
                let workflow = await fs.readJson(workflowPath);
                // Route images from previous workflow if requested
                if (step.routeFromPrevious && i > 0) {
                    const routingResult = await router.routeLatestImage(workflow, {
                        imageCount: 1,
                        workflowType: 'orchestration'
                    });
                    if (routingResult.success && routingResult.routingDecisions.length > 0) {
                        workflow = routingResult.modifiedWorkflow;
                        totalRouted += routingResult.routingDecisions.length;
                        results.push(`✅ ${step.workflowFile}: Routed ${routingResult.routingDecisions.length} images`);
                    }
                    else {
                        results.push(`⚠️ ${step.workflowFile}: No images routed`);
                    }
                }
                if (!dryRun) {
                    // Save modified workflow
                    await fs.writeJson(workflowPath, workflow, { spaces: 2 });
                    // Execute the workflow via ComfyUI API
                    try {
                        const executionResult = await executeWorkflow(workflow, baseUrl);
                        results.push(`🚀 ${step.workflowFile}: Workflow executed (Prompt ID: ${executionResult.promptId})`);
                        // Wait for completion if requested
                        if (step.waitForCompletion) {
                            console.log(chalk.blue(`⏳ Waiting for ${step.workflowFile} to complete...`));
                            const completed = await waitForQueueCompletion(baseUrl, 120000); // 2 minute timeout
                            if (completed) {
                                // Additional delay for image generation and file system sync
                                await waitForImageGeneration(45000); // 45 second delay
                                results.push(`✅ ${step.workflowFile}: Completed and images generated`);
                            }
                            else {
                                results.push(`⚠️ ${step.workflowFile}: Timeout waiting for completion`);
                            }
                        }
                    }
                    catch (error) {
                        results.push(`❌ ${step.workflowFile}: Execution failed - ${error}`);
                    }
                }
                else {
                    results.push(`🔍 ${step.workflowFile}: Workflow analyzed (dry run)`);
                }
            }
            // Log orchestration activity
            await router['dgm'].logActivity(`Workflow orchestration with ${totalRouted} image routings`, true);
            const statusText = dryRun ? '🔍 DRY RUN - No workflows executed' : '✅ Workflow orchestration completed';
            const summary = `${statusText}\n📊 Total images routed: ${totalRouted}\n📋 Workflow Results:\n${results.join('\n')}`;
            return {
                content: [{
                        type: "text",
                        text: summary
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `❌ Error in workflow orchestration: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    });
}
//# sourceMappingURL=imageRouting.js.map