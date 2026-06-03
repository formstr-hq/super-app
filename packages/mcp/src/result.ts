import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Success result. `text` is the primary, human/agent-readable body (many MCP hosts only
 * surface the text and drop `structuredContent`), and `structured` is kept for hosts that
 * consume structured output programmatically.
 */
export function ok(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured !== undefined && { structuredContent: structured }),
  };
}

/** Error result, optionally tagged with a short machine code (e.g. NOT_FOUND). */
export function fail(message: string, code?: string): CallToolResult {
  return {
    content: [{ type: "text", text: code ? `${message} (${code})` : message }],
    isError: true,
  };
}

/** Render records as a compact GitHub-flavored markdown table for a tool's text body. */
export function table(rows: Record<string, unknown>[], cols: string[]): string {
  if (rows.length === 0) return "_(none)_";
  const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return `${header}\n${body}`;
}
