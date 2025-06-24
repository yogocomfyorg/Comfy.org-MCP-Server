#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import chalk from "chalk";

// Import core infrastructure
import { ServerOrchestrator } from "./core/ServerOrchestrator.js";

// Import tool modules
import { registerModelDownloadTools } from "./tools/modelDownload.js";
import { registerTerminalTools } from "./tools/terminal.js";
import { registerComfyUIApiTools } from "./tools/comfyuiApi.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerWorkflowOrchestrationTools } from "./tools/workflowOrchestration.js";
import { registerConfigurationTools } from "./tools/configuration.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import { registerBatchOperationTools } from "./tools/batchOperations.js";
import { registerIntegrationTools } from "./tools/integration.js";
import { registerDevelopmentTools } from "./tools/development.js";
import { registerImageRoutingTools } from "./tools/imageRouting.js";
import { registerCustomNodeTools } from "./tools/customNodes.js";
import { registerIntelligentRequirementsTools } from "./tools/intelligentRequirements.js";

// Server configuration
const SERVER_NAME = "comfyui-mcp-server";
const SERVER_VERSION = "2.0.0"; // Updated version for improved infrastructure

// Global orchestrator instance
let orchestrator: ServerOrchestrator;

// Create server instance
const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
  capabilities: {
    resources: {},
    tools: {},
    prompts: {},
  },
});

// Enhanced global error handler with orchestrator integration
process.on('uncaughtException', async (error) => {
  console.error(chalk.red('Uncaught Exception:'), error);

  if (orchestrator) {
    try {
      await orchestrator.shutdown();
    } catch (shutdownError) {
      console.error(chalk.red('Error during shutdown:'), shutdownError);
    }
  }

  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);

  if (orchestrator) {
    try {
      await orchestrator.shutdown();
    } catch (shutdownError) {
      console.error(chalk.red('Error during shutdown:'), shutdownError);
    }
  }

  process.exit(1);
});

// Initialize server with all tool categories
async function initializeServer() {
  try {
    console.error(chalk.blue(`🚀 Initializing ${SERVER_NAME} v${SERVER_VERSION}`));

    // Initialize ServerOrchestrator
    console.error(chalk.blue("🎭 Initializing ServerOrchestrator..."));
    orchestrator = new ServerOrchestrator({
      comfyuiUrl: 'http://127.0.0.1:8188',
      sandboxPath: 'sandbox/ComfyUI_Sandbox_CUDA126',
      autoRestart: true,
      healthMonitoring: true,
      errorRecovery: true,
      stateManagement: true,
      connectionManagement: true
    });

    await orchestrator.initialize();
    console.error(chalk.green("✅ ServerOrchestrator initialized"));
    
    // Register all tool categories
    console.error(chalk.yellow("📦 Registering Model Download Tools..."));
    await registerModelDownloadTools(server);
    
    console.error(chalk.yellow("💻 Registering Terminal Tools..."));
    await registerTerminalTools(server);
    
    console.error(chalk.yellow("🎨 Registering ComfyUI API Tools..."));
    await registerComfyUIApiTools(server);

    // Pass orchestrator to tools that support it
    if (orchestrator) {
      const { setOrchestrator } = await import("./tools/comfyuiApi.js");
      setOrchestrator(orchestrator);
    }
    
    console.error(chalk.yellow("🔧 Registering Workflow Tools..."));
    await registerWorkflowTools(server);

    console.error(chalk.yellow("🎭 Registering Workflow Orchestration Tools..."));
    await registerWorkflowOrchestrationTools(server);

    console.error(chalk.yellow("⚙️ Registering Configuration Tools..."));
    await registerConfigurationTools(server);
    
    console.error(chalk.yellow("📊 Registering Monitoring Tools..."));
    await registerMonitoringTools(server);
    
    console.error(chalk.yellow("🔄 Registering Batch Operation Tools..."));
    await registerBatchOperationTools(server);
    
    console.error(chalk.yellow("🔗 Registering Integration Tools..."));
    await registerIntegrationTools(server);
    
    console.error(chalk.yellow("🧪 Registering Development Tools..."));
    await registerDevelopmentTools(server);

    console.error(chalk.yellow("🖼️ Registering Image Routing Tools..."));
    await registerImageRoutingTools(server);

    console.error(chalk.yellow("🔧 Registering Custom Node Tools..."));
    await registerCustomNodeTools(server);

    console.error(chalk.yellow("🧠 Registering Intelligent Requirements Tools..."));
    await registerIntelligentRequirementsTools(server);

    console.error(chalk.green("✅ All tools registered successfully"));
    
    // Add enhanced health check tool with orchestrator integration
    server.tool(
      "health_check",
      "Get comprehensive server health status including orchestrator metrics",
      {},
      async () => {
        try {
          const orchestratorStatus = orchestrator ? orchestrator.getStatus() : null;

          const healthData = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            server: SERVER_NAME,
            version: SERVER_VERSION,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid,
            orchestrator: orchestratorStatus
          };

          return {
            content: [{
              type: "text",
              text: JSON.stringify(healthData, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    console.error(chalk.green("🏥 Enhanced health check tool registered"));
    
  } catch (error) {
    console.error(chalk.red("❌ Failed to initialize server:"), error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    // Initialize server
    await initializeServer();
    
    // Create transport
    const transport = new StdioServerTransport();
    
    // Connect server to transport
    await server.connect(transport);
    
    console.error(chalk.green(`🎉 ${SERVER_NAME} is running on stdio transport`));
    console.error(chalk.blue("📡 Ready to receive MCP requests..."));
    
  } catch (error) {
    console.error(chalk.red("💥 Fatal error in main():"), error);
    process.exit(1);
  }
}

// Handle graceful shutdown with orchestrator cleanup
process.on('SIGINT', async () => {
  console.error(chalk.yellow("\n🛑 Received SIGINT, shutting down gracefully..."));

  if (orchestrator) {
    try {
      await orchestrator.shutdown();
    } catch (error) {
      console.error(chalk.red('Error during orchestrator shutdown:'), error);
    }
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error(chalk.yellow("\n🛑 Received SIGTERM, shutting down gracefully..."));

  if (orchestrator) {
    try {
      await orchestrator.shutdown();
    } catch (error) {
      console.error(chalk.red('Error during orchestrator shutdown:'), error);
    }
  }

  process.exit(0);
});

// Start the server
main().catch((error) => {
  console.error(chalk.red("💥 Fatal error:"), error);
  process.exit(1);
});
