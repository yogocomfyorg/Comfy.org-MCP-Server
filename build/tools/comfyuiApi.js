import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import chalk from "chalk";
import { v4 as uuidv4 } from "uuid";
import { executeToolOperation } from "../core/ToolWrapper.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
// Global orchestrator reference (will be set by the main server)
let globalOrchestrator = null;
export function setOrchestrator(orchestrator) {
    globalOrchestrator = orchestrator;
    console.error(chalk.blue("🎭 ComfyUI API tools connected to orchestrator"));
}
// Removed unused interface
// Removed unused complex functions for simplicity
// Helper functions
export async function makeComfyUIRequest(endpoint, baseUrl = 'http://127.0.0.1:8188', method = 'GET', data) {
    try {
        const url = `${baseUrl}${endpoint}`;
        const response = await axios({
            method,
            url,
            data,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    }
    catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error('ComfyUI server is not running or not accessible');
        }
        throw error;
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
// Register ComfyUI API tools
export async function registerComfyUIApiTools(server) {
    // Get server status
    server.tool("get_server_status", "Check ComfyUI server status and health", {
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL")
    }, async ({ baseUrl }) => {
        return await executeToolOperation(globalOrchestrator, 'ComfyUIApi', 'get_server_status', { baseUrl }, async () => {
            console.error(chalk.blue(`🔍 Checking ComfyUI server status at ${baseUrl}`));
            // Check if server is responding
            const startTime = Date.now();
            const queueData = await makeComfyUIRequest('/queue', baseUrl);
            const responseTime = Date.now() - startTime;
            // Get system stats if available
            let systemStats = null;
            try {
                systemStats = await makeComfyUIRequest('/system_stats', baseUrl);
            }
            catch {
                // System stats might not be available in all versions
            }
            const queueStatus = queueData;
            const serverInfo = {
                status: 'running',
                url: baseUrl,
                queueSize: queueStatus.queue_pending.length + queueStatus.queue_running.length,
                isProcessing: queueStatus.queue_running.length > 0
            };
            const output = [
                `ComfyUI Server Status: ${serverInfo.status.toUpperCase()}`,
                `URL: ${serverInfo.url}`,
                `Response Time: ${responseTime}ms`,
                `Queue Size: ${serverInfo.queueSize}`,
                `Currently Processing: ${serverInfo.isProcessing ? 'Yes' : 'No'}`,
                `Running Jobs: ${queueStatus.queue_running.length}`,
                `Pending Jobs: ${queueStatus.queue_pending.length}`,
                ''
            ];
            if (systemStats) {
                output.push('System Information:');
                output.push(`OS: ${systemStats.system.os}`);
                output.push(`Python: ${systemStats.system.python_version}`);
                output.push(`Embedded Python: ${systemStats.system.embedded_python}`);
                output.push('');
                if (systemStats.devices.length > 0) {
                    output.push('GPU Devices:');
                    systemStats.devices.forEach((device, index) => {
                        output.push(`  Device ${index}: ${device.name} (${device.type})`);
                        output.push(`    VRAM Total: ${formatBytes(device.vram_total)}`);
                        output.push(`    VRAM Free: ${formatBytes(device.vram_free)}`);
                        output.push(`    Torch VRAM Total: ${formatBytes(device.torch_vram_total)}`);
                        output.push(`    Torch VRAM Free: ${formatBytes(device.torch_vram_free)}`);
                    });
                }
            }
            console.error(chalk.green(`✅ Server is running and healthy`));
            return output.join('\n');
        }, {
            validateRequired: ['baseUrl'],
            measureTime: true,
            logExecution: true
        });
    });
    // Queue workflow
    server.tool("queue_workflow", "Add a workflow to the ComfyUI processing queue", {
        workflow: z.object({}).passthrough().describe("Workflow JSON object"),
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
        clientId: z.string().optional().describe("Client ID for tracking (auto-generated if not provided)")
    }, async ({ workflow, baseUrl, clientId }) => {
        try {
            const promptId = uuidv4();
            const actualClientId = clientId || uuidv4();
            console.error(chalk.blue(`🚀 Queuing workflow with prompt ID: ${promptId}`));
            const payload = {
                prompt: workflow,
                client_id: actualClientId
            };
            const result = await makeComfyUIRequest('/prompt', baseUrl, 'POST', payload);
            console.error(chalk.green(`✅ Workflow queued successfully`));
            return {
                content: [{
                        type: "text",
                        text: `Workflow queued successfully!\nPrompt ID: ${result.prompt_id || promptId}\nClient ID: ${actualClientId}\nQueue Number: ${result.number || 'Unknown'}`
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`❌ Failed to queue workflow: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: `Failed to queue workflow: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Get queue status
    server.tool("get_queue_status", "Get current queue status and processing information", {
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL")
    }, async ({ baseUrl }) => {
        try {
            const queueData = await makeComfyUIRequest('/queue', baseUrl);
            const output = [
                'ComfyUI Queue Status:',
                '',
                `Running Jobs: ${queueData.queue_running.length}`,
                `Pending Jobs: ${queueData.queue_pending.length}`,
                `Total Queue Size: ${queueData.queue_running.length + queueData.queue_pending.length}`,
                ''
            ];
            if (queueData.queue_running.length > 0) {
                output.push('Currently Running:');
                queueData.queue_running.forEach((item, index) => {
                    output.push(`  ${index + 1}. Prompt ID: ${item.prompt_id} (Queue #${item.number})`);
                    if (item.node_errors && Object.keys(item.node_errors).length > 0) {
                        output.push(`     Errors: ${Object.keys(item.node_errors).length} node(s)`);
                    }
                });
                output.push('');
            }
            if (queueData.queue_pending.length > 0) {
                output.push('Pending Jobs:');
                queueData.queue_pending.slice(0, 10).forEach((item, index) => {
                    output.push(`  ${index + 1}. Prompt ID: ${item.prompt_id} (Queue #${item.number})`);
                });
                if (queueData.queue_pending.length > 10) {
                    output.push(`  ... and ${queueData.queue_pending.length - 10} more`);
                }
            }
            return {
                content: [{
                        type: "text",
                        text: output.join('\n')
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to get queue status: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    // Clear queue
    server.tool("clear_queue", "Clear all pending items from the queue and optionally kill running processes", {
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
        deleteRunning: z.boolean().default(false).describe("Also clear currently running items")
    }, async ({ baseUrl, deleteRunning }) => {
        const results = [];
        let apiClearSuccess = false;
        try {
            // First, try the normal API clear
            const payload = {
                clear: true,
                delete: deleteRunning
            };
            await makeComfyUIRequest('/queue', baseUrl, 'POST', payload);
            apiClearSuccess = true;
            results.push("✅ Queue cleared via API successfully");
            console.error(chalk.green(`✅ Queue cleared successfully via API`));
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.push(`⚠️ API clear failed: ${errorMsg}`);
            console.error(chalk.yellow(`⚠️ API clear failed: ${errorMsg}`));
        }
        // If API clear failed, suggest using the dedicated kill tool
        if (!apiClearSuccess) {
            results.push("\n💡 If the server is unresponsive, use the 'kill_comfyui_processes' tool to force terminate ComfyUI processes.");
        }
        const finalText = results.join('\n') + `\n\nSummary:\nCleared pending items: ${apiClearSuccess ? 'Yes' : 'Failed'}\nCleared running items: ${deleteRunning ? 'Yes' : 'No'}`;
        return {
            content: [{
                    type: "text",
                    text: finalText
                }],
            isError: !apiClearSuccess
        };
    });
    // Enhanced port cleanup helper function
    async function cleanupPorts(results, execAsync) {
        results.push(`\n--- Enhanced Port Cleanup ---`);
        // Ports commonly used by ComfyUI and related services
        const portsToCheck = [8188, 8189, 8190, 7860, 7861, 7862];
        let totalKilled = 0;
        for (const port of portsToCheck) {
            try {
                const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                const lines = stdout.split('\n').filter((line) => line.trim());
                if (lines.length > 0) {
                    results.push(`🔍 Found ${lines.length} connection(s) on port ${port}`);
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length > 4) {
                            const pid = parts[parts.length - 1];
                            const state = parts.length > 3 ? parts[3] : 'UNKNOWN';
                            if (pid && pid !== '0') {
                                try {
                                    await execAsync(`taskkill /F /PID ${pid}`);
                                    results.push(`✅ Killed PID ${pid} (port ${port}, state: ${state})`);
                                    totalKilled++;
                                }
                                catch (pidError) {
                                    results.push(`⚠️ Failed to kill PID ${pid} on port ${port}: ${pidError}`);
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                // No processes on this port, which is good
            }
        }
        // Force cleanup of TIME_WAIT connections
        try {
            results.push(`🧹 Forcing cleanup of TIME_WAIT connections...`);
            await execAsync('netsh int ip reset');
            results.push(`✅ Network stack reset completed`);
        }
        catch (error) {
            results.push(`⚠️ Network stack reset failed: ${error}`);
        }
        // Additional cleanup for lingering connections
        try {
            await execAsync('ipconfig /flushdns');
            results.push(`✅ DNS cache flushed`);
        }
        catch (error) {
            results.push(`⚠️ DNS flush failed: ${error}`);
        }
        results.push(`📊 Total processes killed during port cleanup: ${totalKilled}`);
    }
    // Kill ComfyUI processes
    server.tool("kill_comfyui_processes", "Force kill all ComfyUI processes and optionally active terminals (useful when server is unresponsive)", {
        method: z.enum(["gentle", "force", "port", "comprehensive", "ports_only"]).default("comprehensive").describe("Kill method: gentle (by window title), force (by command line), port (by port usage), comprehensive (all methods + terminals), ports_only (only cleanup ports)"),
        killTerminals: z.boolean().default(true).describe("Also kill active terminals running ComfyUI"),
        enhancedPortCleanup: z.boolean().default(true).describe("Perform enhanced port cleanup including TIME_WAIT connections")
    }, async ({ method, killTerminals, enhancedPortCleanup }) => {
        const results = [];
        try {
            const { exec } = await import('child_process');
            const util = await import('util');
            const execAsync = util.promisify(exec);
            results.push(`🔄 Attempting to kill ComfyUI processes using method: ${method}`);
            // If ports_only method, just do port cleanup
            if (method === "ports_only") {
                if (enhancedPortCleanup) {
                    await cleanupPorts(results, execAsync);
                }
            }
            else {
                // Comprehensive method tries all approaches
                const methodsToTry = method === "comprehensive" ? ["gentle", "force", "port"] : [method];
                for (const currentMethod of methodsToTry) {
                    results.push(`\n--- Trying ${currentMethod} method ---`);
                    switch (currentMethod) {
                        case "gentle":
                            try {
                                await execAsync('taskkill /F /IM python.exe /FI "WINDOWTITLE eq ComfyUI*"');
                                results.push("✅ Killed ComfyUI python processes by window title");
                            }
                            catch (error) {
                                results.push(`⚠️ Gentle kill failed: ${error}`);
                            }
                            break;
                        case "force":
                            try {
                                // Kill by command line containing ComfyUI
                                await execAsync('wmic process where "commandline like \'%ComfyUI%\'" delete');
                                results.push("✅ Killed ComfyUI processes by command line");
                            }
                            catch (error) {
                                results.push(`⚠️ Force kill by command line failed: ${error}`);
                            }
                            try {
                                // Also try killing python processes with ComfyUI in path
                                await execAsync('wmic process where "commandline like \'%python%\' and commandline like \'%ComfyUI%\'" delete');
                                results.push("✅ Killed Python processes with ComfyUI in command line");
                            }
                            catch (error) {
                                results.push(`⚠️ Python process kill failed: ${error}`);
                            }
                            break;
                        case "port":
                            try {
                                const { stdout } = await execAsync('netstat -ano | findstr :8188');
                                const lines = stdout.split('\n').filter((line) => line.trim());
                                let killedCount = 0;
                                for (const line of lines) {
                                    const parts = line.trim().split(/\s+/);
                                    if (parts.length > 4) {
                                        const pid = parts[parts.length - 1];
                                        if (pid && pid !== '0') {
                                            try {
                                                await execAsync(`taskkill /F /PID ${pid}`);
                                                results.push(`✅ Killed process PID ${pid} using port 8188`);
                                                killedCount++;
                                            }
                                            catch (pidError) {
                                                results.push(`⚠️ Failed to kill PID ${pid}: ${pidError}`);
                                            }
                                        }
                                    }
                                }
                                if (killedCount === 0) {
                                    results.push("ℹ️ No processes found using port 8188");
                                }
                            }
                            catch (error) {
                                results.push(`⚠️ Port-based kill failed: ${error}`);
                            }
                            break;
                    }
                }
            }
            // Kill terminals if requested
            if (killTerminals && method !== "ports_only") {
                results.push(`\n--- Killing active terminals ---`);
                try {
                    // Kill cmd.exe processes that might be running ComfyUI
                    await execAsync('taskkill /F /IM cmd.exe /FI "WINDOWTITLE eq *ComfyUI*"');
                    results.push("✅ Killed ComfyUI terminal windows");
                }
                catch (error) {
                    results.push(`⚠️ Terminal kill failed: ${error}`);
                }
                try {
                    // Kill PowerShell processes that might be running ComfyUI
                    await execAsync('taskkill /F /IM powershell.exe /FI "WINDOWTITLE eq *ComfyUI*"');
                    results.push("✅ Killed ComfyUI PowerShell windows");
                }
                catch (error) {
                    results.push(`⚠️ PowerShell kill failed: ${error}`);
                }
                try {
                    // Kill any batch file processes
                    await execAsync('wmic process where "commandline like \'%Launch_ComfyUI%\'" delete');
                    results.push("✅ Killed ComfyUI batch file processes");
                }
                catch (error) {
                    results.push(`⚠️ Batch file process kill failed: ${error}`);
                }
            }
            // Enhanced port cleanup if requested
            if (enhancedPortCleanup) {
                await cleanupPorts(results, execAsync);
            }
            // Wait for processes to terminate
            await new Promise(resolve => setTimeout(resolve, 5000));
            // Enhanced verification
            results.push(`\n--- Enhanced Verification ---`);
            const portsToVerify = [8188, 8189, 8190, 7860, 7861, 7862];
            let allPortsFree = true;
            for (const port of portsToVerify) {
                try {
                    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                    if (stdout.trim()) {
                        results.push(`⚠️ Port ${port} still has active connections`);
                        allPortsFree = false;
                    }
                    else {
                        results.push(`✅ Port ${port} is free`);
                    }
                }
                catch (error) {
                    results.push(`✅ Port ${port} appears to be free (no processes found)`);
                }
            }
            if (allPortsFree) {
                results.push("🎉 All ComfyUI-related ports are now free!");
            }
            else {
                results.push("⚠️ Some ports may still have active connections. Consider running the tool again with 'ports_only' method.");
            }
            results.push("✅ Process termination and port cleanup completed");
            console.error(chalk.green(`✅ ComfyUI processes killed using method: ${method}`));
            return {
                content: [{
                        type: "text",
                        text: results.join('\n')
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.push(`❌ Kill operation failed: ${errorMsg}`);
            console.error(chalk.red(`❌ Kill operation failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: results.join('\n')
                    }],
                isError: true
            };
        }
    });
    // Dedicated port cleanup tool
    server.tool("cleanup_comfyui_ports", "Clean up all ports used by ComfyUI and related services to resolve connection issues", {
        ports: z.array(z.number()).optional().describe("Specific ports to clean up (default: [8188, 8189, 8190, 7860, 7861, 7862])"),
        forceNetworkReset: z.boolean().default(true).describe("Force network stack reset to clear TIME_WAIT connections"),
        verbose: z.boolean().default(true).describe("Show detailed information about port cleanup")
    }, async ({ ports, forceNetworkReset, verbose }) => {
        const results = [];
        try {
            const { exec } = await import('child_process');
            const util = await import('util');
            const execAsync = util.promisify(exec);
            const portsToClean = ports || [8188, 8189, 8190, 7860, 7861, 7862];
            results.push(`🧹 Starting dedicated port cleanup for ports: ${portsToClean.join(', ')}`);
            let totalKilled = 0;
            let totalConnections = 0;
            for (const port of portsToClean) {
                try {
                    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                    const lines = stdout.split('\n').filter((line) => line.trim());
                    if (lines.length > 0) {
                        totalConnections += lines.length;
                        if (verbose) {
                            results.push(`\n🔍 Port ${port}: Found ${lines.length} connection(s)`);
                        }
                        for (const line of lines) {
                            const parts = line.trim().split(/\s+/);
                            if (parts.length > 4) {
                                const pid = parts[parts.length - 1];
                                const state = parts.length > 3 ? parts[3] : 'UNKNOWN';
                                const localAddr = parts[1] || 'UNKNOWN';
                                const remoteAddr = parts[2] || 'UNKNOWN';
                                if (verbose) {
                                    results.push(`  📡 ${localAddr} -> ${remoteAddr} (${state}) PID: ${pid}`);
                                }
                                if (pid && pid !== '0') {
                                    try {
                                        await execAsync(`taskkill /F /PID ${pid}`);
                                        results.push(`  ✅ Killed PID ${pid} (port ${port}, state: ${state})`);
                                        totalKilled++;
                                    }
                                    catch (pidError) {
                                        results.push(`  ⚠️ Failed to kill PID ${pid}: ${pidError}`);
                                    }
                                }
                            }
                        }
                    }
                    else {
                        if (verbose) {
                            results.push(`✅ Port ${port}: Already free`);
                        }
                    }
                }
                catch (error) {
                    if (verbose) {
                        results.push(`✅ Port ${port}: No active connections`);
                    }
                }
            }
            // Force network reset if requested
            if (forceNetworkReset) {
                results.push(`\n🔄 Performing network stack reset...`);
                try {
                    await execAsync('netsh int ip reset');
                    results.push(`✅ Network stack reset completed`);
                }
                catch (error) {
                    results.push(`⚠️ Network stack reset failed: ${error}`);
                }
                try {
                    await execAsync('ipconfig /flushdns');
                    results.push(`✅ DNS cache flushed`);
                }
                catch (error) {
                    results.push(`⚠️ DNS flush failed: ${error}`);
                }
            }
            // Wait for cleanup to take effect
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Final verification
            results.push(`\n🔍 Final verification...`);
            let allClear = true;
            for (const port of portsToClean) {
                try {
                    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                    if (stdout.trim()) {
                        results.push(`⚠️ Port ${port}: Still has active connections`);
                        allClear = false;
                    }
                    else {
                        results.push(`✅ Port ${port}: Confirmed free`);
                    }
                }
                catch (error) {
                    results.push(`✅ Port ${port}: Confirmed free`);
                }
            }
            results.push(`\n📊 Cleanup Summary:`);
            results.push(`  • Total connections found: ${totalConnections}`);
            results.push(`  • Processes killed: ${totalKilled}`);
            results.push(`  • Ports cleaned: ${portsToClean.length}`);
            results.push(`  • All ports free: ${allClear ? 'Yes' : 'No'}`);
            if (allClear) {
                results.push(`\n🎉 Port cleanup completed successfully! MCP server should now be able to connect.`);
            }
            else {
                results.push(`\n⚠️ Some ports may still be in use. You may need to restart the system or wait for TIME_WAIT connections to expire.`);
            }
            console.error(chalk.green(`✅ Port cleanup completed`));
            return {
                content: [{
                        type: "text",
                        text: results.join('\n')
                    }],
                isError: !allClear
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            results.push(`❌ Port cleanup failed: ${errorMsg}`);
            console.error(chalk.red(`❌ Port cleanup failed: ${errorMsg}`));
            return {
                content: [{
                        type: "text",
                        text: results.join('\n')
                    }],
                isError: true
            };
        }
    });
    console.error(chalk.green("✅ ComfyUI API tools registered"));
}
//# sourceMappingURL=comfyuiApi.js.map