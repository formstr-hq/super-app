import { toolRegistry, type ToolEntry, type ToolModule } from "@formstr/agent";

/**
 * Modules this app has a UI for. The agent registry is shared with the MCP
 * server, which ships every module — including Pages and Polls, which this app
 * no longer renders. Offering the assistant a tool whose result has nowhere to
 * appear is worse than not offering it: the call succeeds, writes to relays,
 * and the user is told something happened that they cannot see or undo here.
 */
export const APP_TOOL_MODULES = [
  "forms",
  "calendar",
  "drive",
] as const satisfies readonly ToolModule[];

const allowed = new Set<ToolModule>(APP_TOOL_MODULES);

/** The slice of the shared registry this app both advertises and executes. */
export const appToolRegistry: ToolEntry[] = toolRegistry.filter((t) => allowed.has(t.module));
