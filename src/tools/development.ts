import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import chalk from "chalk";

// Register development tools
export async function registerDevelopmentTools(_server: McpServer): Promise<void> {
  // No development tools currently registered
  console.error(chalk.green("✅ Development tools registered"));
}
