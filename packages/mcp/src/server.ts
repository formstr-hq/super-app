import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerCalendar } from "./tools/calendar";
import { registerDrive } from "./tools/drive";
import { registerForms } from "./tools/forms";
import { registerPages } from "./tools/pages";
import { registerPolls } from "./tools/polls";
import type { RegisterCtx } from "./tools/shared";

export function buildServer(ctx: RegisterCtx): McpServer {
  const server = new McpServer({ name: "formstr", version: "0.0.1" });
  registerForms(server, ctx);
  registerCalendar(server, ctx);
  registerPages(server, ctx);
  registerDrive(server, ctx);
  registerPolls(server, ctx);
  return server;
}

export async function startStdio(ctx: RegisterCtx): Promise<void> {
  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
