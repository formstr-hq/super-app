import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(message: string, data?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    ...(data !== undefined && { structuredContent: data }),
  };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
