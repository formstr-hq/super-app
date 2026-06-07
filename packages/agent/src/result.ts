/**
 * Neutral tool result, framework-agnostic. The stdio MCP adapter maps this to the
 * SDK's `CallToolResult`; the in-browser agent consumes it directly. `text` is the
 * primary human/agent-readable body; `data` is optional structured output; `errorCode`
 * is an optional short machine code (e.g. NOT_FOUND) kept separate from the text.
 */
export interface ToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
  errorCode?: string;
}

/** Success result, optionally carrying structured `data`. */
export function ok(text: string, data?: unknown): ToolResult {
  return data !== undefined ? { ok: true, text, data } : { ok: true, text };
}

/** Error result, optionally tagged with a short machine code (e.g. NOT_FOUND). */
export function fail(text: string, errorCode?: string): ToolResult {
  return errorCode !== undefined ? { ok: false, text, errorCode } : { ok: false, text };
}

/** Render records as a compact GitHub-flavored markdown table for a tool's text body. */
export function table(rows: Record<string, unknown>[], cols: string[]): string {
  if (rows.length === 0) return "_(none)_";
  const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return `${header}\n${body}`;
}
