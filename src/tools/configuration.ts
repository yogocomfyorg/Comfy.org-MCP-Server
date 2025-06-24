import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";

// Register configuration tools
export async function registerConfigurationTools(server: McpServer): Promise<void> {
  
  // Get ComfyUI config
  server.tool(
    "get_comfyui_config",
    "Get current ComfyUI configuration",
    {
        configPath: z.string().optional().describe("Path to config file (optional)")
    },
    async ({ configPath }) => {
      try {
        const defaultConfigPath = configPath || path.join(process.cwd(), 'extra_model_paths.yaml');
        
        if (await fs.pathExists(defaultConfigPath)) {
          const config = await fs.readFile(defaultConfigPath, 'utf-8');
          return {
            content: [{
              type: "text",
              text: `Configuration from ${defaultConfigPath}:\n\n${config}`
            }]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: `No configuration file found at ${defaultConfigPath}`
            }]
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `Failed to get configuration: ${errorMsg}`
          }],
          isError: true
        };
      }
    }
  );

  console.error(chalk.green("✅ Configuration tools registered"));
}
