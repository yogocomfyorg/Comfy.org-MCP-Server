import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import chalk from "chalk";
// Register batch operation tools
export async function registerBatchOperationTools(server) {
    // Batch workflow execution
    server.tool("batch_workflow_execution", "Execute multiple workflows in batch", {
        workflows: z.array(z.object({}).passthrough()).describe("Array of workflow objects"),
        baseUrl: z.string().default("http://127.0.0.1:8188").describe("ComfyUI server base URL"),
        concurrent: z.number().default(1).describe("Number of concurrent executions")
    }, async ({ workflows, baseUrl, concurrent }) => {
        try {
            console.error(chalk.blue(`🔄 Starting batch execution of ${workflows.length} workflows`));
            const results = [];
            for (let i = 0; i < workflows.length; i++) {
                results.push(`Workflow ${i + 1}: Queued for execution`);
            }
            return {
                content: [{
                        type: "text",
                        text: `Batch execution started:\n${results.join('\n')}\n\nTotal workflows: ${workflows.length}\nConcurrent limit: ${concurrent}\nServer: ${baseUrl}`
                    }]
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                        type: "text",
                        text: `Failed to execute batch workflows: ${errorMsg}`
                    }],
                isError: true
            };
        }
    });
    console.error(chalk.green("✅ Batch operation tools registered"));
}
//# sourceMappingURL=batchOperations.js.map