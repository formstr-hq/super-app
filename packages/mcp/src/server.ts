import { toolRegistry, type ToolCtx, type ToolResult } from "@formstr/agent";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Map a neutral `ToolResult` to the SDK's `CallToolResult`. The error code is folded
 * back into the text (`"message (CODE)"`) to preserve the exact body external MCP
 * clients saw before the agent extraction.
 */
function adapt(r: ToolResult): CallToolResult {
  const text = r.ok || r.errorCode === undefined ? r.text : `${r.text} (${r.errorCode})`;
  return {
    content: [{ type: "text", text }],
    ...(r.data !== undefined ? { structuredContent: r.data as Record<string, unknown> } : {}),
    ...(r.ok ? {} : { isError: true }),
  };
}

export function buildServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: "formstr", version: "0.1.0" });
  for (const t of toolRegistry) {
    if (t.write && !ctx.allowWrites) continue;
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      async (args: unknown) => adapt(await t.handler(args, ctx)),
    );
  }
  return server;
}

export async function startStdio(ctx: ToolCtx): Promise<void> {
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
