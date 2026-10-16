import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config, Role } from "./config.js";
import { ALL_TOOLS } from "./tools/index.js";
import { ROLE_ACCESS } from "./tools/types.js";
import { ToolError } from "./sandbox.js";
import { logCall } from "./logger.js";

/**
 * Build an MCP server exposing only the tools this role may use.
 * A reader never even sees write_file in tools/list.
 */
export function createServer(config: Config, role: Role): McpServer {
  const server = new McpServer({ name: "mcp-workspace-server", version: "1.0.0" });
  const allowed = ROLE_ACCESS[role];

  for (const tool of ALL_TOOLS.filter((t) => allowed.includes(t.access))) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: any) => {
        const t0 = Date.now();
        let text: string;
        let ok = true;
        let error: string | undefined;
        try {
          text = await tool.handler(args, { config, role });
          if (text.length > config.maxOutputChars) {
            text = text.slice(0, config.maxOutputChars) + `\n… output truncated at ${config.maxOutputChars} chars. Narrow your request.`;
          }
        } catch (e) {
          ok = false;
          error = e instanceof ToolError ? e.message : "Internal error while running the tool.";
          if (!(e instanceof ToolError)) console.error(`[${tool.name}]`, e); // stack stays server-side
          text = error;
        }
        logCall({ role, tool: tool.name, args, ok, ms: Date.now() - t0, outChars: text.length, error });
        return { content: [{ type: "text" as const, text }], isError: !ok };
      },
    );
  }
  return server;
}
