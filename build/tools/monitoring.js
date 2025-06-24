import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import chalk from "chalk";
import si from "systeminformation";
// Register monitoring tools
export async function registerMonitoringTools(server) {
    // Monitor system resources
    server.tool("monitor_system_resources", "Monitor CPU, RAM, and GPU usage", {
        detailed: z.boolean().default(false).describe("Show detailed information")
    }, async () => {
        try {
            const [cpu, mem, graphics] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.graphics()
            ]);
            const output = [
                'System Resource Monitor',
                '======================',
                '',
                `CPU Usage: ${cpu.currentLoad.toFixed(1)}%`,
                `Memory Usage: ${((mem.used / mem.total) * 100).toFixed(1)}% (${Math.round(mem.used / 1024 / 1024 / 1024)}GB / ${Math.round(mem.total / 1024 / 1024 / 1024)}GB)`,
                ''
            ];
            if (graphics.controllers.length > 0) {
                output.push('GPU Information:');
                graphics.controllers.forEach((gpu, index) => {
                    output.push(`  GPU ${index}: ${gpu.model || 'Unknown'}`);
                    if (gpu.vram) {
                        output.push(`    VRAM: ${gpu.vram}MB`);
                    }
                });
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
                        text: `Failed to monitor system resources: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    console.error(chalk.green("✅ Monitoring tools registered"));
}
//# sourceMappingURL=monitoring.js.map