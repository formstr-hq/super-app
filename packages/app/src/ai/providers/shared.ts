/** Read a fetch Response body line-by-line (newline-delimited), flushing the
 *  final partial line. Works for both SSE (`data: …`) and NDJSON wire formats. */
export async function readLines(res: Response, onLine: (line: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    }
    if (buffer.length) onLine(buffer);
  } finally {
    reader.releaseLock();
  }
}

/** Extract the payload of an SSE `data:` line, or null for other lines. */
export function sseData(line: string): string | null {
  const t = line.trimStart();
  if (!t.startsWith("data:")) return null;
  return t.slice(5).trim();
}
