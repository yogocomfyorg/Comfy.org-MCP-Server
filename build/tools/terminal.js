import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
const execAsync = promisify(exec);
// Helper functions
async function executeCommand(command, cwd, timeout = 30000) {
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
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
async function getSystemInfo() {
    const os = await import('os');
    return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        totalMemory: formatBytes(os.totalmem()),
        freeMemory: formatBytes(os.freemem()),
        cpuCount: os.cpus().length
    };
}
async function checkDiskSpace(directory) {
    try {
        const stats = await fs.stat(directory);
        if (stats.isDirectory()) {
            // Use platform-specific commands to get disk space
            const isWindows = process.platform === 'win32';
            const command = isWindows
                ? `dir /-c "${directory}"`
                : `df -h "${directory}"`;
            const result = await executeCommand(command);
            if (isWindows) {
                // Parse Windows dir output
                const lines = result.stdout.split('\n');
                const lastLine = lines[lines.length - 2] || '';
                const match = lastLine.match(/(\d+)\s+bytes\s+free/);
                const freeBytes = match && match[1] ? parseInt(match[1].replace(/,/g, '')) : 0;
                return {
                    free: formatBytes(freeBytes),
                    total: 'Unknown',
                    used: 'Unknown'
                };
            }
            else {
                // Parse Unix df output
                const lines = result.stdout.split('\n');
                const dataLine = lines[1] || '';
                const parts = dataLine.split(/\s+/);
                return {
                    total: parts[1] || 'Unknown',
                    used: parts[2] || 'Unknown',
                    free: parts[3] || 'Unknown'
                };
            }
        }
        return { free: 'Unknown', total: 'Unknown', used: 'Unknown' };
    }
    catch (error) {
        return { free: 'Error', total: 'Error', used: 'Error' };
    }
}
// Intelligent ComfyUI installation detection
async function detectComfyUIInstallationType(searchPath) {
    const absolutePath = path.resolve(searchPath);
    // Check if directory exists
    if (!fs.existsSync(absolutePath)) {
        return {
            found: false,
            type: 'unknown',
            path: absolutePath,
            command: '',
            workingDirectory: '',
            description: 'Directory not found'
        };
    }
    // 1. Check for batch files (highest priority)
    const batFiles = await fs.readdir(absolutePath).then(files => files.filter(file => file.toLowerCase().endsWith('.bat') &&
        (file.toLowerCase().includes('launch') || file.toLowerCase().includes('run') || file.toLowerCase().includes('comfy')))).catch(() => []);
    if (batFiles.length > 0) {
        const batFile = batFiles[0]; // Use first found batch file (we know it exists)
        const batPath = path.join(absolutePath, batFile);
        return {
            found: true,
            type: 'batch',
            path: batPath,
            command: `& "${batPath}"`,
            workingDirectory: absolutePath,
            description: `Batch file installation: ${batFile}`
        };
    }
    // 2. Check for venv + main.py (ComfyUI with virtual environment in subdirectory)
    const comfyUIPath = path.join(absolutePath, 'ComfyUI');
    const venvPythonPath = path.join(comfyUIPath, 'venv', 'Scripts', 'python.exe');
    const mainPyPath = path.join(comfyUIPath, 'main.py');
    if (await fs.pathExists(venvPythonPath) && await fs.pathExists(mainPyPath)) {
        return {
            found: true,
            type: 'venv',
            path: venvPythonPath,
            command: `& "${venvPythonPath}" -s main.py --fast --windows-standalone-build`,
            workingDirectory: comfyUIPath,
            description: `Virtual environment installation: ${comfyUIPath}`
        };
    }
    return {
        found: false,
        type: 'unknown',
        path: absolutePath,
        command: '',
        workingDirectory: '',
        description: 'No ComfyUI installation detected. Expected structure: batch file OR ComfyUI/venv/Scripts/python.exe + ComfyUI/main.py'
    };
}
// Register terminal tools
export async function registerTerminalTools(server) {
    // Execute command
    server.tool("execute_command", "Execute a shell command safely with timeout and output capture", {
        command: z.string().describe("Command to execute"),
        workingDirectory: z.string().optional().describe("Working directory for command execution"),
        timeout: z.number().default(30000).describe("Timeout in milliseconds (default: 30000)")
    }, async ({ command, workingDirectory, timeout }) => {
        try {
            console.error(chalk.blue(`🔧 Executing command: ${command}`));
            const result = await executeCommand(command, workingDirectory, timeout);
            const output = [
                `Command: ${command}`,
                `Exit Code: ${result.exitCode}`,
                `Duration: ${result.duration}ms`,
                `Working Directory: ${workingDirectory || process.cwd()}`,
                '',
                'STDOUT:',
                result.stdout || '(no output)',
                '',
                'STDERR:',
                result.stderr || '(no errors)'
            ].join('\n');
            if (result.exitCode === 0) {
                console.error(chalk.green(`✅ Command completed successfully`));
            }
            else {
                console.error(chalk.red(`❌ Command failed with exit code ${result.exitCode}`));
            }
            return {
                content: [{
                        type: "text",
                        text: output
                    }],
                isError: result.exitCode !== 0
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Command execution failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `Failed to execute command: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Create directory
    server.tool("create_directory", "Create directories with proper permissions", {
        path: z.string().describe("Directory path to create"),
        recursive: z.boolean().default(true).describe("Create parent directories if they don't exist")
    }, async ({ path: dirPath, recursive }) => {
        try {
            if (recursive) {
                await fs.ensureDir(dirPath);
            }
            else {
                await fs.mkdir(dirPath);
            }
            console.error(chalk.green(`✅ Created directory: ${dirPath}`));
            return {
                content: [{
                        type: "text",
                        text: `Successfully created directory: ${dirPath}`
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Failed to create directory: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `Failed to create directory: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // List directory
    server.tool("list_directory", "List directory contents with detailed information", {
        path: z.string().describe("Directory path to list"),
        detailed: z.boolean().default(false).describe("Show detailed file information"),
        includeHidden: z.boolean().default(false).describe("Include hidden files")
    }, async ({ path: dirPath, detailed, includeHidden }) => {
        try {
            const items = await fs.readdir(dirPath);
            const filteredItems = includeHidden ? items : items.filter(item => !item.startsWith('.'));
            if (!detailed) {
                return {
                    content: [{
                            type: "text",
                            text: `Contents of ${dirPath}:\n${filteredItems.join('\n')}`
                        }]
                };
            }
            const detailedItems = await Promise.all(filteredItems.map(async (item) => {
                try {
                    const itemPath = path.join(dirPath, item);
                    const stats = await fs.stat(itemPath);
                    const type = stats.isDirectory() ? 'DIR' : 'FILE';
                    const size = stats.isFile() ? formatBytes(stats.size) : '-';
                    const modified = stats.mtime.toISOString().split('T')[0];
                    return `${type.padEnd(4)} ${size.padEnd(10)} ${modified} ${item}`;
                }
                catch {
                    return `ERR  -          -          ${item}`;
                }
            }));
            const output = [
                `Contents of ${dirPath}:`,
                'TYPE SIZE       MODIFIED   NAME',
                '---- ---------- ---------- ----',
                ...detailedItems
            ].join('\n');
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
                        text: `Failed to list directory: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Check disk space
    server.tool("check_disk_space", "Check available disk space for a directory", {
        path: z.string().describe("Directory path to check")
    }, async ({ path: dirPath }) => {
        try {
            const diskInfo = await checkDiskSpace(dirPath);
            const systemInfo = await getSystemInfo();
            const output = [
                `Disk Space Information for: ${dirPath}`,
                '',
                `Total: ${diskInfo.total}`,
                `Used:  ${diskInfo.used}`,
                `Free:  ${diskInfo.free}`,
                '',
                'System Information:',
                `Platform: ${systemInfo.platform} (${systemInfo.arch})`,
                `Node.js: ${systemInfo.nodeVersion}`,
                `CPU Cores: ${systemInfo.cpuCount}`,
                `Total Memory: ${systemInfo.totalMemory}`,
                `Free Memory: ${systemInfo.freeMemory}`
            ].join('\n');
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
                        text: `Failed to check disk space: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Start ComfyUI in terminal (enhanced tool with intelligent installation detection)
    server.tool("start_comfyui_in_terminal", "Intelligently detect ComfyUI installation type and launch using appropriate method (bat file, venv + python, or portable)", {
        sandboxPath: z.string().optional().describe("Path to ComfyUI directory (default: sandbox/ComfyUI_Sandbox_CUDA126)"),
        autoLaunch: z.boolean().default(true).describe("Automatically launch ComfyUI (default: true)"),
        forceRestart: z.boolean().default(false).describe("Force restart even if ComfyUI is already running"),
        useTerminal: z.boolean().default(true).describe("Use VS Code terminal for visible output (true) or background process (false)"),
        waitForStartup: z.boolean().default(true).describe("Wait and verify ComfyUI server startup (default: true)")
    }, async ({ sandboxPath, autoLaunch, forceRestart, useTerminal }) => {
        try {
            const defaultSandboxPath = "sandbox/ComfyUI_Sandbox_CUDA126";
            const actualSandboxPath = sandboxPath || defaultSandboxPath;
            // Intelligent installation detection
            const detectionResult = await detectComfyUIInstallationType(actualSandboxPath);
            if (!detectionResult.found) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ ComfyUI installation not found in: ${actualSandboxPath}\n\n` +
                                `Expected directory structure:\n` +
                                `sandbox/ComfyUI_Sandbox_CUDA126/\n` +
                                `├── Launch_ComfyUI_CUDA126.bat          # Batch file (highest priority)\n` +
                                `└── ComfyUI/\n` +
                                `    ├── main.py                         # ComfyUI entry point\n` +
                                `    └── venv/Scripts/python.exe         # Virtual environment\n\n` +
                                `Please ensure ComfyUI is installed with this structure.`
                        }],
                    isError: true
                };
            }
            // Check if ComfyUI is already running
            let isAlreadyRunning = false;
            try {
                const response = await fetch('http://127.0.0.1:8188/queue', {
                    method: 'GET',
                    signal: AbortSignal.timeout(3000)
                });
                if (response.ok) {
                    isAlreadyRunning = true;
                }
            }
            catch (error) {
                // ComfyUI is not running, which is expected
            }
            if (isAlreadyRunning && !forceRestart) {
                return {
                    content: [{
                            type: "text",
                            text: `✅ ComfyUI is already running at http://127.0.0.1:8188\n\n` +
                                `🔄 Use forceRestart: true to restart the server if needed.\n` +
                                `🌐 You can now use other ComfyUI MCP tools to interact with the server.`
                        }]
                };
            }
            // If force restart is requested, kill existing processes first
            if (forceRestart && isAlreadyRunning) {
                try {
                    const { exec } = await import('child_process');
                    const util = await import('util');
                    const execAsync = util.promisify(exec);
                    console.error(chalk.yellow(`🔄 Force restart requested - cleaning up existing processes...`));
                    // Kill existing ComfyUI processes
                    await execAsync('taskkill /F /IM python.exe /FI "WINDOWTITLE eq ComfyUI*"').catch(() => { });
                    await execAsync('wmic process where "commandline like \'%ComfyUI%\'" delete').catch(() => { });
                    // Wait for cleanup
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    console.error(chalk.green(`✅ Cleanup completed`));
                }
                catch (error) {
                    console.error(chalk.yellow(`⚠️ Warning: Could not clean up existing processes: ${error}`));
                }
            }
            if (!autoLaunch) {
                if (useTerminal) {
                    return {
                        content: [{
                                type: "text",
                                text: `🚀 Ready to start ComfyUI in VS Code terminal!\n\n` +
                                    `🔍 **Detected Installation:** ${detectionResult.description}\n` +
                                    `📁 Installation Type: ${detectionResult.type.toUpperCase()}\n` +
                                    `📂 Working Directory: ${detectionResult.workingDirectory}\n` +
                                    `🌐 Server will be available at: http://127.0.0.1:8188\n\n` +
                                    `🎯 **NEXT STEP**: Use the Augment launch-process tool with these exact parameters:\n\n` +
                                    `**Command:** \`${detectionResult.command}\`\n` +
                                    `**Wait:** \`false\`\n` +
                                    `**Max Wait Seconds:** \`60\`\n` +
                                    `**Working Directory:** \`${detectionResult.workingDirectory}\`\n\n` +
                                    `📋 This will show ComfyUI startup progress in the VS Code terminal.\n` +
                                    `⏳ Server should be ready in 30-60 seconds.\n` +
                                    `💡 You'll see all ComfyUI logs and startup progress in real-time.\n\n` +
                                    `✨ **Example Augment launch-process call:**\n` +
                                    `\`\`\`\n` +
                                    `launch-process:\n` +
                                    `  command: "${detectionResult.command}"\n` +
                                    `  wait: false\n` +
                                    `  max_wait_seconds: 60\n` +
                                    `  cwd: "${detectionResult.workingDirectory}"\n` +
                                    `\`\`\`\n\n` +
                                    `Or call this tool again with autoLaunch: true to start automatically.`
                            }]
                    };
                }
                else {
                    return {
                        content: [{
                                type: "text",
                                text: `🚀 Ready to start ComfyUI in background!\n\n` +
                                    `🔍 **Detected Installation:** ${detectionResult.description}\n` +
                                    `📁 Installation Type: ${detectionResult.type.toUpperCase()}\n` +
                                    `📂 Working Directory: ${detectionResult.workingDirectory}\n` +
                                    `🌐 Server will be available at: http://127.0.0.1:8188\n\n` +
                                    `💡 Call this tool again with autoLaunch: true to start automatically.`
                            }]
                    };
                }
            }
            // Auto-launch ComfyUI
            console.error(chalk.blue(`🚀 Auto-launching ComfyUI: ${detectionResult.description}`));
            if (useTerminal) {
                // Use terminal mode - provide PowerShell command for VS Code terminal execution
                console.error(chalk.cyan(`📋 Terminal mode: Providing ${detectionResult.type} startup command for VS Code terminal...`));
                const workingDirectory = path.resolve(detectionResult.workingDirectory);
                return {
                    content: [{
                            type: "text",
                            text: `🚀 Ready to start ComfyUI with visible terminal output!\n\n` +
                                `🔍 **Detected Installation:** ${detectionResult.description}\n` +
                                `📁 Installation Type: ${detectionResult.type.toUpperCase()}\n` +
                                `📂 Working directory: ${workingDirectory}\n` +
                                `🌐 Server will be available at: http://127.0.0.1:8188\n\n` +
                                `🎯 **NEXT STEP**: Use the Augment launch-process tool with these exact parameters:\n\n` +
                                `**Command:** \`${detectionResult.command}\`\n` +
                                `**Wait:** \`false\`\n` +
                                `**Max Wait Seconds:** \`60\`\n` +
                                `**Working Directory:** \`${workingDirectory}\`\n\n` +
                                `📋 This will show ComfyUI startup progress in the VS Code terminal.\n` +
                                `⏳ Server should be ready in 30-60 seconds.\n` +
                                `💡 You'll see all ComfyUI logs and startup progress in real-time.\n` +
                                `🔄 After startup, you can use other ComfyUI MCP tools to interact with the server.\n\n` +
                                `🔧 **Troubleshooting**: If the tool fails again, try with forceRestart: true\n\n` +
                                `✨ **Example Augment launch-process call:**\n` +
                                `\`\`\`\n` +
                                `launch-process:\n` +
                                `  command: "${detectionResult.command}"\n` +
                                `  wait: false\n` +
                                `  max_wait_seconds: 60\n` +
                                `  cwd: "${workingDirectory}"\n` +
                                `\`\`\``
                        }]
                };
            }
            else {
                // Background mode - provide instructions for background execution
                console.error(chalk.cyan(`🔇 Background mode: Providing ${detectionResult.type} startup command for background execution...`));
                const workingDirectory = path.resolve(detectionResult.workingDirectory);
                let backgroundCommand = '';
                if (detectionResult.type === 'batch') {
                    backgroundCommand = `Start-Process -FilePath "${detectionResult.path}" -WindowStyle Hidden`;
                }
                else {
                    // For venv and portable, we need to start the python process in background
                    backgroundCommand = `Start-Process -FilePath "powershell" -ArgumentList "-Command", "${detectionResult.command}" -WindowStyle Hidden -WorkingDirectory "${workingDirectory}"`;
                }
                return {
                    content: [{
                            type: "text",
                            text: `🔇 Ready to start ComfyUI in background mode!\n\n` +
                                `🔍 **Detected Installation:** ${detectionResult.description}\n` +
                                `📁 Installation Type: ${detectionResult.type.toUpperCase()}\n` +
                                `📂 Working directory: ${workingDirectory}\n` +
                                `🌐 Server will be available at: http://127.0.0.1:8188\n\n` +
                                `🎯 **NEXT STEP**: Use the Augment launch-process tool with these exact parameters:\n\n` +
                                `**Command:** \`${backgroundCommand}\`\n` +
                                `**Wait:** \`false\`\n` +
                                `**Max Wait Seconds:** \`60\`\n` +
                                `**Working Directory:** \`${workingDirectory}\`\n\n` +
                                `📋 This will start ComfyUI in background without visible output.\n` +
                                `⏳ Server should be ready in 30-60 seconds.\n` +
                                `💡 Use get_server_status tool to check when ready.\n\n` +
                                `✨ **Example Augment launch-process call:**\n` +
                                `\`\`\`\n` +
                                `launch-process:\n` +
                                `  command: "${backgroundCommand}"\n` +
                                `  wait: false\n` +
                                `  max_wait_seconds: 60\n` +
                                `  cwd: "${workingDirectory}"\n` +
                                `\`\`\``
                        }]
                };
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to start ComfyUI: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Direct ComfyUI launch for better terminal integration
    server.tool("start_comfyui_direct", "Start ComfyUI directly with Python command for better VS Code terminal integration", {
        sandboxPath: z.string().optional().describe("Path to ComfyUI sandbox directory (default: sandbox/ComfyUI_Sandbox_CUDA126)"),
        showInstructions: z.boolean().default(true).describe("Show launch-process instructions for VS Code terminal (default: true)")
    }, async ({ sandboxPath, showInstructions }) => {
        try {
            const defaultSandboxPath = "sandbox/ComfyUI_Sandbox_CUDA126";
            const actualSandboxPath = sandboxPath || defaultSandboxPath;
            const comfyUIPath = path.join(actualSandboxPath, "ComfyUI_CUDA126_SageAttention", "ComfyUI");
            const venvPath = path.join(comfyUIPath, "venv", "Scripts", "python.exe");
            const mainPyPath = path.join(comfyUIPath, "main.py");
            // Check if paths exist
            if (!fs.existsSync(comfyUIPath)) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ ComfyUI directory not found: ${comfyUIPath}\n\nPlease ensure ComfyUI is installed in the specified sandbox directory.`
                        }],
                    isError: true
                };
            }
            if (!fs.existsSync(venvPath)) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ Python virtual environment not found: ${venvPath}\n\nPlease ensure the virtual environment is properly set up.`
                        }],
                    isError: true
                };
            }
            if (!fs.existsSync(mainPyPath)) {
                return {
                    content: [{
                            type: "text",
                            text: `❌ ComfyUI main.py not found: ${mainPyPath}\n\nPlease ensure ComfyUI is properly installed.`
                        }],
                    isError: true
                };
            }
            const pythonCommand = `"${venvPath}" "${mainPyPath}" --fast --windows-standalone-build --use-sage-attention`;
            if (showInstructions) {
                return {
                    content: [{
                            type: "text",
                            text: `🚀 Ready to start ComfyUI with direct Python command!\n\n` +
                                `📁 ComfyUI Directory: ${comfyUIPath}\n` +
                                `🐍 Python Path: ${venvPath}\n` +
                                `🌐 Server will be available at: http://127.0.0.1:8188\n\n` +
                                `🎯 **Use Augment launch-process tool with these parameters:**\n\n` +
                                `**Command:** \`${pythonCommand}\`\n` +
                                `**Wait:** \`false\`\n` +
                                `**Max Wait Seconds:** \`60\`\n` +
                                `**Working Directory:** \`${comfyUIPath}\`\n\n` +
                                `📋 This will show ComfyUI startup progress directly in VS Code terminal.\n` +
                                `⏳ Server should be ready in 30-60 seconds.\n` +
                                `💡 You'll see all ComfyUI logs in real-time without separate windows.\n\n` +
                                `✨ **Copy-paste ready command:**\n` +
                                `\`\`\`\n${pythonCommand}\n\`\`\``
                        }]
                };
            }
            else {
                return {
                    content: [{
                            type: "text",
                            text: `🐍 Python command ready: ${pythonCommand}\n` +
                                `📂 Working directory: ${comfyUIPath}`
                        }]
                };
            }
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to prepare ComfyUI direct launch: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Test ComfyUI installation detection
    server.tool("test_comfyui_detection", "Test ComfyUI installation detection in a given directory", {
        searchPath: z.string().describe("Path to search for ComfyUI installation")
    }, async ({ searchPath }) => {
        try {
            const detectionResult = await detectComfyUIInstallationType(searchPath);
            const output = [
                `🔍 ComfyUI Installation Detection Results`,
                ``,
                `📂 Search Path: ${searchPath}`,
                `✅ Found: ${detectionResult.found ? 'Yes' : 'No'}`,
                `📁 Type: ${detectionResult.type.toUpperCase()}`,
                `📄 Description: ${detectionResult.description}`,
                ``,
                `🛠️ Execution Details:`,
                `📍 Executable Path: ${detectionResult.path}`,
                `💻 Command: ${detectionResult.command}`,
                `📂 Working Directory: ${detectionResult.workingDirectory}`,
                ``,
                detectionResult.found
                    ? `✅ This installation can be launched using the start_comfyui_in_terminal tool.`
                    : `❌ No valid ComfyUI installation found. Please check the path and ensure ComfyUI is properly installed.`
            ].join('\n');
            return {
                content: [{
                        type: "text",
                        text: output
                    }],
                isError: !detectionResult.found
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to detect ComfyUI installation: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    console.error(chalk.green("✅ Terminal tools registered"));
}
//# sourceMappingURL=terminal.js.map