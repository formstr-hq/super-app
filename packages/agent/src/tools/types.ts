import type { z } from "zod";

import type { ToolResult } from "../result";

/** Execution context passed to every tool handler. */
export interface ToolCtx {
  /** When false, the stdio MCP does not register `write` tools. The app sets true. */
  allowWrites: boolean;
}

export interface ToolEntry {
  name: string;
  description: string;
  /** zod raw shape — same value MCP's registerTool takes as `inputSchema`. */
  inputSchema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: ToolCtx) => Promise<ToolResult>;
  /** Mutating/outward tool — stdio MCP registers it only when allowWrites. */
  write?: boolean;
}
