import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
const execAsync = promisify(exec);
// Helper functions
async function executeCommand(command, cwd, timeout = 60000) {
    const startTime = Date.now();
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout,
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        return {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
            duration: Date.now() - startTime
        };
    }
    catch (error) {
        return {
            stdout: error.stdout?.toString() || '',
            stderr: error.stderr?.toString() || error.message,
            exitCode: error.code || 1,
            duration: Date.now() - startTime
        };
    }
}
function extractNodeNameFromUrl(url) {
    // Extract repository name from git URL
    const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
    return match && match[1] ? match[1] : 'unknown-node';
}
async function parseReadmeForDependencies(readmePath) {
    try {
        if (!await fs.pathExists(readmePath)) {
            return [];
        }
        const content = await fs.readFile(readmePath, 'utf-8');
        const dependencies = [];
        // Look for common dependency patterns in README
        const patterns = [
            /pip install\s+([^\n\r]+)/gi,
            /requirements\.txt/gi,
            /install\s+([a-zA-Z0-9\-_]+)/gi,
            /dependency:\s*([^\n\r]+)/gi
        ];
        patterns.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    // Extract package names from pip install commands
                    if (match.includes('pip install')) {
                        const packages = match.replace(/pip install\s+/i, '').split(/\s+/);
                        dependencies.push(...packages.filter(pkg => pkg && !pkg.startsWith('-')));
                    }
                });
            }
        });
        return [...new Set(dependencies)]; // Remove duplicates
    }
    catch (error) {
        console.error(chalk.yellow(`⚠️ Could not parse README: ${error}`));
        return [];
    }
}
async function parseRequirementsFile(requirementsPath) {
    try {
        if (!await fs.pathExists(requirementsPath)) {
            return [];
        }
        const content = await fs.readFile(requirementsPath, 'utf-8');
        return content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
            const parts = line.split('==')[0]?.split('>=')[0]?.split('<=')[0];
            return parts ? parts.trim() : line.trim();
        });
    }
    catch (error) {
        console.error(chalk.yellow(`⚠️ Could not parse requirements.txt: ${error}`));
        return [];
    }
}
async function detectPythonEnvironment(comfyuiPath) {
    // Try to detect the Python environment used by ComfyUI
    const possiblePaths = [
        path.join(comfyuiPath, 'venv', 'Scripts', 'python.exe'), // Windows venv
        path.join(comfyuiPath, 'venv', 'bin', 'python'), // Unix venv
        path.join(comfyuiPath, '.venv', 'Scripts', 'python.exe'), // Windows .venv
        path.join(comfyuiPath, '.venv', 'bin', 'python'), // Unix .venv
        'python' // System python as fallback
    ];
    for (const pythonPath of possiblePaths) {
        try {
            if (pythonPath !== 'python' && await fs.pathExists(pythonPath)) {
                return pythonPath;
            }
            else if (pythonPath === 'python') {
                // Test if system python works
                const result = await executeCommand('python --version');
                if (result.exitCode === 0) {
                    return 'python';
                }
            }
        }
        catch (error) {
            continue;
        }
    }
    return 'python'; // Default fallback
}
async function installDependencies(dependencies, pythonPath, cwd) {
    const errors = [];
    if (dependencies.length === 0) {
        return { success: true, errors: [] };
    }
    console.error(chalk.blue(`📦 Installing ${dependencies.length} dependencies...`));
    for (const dep of dependencies) {
        try {
            const command = `"${pythonPath}" -m pip install "${dep}"`;
            console.error(chalk.yellow(`Installing: ${dep}`));
            const result = await executeCommand(command, cwd, 120000); // 2 minute timeout per package
            if (result.exitCode !== 0) {
                const error = `Failed to install ${dep}: ${result.stderr}`;
                errors.push(error);
                console.error(chalk.red(`❌ ${error}`));
            }
            else {
                console.error(chalk.green(`✅ Installed: ${dep}`));
            }
        }
        catch (error) {
            const errorMsg = `Error installing ${dep}: ${error}`;
            errors.push(errorMsg);
            console.error(chalk.red(`❌ ${errorMsg}`));
        }
    }
    return { success: errors.length === 0, errors };
}
// Register custom node tools
export async function registerCustomNodeTools(server) {
    // Install custom nodes
    server.tool("install_customnodes", "Install custom node via git clone, parse README and requirements, and install dependencies", {
        nodeUrl: z.string().describe("Git URL of the custom node repository"),
        comfyuiPath: z.string().describe("Path to ComfyUI installation directory"),
        nodeName: z.string().optional().describe("Custom name for the node (auto-detected if not provided)"),
        skipDependencies: z.boolean().default(false).describe("Skip automatic dependency installation"),
        forceReinstall: z.boolean().default(false).describe("Force reinstall if node already exists")
    }, async ({ nodeUrl, comfyuiPath, nodeName, skipDependencies, forceReinstall }) => {
        const startTime = Date.now();
        const result = {
            success: false,
            nodeName: nodeName || extractNodeNameFromUrl(nodeUrl),
            installPath: '',
            dependencies: [],
            errors: [],
            warnings: [],
            duration: 0
        };
        try {
            console.error(chalk.blue(`🔧 Installing custom node: ${nodeUrl}`));
            // Validate ComfyUI path
            if (!await fs.pathExists(comfyuiPath)) {
                throw new Error(`ComfyUI path does not exist: ${comfyuiPath}`);
            }
            const customNodesPath = path.join(comfyuiPath, 'custom_nodes');
            if (!await fs.pathExists(customNodesPath)) {
                await fs.ensureDir(customNodesPath);
                console.error(chalk.yellow(`📁 Created custom_nodes directory: ${customNodesPath}`));
            }
            result.installPath = path.join(customNodesPath, result.nodeName);
            // Check if node already exists
            if (await fs.pathExists(result.installPath)) {
                if (!forceReinstall) {
                    throw new Error(`Custom node already exists at ${result.installPath}. Use forceReinstall=true to overwrite.`);
                }
                else {
                    console.error(chalk.yellow(`🗑️ Removing existing installation: ${result.installPath}`));
                    await fs.remove(result.installPath);
                }
            }
            // Clone the repository
            console.error(chalk.blue(`📥 Cloning repository...`));
            const cloneResult = await executeCommand(`git clone "${nodeUrl}" "${result.nodeName}"`, customNodesPath, 300000); // 5 minute timeout
            if (cloneResult.exitCode !== 0) {
                throw new Error(`Git clone failed: ${cloneResult.stderr}`);
            }
            console.error(chalk.green(`✅ Repository cloned successfully`));
            // Parse dependencies if not skipping
            if (!skipDependencies) {
                console.error(chalk.blue(`🔍 Analyzing dependencies...`));
                // Check for requirements.txt
                const requirementsPath = path.join(result.installPath, 'requirements.txt');
                const requirementsDeps = await parseRequirementsFile(requirementsPath);
                // Parse README for additional dependencies
                const readmePaths = [
                    path.join(result.installPath, 'README.md'),
                    path.join(result.installPath, 'readme.md'),
                    path.join(result.installPath, 'README.txt')
                ];
                let readmeDeps = [];
                for (const readmePath of readmePaths) {
                    if (await fs.pathExists(readmePath)) {
                        readmeDeps = await parseReadmeForDependencies(readmePath);
                        break;
                    }
                }
                // Combine and deduplicate dependencies
                result.dependencies = [...new Set([...requirementsDeps, ...readmeDeps])];
                if (result.dependencies.length > 0) {
                    console.error(chalk.blue(`📦 Found ${result.dependencies.length} dependencies: ${result.dependencies.join(', ')}`));
                    // Detect Python environment
                    const pythonPath = await detectPythonEnvironment(comfyuiPath);
                    console.error(chalk.blue(`🐍 Using Python: ${pythonPath}`));
                    // Install dependencies
                    const installResult = await installDependencies(result.dependencies, pythonPath, result.installPath);
                    result.errors.push(...installResult.errors);
                    if (!installResult.success) {
                        result.warnings.push(`Some dependencies failed to install. The node may not work correctly.`);
                    }
                }
                else {
                    console.error(chalk.yellow(`⚠️ No dependencies found`));
                }
            }
            result.success = true;
            result.duration = Date.now() - startTime;
            console.error(chalk.green(`🎉 Custom node installation completed in ${result.duration}ms`));
            const output = [
                `✅ Custom Node Installation Complete`,
                ``,
                `Node Name: ${result.nodeName}`,
                `Install Path: ${result.installPath}`,
                `Repository: ${nodeUrl}`,
                `Duration: ${result.duration}ms`,
                ``,
                `Dependencies: ${result.dependencies.length > 0 ? result.dependencies.join(', ') : 'None found'}`,
                ``,
                result.errors.length > 0 ? `❌ Errors:\n${result.errors.map(e => `  - ${e}`).join('\n')}` : '',
                result.warnings.length > 0 ? `⚠️ Warnings:\n${result.warnings.map(w => `  - ${w}`).join('\n')}` : '',
                ``,
                `🔄 Please restart ComfyUI to load the new custom node.`
            ].filter(line => line !== '').join('\n');
            return {
                content: [{
                        type: "text",
                        text: output
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push(errorMsg);
            result.duration = Date.now() - startTime;
            console.error(chalk.red(`❌ Installation failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `❌ Custom Node Installation Failed\n\nNode: ${result.nodeName}\nError: ${errorMsg}\nDuration: ${result.duration}ms`
                    }],
                isError: true
            };
        }
    });
    // List installed custom nodes
    server.tool("list_custom_nodes", "List all installed custom nodes with their information", {
        comfyuiPath: z.string().describe("Path to ComfyUI installation directory"),
        detailed: z.boolean().default(false).describe("Show detailed information including dependencies")
    }, async ({ comfyuiPath, detailed }) => {
        try {
            console.error(chalk.blue(`📋 Listing custom nodes in: ${comfyuiPath}`));
            const customNodesPath = path.join(comfyuiPath, 'custom_nodes');
            if (!await fs.pathExists(customNodesPath)) {
                return {
                    content: [{
                            type: "text",
                            text: `No custom_nodes directory found at: ${customNodesPath}`
                        }]
                };
            }
            const items = await fs.readdir(customNodesPath);
            const nodes = [];
            for (const item of items) {
                const itemPath = path.join(customNodesPath, item);
                const stats = await fs.stat(itemPath);
                if (stats.isDirectory() && !item.startsWith('.')) {
                    const nodeInfo = {
                        name: item,
                        path: itemPath,
                        lastModified: stats.mtime.toISOString().split('T')[0]
                    };
                    if (detailed) {
                        // Try to get git info
                        try {
                            const gitResult = await executeCommand('git remote get-url origin', itemPath);
                            if (gitResult.exitCode === 0) {
                                nodeInfo.repository = gitResult.stdout.trim();
                            }
                        }
                        catch (error) {
                            nodeInfo.repository = 'Unknown';
                        }
                        // Check for requirements.txt
                        const requirementsPath = path.join(itemPath, 'requirements.txt');
                        if (await fs.pathExists(requirementsPath)) {
                            nodeInfo.dependencies = await parseRequirementsFile(requirementsPath);
                        }
                        else {
                            nodeInfo.dependencies = [];
                        }
                        // Check for README
                        const readmePaths = [
                            path.join(itemPath, 'README.md'),
                            path.join(itemPath, 'readme.md'),
                            path.join(itemPath, 'README.txt')
                        ];
                        for (const readmePath of readmePaths) {
                            if (await fs.pathExists(readmePath)) {
                                nodeInfo.hasReadme = true;
                                break;
                            }
                        }
                        nodeInfo.hasReadme = nodeInfo.hasReadme || false;
                    }
                    nodes.push(nodeInfo);
                }
            }
            if (nodes.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `No custom nodes found in: ${customNodesPath}`
                        }]
                };
            }
            let output = `📋 Found ${nodes.length} custom nodes:\n\n`;
            if (detailed) {
                nodes.forEach(node => {
                    output += `🔧 ${node.name}\n`;
                    output += `   Path: ${node.path}\n`;
                    output += `   Repository: ${node.repository || 'Unknown'}\n`;
                    output += `   Last Modified: ${node.lastModified}\n`;
                    output += `   Dependencies: ${node.dependencies.length > 0 ? node.dependencies.join(', ') : 'None'}\n`;
                    output += `   Has README: ${node.hasReadme ? 'Yes' : 'No'}\n\n`;
                });
            }
            else {
                nodes.forEach(node => {
                    output += `  - ${node.name} (${node.lastModified})\n`;
                });
            }
            return {
                content: [{
                        type: "text",
                        text: output
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to list custom nodes: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Update custom node
    server.tool("update_custom_node", "Update an installed custom node by pulling latest changes from git", {
        comfyuiPath: z.string().describe("Path to ComfyUI installation directory"),
        nodeName: z.string().describe("Name of the custom node to update"),
        updateDependencies: z.boolean().default(true).describe("Also update dependencies after git pull")
    }, async ({ comfyuiPath, nodeName, updateDependencies }) => {
        try {
            console.error(chalk.blue(`🔄 Updating custom node: ${nodeName}`));
            const nodePath = path.join(comfyuiPath, 'custom_nodes', nodeName);
            if (!await fs.pathExists(nodePath)) {
                throw new Error(`Custom node not found: ${nodePath}`);
            }
            // Check if it's a git repository
            const gitDir = path.join(nodePath, '.git');
            if (!await fs.pathExists(gitDir)) {
                throw new Error(`${nodeName} is not a git repository. Cannot update.`);
            }
            // Pull latest changes
            console.error(chalk.blue(`📥 Pulling latest changes...`));
            const pullResult = await executeCommand('git pull', nodePath, 120000);
            if (pullResult.exitCode !== 0) {
                throw new Error(`Git pull failed: ${pullResult.stderr}`);
            }
            let dependencyResult = { success: true, errors: [] };
            if (updateDependencies) {
                console.error(chalk.blue(`📦 Updating dependencies...`));
                // Parse requirements.txt
                const requirementsPath = path.join(nodePath, 'requirements.txt');
                const dependencies = await parseRequirementsFile(requirementsPath);
                if (dependencies.length > 0) {
                    const pythonPath = await detectPythonEnvironment(comfyuiPath);
                    dependencyResult = await installDependencies(dependencies, pythonPath, nodePath);
                }
            }
            const output = [
                `✅ Custom Node Update Complete`,
                ``,
                `Node: ${nodeName}`,
                `Path: ${nodePath}`,
                ``,
                `Git Output:`,
                pullResult.stdout || '(no output)',
                ``,
                updateDependencies ? `Dependencies: ${dependencyResult.success ? 'Updated successfully' : 'Some errors occurred'}` : 'Dependencies: Skipped',
                dependencyResult.errors.length > 0 ? `\n❌ Dependency Errors:\n${dependencyResult.errors.map(e => `  - ${e}`).join('\n')}` : '',
                ``,
                `🔄 Please restart ComfyUI to load the updated node.`
            ].filter(line => line !== '').join('\n');
            return {
                content: [{
                        type: "text",
                        text: output
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Update failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `❌ Custom Node Update Failed\n\nNode: ${nodeName}\nError: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Remove custom node
    server.tool("remove_custom_node", "Remove an installed custom node completely", {
        comfyuiPath: z.string().describe("Path to ComfyUI installation directory"),
        nodeName: z.string().describe("Name of the custom node to remove"),
        confirmRemoval: z.boolean().default(false).describe("Confirm that you want to permanently delete the node")
    }, async ({ comfyuiPath, nodeName, confirmRemoval }) => {
        try {
            if (!confirmRemoval) {
                return {
                    content: [{
                            type: "text",
                            text: `⚠️ Removal not confirmed. Set confirmRemoval=true to permanently delete the custom node: ${nodeName}`
                        }]
                };
            }
            console.error(chalk.blue(`🗑️ Removing custom node: ${nodeName}`));
            const nodePath = path.join(comfyuiPath, 'custom_nodes', nodeName);
            if (!await fs.pathExists(nodePath)) {
                throw new Error(`Custom node not found: ${nodePath}`);
            }
            // Remove the directory
            await fs.remove(nodePath);
            console.error(chalk.green(`✅ Custom node removed: ${nodeName}`));
            return {
                content: [{
                        type: "text",
                        text: `✅ Custom Node Removed\n\nNode: ${nodeName}\nPath: ${nodePath}\n\n🔄 Please restart ComfyUI to complete the removal.`
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Removal failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `❌ Custom Node Removal Failed\n\nNode: ${nodeName}\nError: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Check custom node status
    server.tool("check_custom_node_status", "Check the status and health of a specific custom node", {
        comfyuiPath: z.string().describe("Path to ComfyUI installation directory"),
        nodeName: z.string().describe("Name of the custom node to check")
    }, async ({ comfyuiPath, nodeName }) => {
        try {
            console.error(chalk.blue(`🔍 Checking status of: ${nodeName}`));
            const nodePath = path.join(comfyuiPath, 'custom_nodes', nodeName);
            if (!await fs.pathExists(nodePath)) {
                throw new Error(`Custom node not found: ${nodePath}`);
            }
            const status = {
                name: nodeName,
                path: nodePath,
                exists: true,
                isGitRepo: false,
                hasRequirements: false,
                hasReadme: false,
                lastModified: '',
                gitStatus: '',
                dependencies: []
            };
            // Get basic file info
            const stats = await fs.stat(nodePath);
            status.lastModified = stats.mtime.toISOString();
            // Check if it's a git repository
            const gitDir = path.join(nodePath, '.git');
            status.isGitRepo = await fs.pathExists(gitDir);
            if (status.isGitRepo) {
                try {
                    const gitResult = await executeCommand('git status --porcelain', nodePath);
                    status.gitStatus = gitResult.stdout.trim() || 'Clean';
                    // Get remote URL
                    const remoteResult = await executeCommand('git remote get-url origin', nodePath);
                    if (remoteResult.exitCode === 0) {
                        status.repository = remoteResult.stdout.trim();
                    }
                }
                catch (error) {
                    status.gitStatus = 'Error checking git status';
                }
            }
            // Check for requirements.txt
            const requirementsPath = path.join(nodePath, 'requirements.txt');
            status.hasRequirements = await fs.pathExists(requirementsPath);
            if (status.hasRequirements) {
                status.dependencies = await parseRequirementsFile(requirementsPath);
            }
            // Check for README
            const readmePaths = [
                path.join(nodePath, 'README.md'),
                path.join(nodePath, 'readme.md'),
                path.join(nodePath, 'README.txt')
            ];
            for (const readmePath of readmePaths) {
                if (await fs.pathExists(readmePath)) {
                    status.hasReadme = true;
                    status.readmePath = readmePath;
                    break;
                }
            }
            const output = [
                `🔍 Custom Node Status: ${status.name}`,
                ``,
                `📁 Path: ${status.path}`,
                `📅 Last Modified: ${status.lastModified}`,
                `🔗 Git Repository: ${status.isGitRepo ? 'Yes' : 'No'}`,
                status.repository ? `📡 Repository URL: ${status.repository}` : '',
                status.isGitRepo ? `📊 Git Status: ${status.gitStatus}` : '',
                `📋 Has Requirements: ${status.hasRequirements ? 'Yes' : 'No'}`,
                `📖 Has README: ${status.hasReadme ? 'Yes' : 'No'}`,
                status.hasReadme ? `📄 README Path: ${status.readmePath}` : '',
                `📦 Dependencies: ${status.dependencies.length > 0 ? status.dependencies.join(', ') : 'None'}`,
                ``,
                `✅ Node appears to be properly installed`
            ].filter(line => line !== '').join('\n');
            return {
                content: [{
                        type: "text",
                        text: output
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `❌ Status Check Failed\n\nNode: ${nodeName}\nError: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    console.error(chalk.green("✅ Custom node tools registered"));
}
//# sourceMappingURL=customNodes.js.map