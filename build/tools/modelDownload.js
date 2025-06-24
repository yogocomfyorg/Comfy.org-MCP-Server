import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import chalk from "chalk";
// Helper functions
async function downloadFile(url, outputPath, onProgress) {
    let retries = 3;
    let lastError = null;
    while (retries > 0) {
        try {
            console.error(chalk.blue(`🔗 Attempting download from: ${url}`));
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 300000, // 5 minutes timeout
                maxRedirects: 10, // Handle HuggingFace redirects
                headers: {
                    'User-Agent': 'ComfyUI-MCP-Server/1.0.0',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br'
                },
                validateStatus: (status) => status >= 200 && status < 400
            });
            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;
            const startTime = Date.now();
            console.error(chalk.blue(`📊 Expected file size: ${formatBytes(totalSize)}`));
            // Ensure output directory exists
            await fs.ensureDir(path.dirname(outputPath));
            const writer = createWriteStream(outputPath);
            // Handle stream errors
            writer.on('error', (error) => {
                throw new Error(`Write stream error: ${error.message}`);
            });
            response.data.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (onProgress && totalSize > 0) {
                    const percentage = (downloadedSize / totalSize) * 100;
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = downloadedSize / elapsed;
                    const speedStr = formatBytes(speed) + '/s';
                    onProgress({
                        downloaded: downloadedSize,
                        total: totalSize,
                        percentage,
                        speed: speedStr
                    });
                }
            });
            response.data.on('error', (error) => {
                throw new Error(`Download stream error: ${error.message}`);
            });
            await pipeline(response.data, writer);
            // Verify file was written correctly
            const stats = await fs.stat(outputPath);
            const actualSize = stats.size;
            console.error(chalk.blue(`✅ Download completed. Actual size: ${formatBytes(actualSize)}`));
            if (actualSize === 0) {
                throw new Error('Downloaded file is empty (0 bytes)');
            }
            if (totalSize > 0 && Math.abs(actualSize - totalSize) > 1024) { // Allow 1KB difference
                console.error(chalk.yellow(`⚠️ Size mismatch: expected ${formatBytes(totalSize)}, got ${formatBytes(actualSize)}`));
            }
            return actualSize;
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            retries--;
            console.error(chalk.red(`❌ Download attempt failed: ${lastError.message}`));
            if (retries > 0) {
                console.error(chalk.yellow(`🔄 Retrying... (${retries} attempts remaining)`));
                // Clean up partial file
                try {
                    if (await fs.pathExists(outputPath)) {
                        await fs.remove(outputPath);
                    }
                }
                catch (cleanupError) {
                    console.error(chalk.yellow(`⚠️ Failed to clean up partial file: ${cleanupError}`));
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    throw lastError || new Error('Download failed after all retries');
}
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
async function getHuggingFaceModelInfo(modelId, filename) {
    const apiUrl = `https://huggingface.co/api/models/${modelId}`;
    const response = await axios.get(apiUrl);
    const model = response.data;
    const files = model.siblings || [];
    let targetFile = files.find((f) => f.rfilename === filename);
    if (!targetFile && files.length > 0) {
        // Default to first .safetensors or .ckpt file
        targetFile = files.find((f) => f.rfilename.endsWith('.safetensors') || f.rfilename.endsWith('.ckpt')) || files[0];
    }
    if (!targetFile) {
        throw new Error(`No suitable file found for model ${modelId}`);
    }
    return {
        name: targetFile.rfilename,
        size: targetFile.size || 0,
        downloadUrl: `https://huggingface.co/${modelId}/resolve/main/${targetFile.rfilename}`,
        modelType: detectModelType(targetFile.rfilename),
        description: model.description
    };
}
function detectModelType(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('vae'))
        return 'vae';
    if (lower.includes('lora'))
        return 'lora';
    if (lower.includes('controlnet'))
        return 'controlnet';
    if (lower.includes('upscale'))
        return 'upscale';
    if (lower.includes('clip'))
        return 'clip';
    if (lower.includes('unet'))
        return 'unet';
    return 'checkpoint';
}
function getModelDirectory(modelType, baseDir) {
    const typeMap = {
        'checkpoint': 'checkpoints',
        'vae': 'vae',
        'lora': 'loras',
        'controlnet': 'controlnet',
        'upscale': 'upscale_models',
        'clip': 'clip',
        'unet': 'unet'
    };
    return path.join(baseDir, 'models', typeMap[modelType] || 'checkpoints');
}
// Register model download tools
export async function registerModelDownloadTools(server) {
    // Download HuggingFace model
    server.tool("download_huggingface_model", "Download a model from HuggingFace Hub", {
        modelId: z.string().describe("HuggingFace model ID (e.g., 'runwayml/stable-diffusion-v1-5')"),
        filename: z.string().optional().describe("Specific filename to download (optional)"),
        outputDir: z.string().describe("Output directory for the model"),
        overwrite: z.boolean().default(false).describe("Overwrite existing file if it exists")
    }, async ({ modelId, filename, outputDir, overwrite }) => {
        try {
            console.error(chalk.blue(`📥 Downloading HuggingFace model: ${modelId}`));
            const modelInfo = await getHuggingFaceModelInfo(modelId, filename);
            const targetDir = getModelDirectory(modelInfo.modelType, outputDir);
            const outputPath = path.join(targetDir, modelInfo.name);
            // Check if file already exists
            if (await fs.pathExists(outputPath) && !overwrite) {
                return {
                    content: [{
                            type: "text",
                            text: `Model already exists at ${outputPath}. Use overwrite=true to replace it.`
                        }]
                };
            }
            let lastProgress = 0;
            const actualSize = await downloadFile(modelInfo.downloadUrl, outputPath, (progress) => {
                if (progress.percentage - lastProgress >= 10) {
                    console.error(chalk.yellow(`📊 Progress: ${progress.percentage.toFixed(1)}% (${progress.speed})`));
                    lastProgress = progress.percentage;
                }
            });
            console.error(chalk.green(`✅ Downloaded: ${modelInfo.name}`));
            return {
                content: [{
                        type: "text",
                        text: `Successfully downloaded ${modelInfo.name} to ${outputPath}\nExpected Size: ${formatBytes(modelInfo.size)}\nActual Size: ${formatBytes(actualSize)}\nType: ${modelInfo.modelType}`
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Download failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `Failed to download model: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // List installed models
    server.tool("list_installed_models", "List all installed models by type", {
        modelsDir: z.string().describe("Models directory path"),
        modelType: z.string().optional().describe("Filter by model type (checkpoint, lora, vae, etc.)")
    }, async ({ modelsDir, modelType }) => {
        try {
            const modelTypes = modelType ? [modelType] :
                ['checkpoints', 'loras', 'vae', 'controlnet', 'upscale_models', 'clip', 'unet'];
            const results = {};
            for (const type of modelTypes) {
                const typeDir = path.join(modelsDir, 'models', type);
                if (await fs.pathExists(typeDir)) {
                    const files = await fs.readdir(typeDir);
                    results[type] = files.filter(f => f.endsWith('.safetensors') ||
                        f.endsWith('.ckpt') ||
                        f.endsWith('.pt') ||
                        f.endsWith('.pth'));
                }
                else {
                    results[type] = [];
                }
            }
            const summary = Object.entries(results)
                .map(([type, files]) => `${type}: ${files.length} models`)
                .join('\n');
            const detailed = Object.entries(results)
                .map(([type, files]) => {
                if (files.length === 0)
                    return `\n${type.toUpperCase()}:\n  No models found`;
                return `\n${type.toUpperCase()}:\n${files.map(f => `  - ${f}`).join('\n')}`;
            })
                .join('\n');
            return {
                content: [{
                        type: "text",
                        text: `Model Summary:\n${summary}\n\nDetailed List:${detailed}`
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to list models: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    console.error(chalk.green("✅ Model download tools registered"));
}
//# sourceMappingURL=modelDownload.js.map