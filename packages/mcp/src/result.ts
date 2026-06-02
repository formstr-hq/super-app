import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(message: string, data?: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: data === undefined ? undefined : (data as Record<string, unknown>),
  };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
