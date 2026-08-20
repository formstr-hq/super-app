import type { z } from "zod";

import type { ToolResult } from "../result";

/** Execution context passed to every tool handler. */
export interface ToolCtx {
  /** When false, the stdio MCP does not register `write` tools. The app sets true. */
  allowWrites: boolean;
}

/** The module a tool belongs to. Hosts use it to expose a subset of the registry. */
export type ToolModule = "forms" | "calendar" | "pages" | "polls" | "drive";

/** A tool as its own module file declares it, before the registry stamps `module`. */
export interface ToolDef {
  name: string;
  description: string;
  /** zod raw shape — same value MCP's registerTool takes as `inputSchema`. */
  inputSchema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: ToolCtx) => Promise<ToolResult>;
  /** Mutating/outward tool — stdio MCP registers it only when allowWrites. */
  write?: boolean;
}

export interface ToolEntry extends ToolDef {
  /**
   * Which module owns this tool. Required, and stamped in `tools/index.ts` at
   * the one place the per-module arrays are combined — so a host that exposes
   * only some modules (the web app ships Forms/Calendar/Drive, while the MCP
   * server ships everything) can filter without a tool ever going untagged.
   */
  module: ToolModule;
}
