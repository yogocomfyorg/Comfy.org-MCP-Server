import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServerOrchestrator } from "../core/ServerOrchestrator.js";
export declare function setOrchestrator(orchestrator: ServerOrchestrator): void;
export declare function makeComfyUIRequest(endpoint: string, baseUrl?: string, method?: string, data?: any): Promise<any>;
export declare function registerComfyUIApiTools(server: McpServer): Promise<void>;
//# sourceMappingURL=comfyuiApi.d.ts.map