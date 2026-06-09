import { afterEach, describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "./ollama";

function ndjsonRes(objs: object[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const o of objs) c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("OllamaProvider", () => {
  it("streams content tokens from NDJSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonRes([{ message: { content: "Hel" } }, { message: { content: "lo" } }]),
    );
    const tokens: string[] = [];
    let done = false;
    await new OllamaProvider("http://localhost:11434").generateStream(
      [{ id: "1", role: "user", content: "hi", timestamp: 0 }],
      [],
      {
        onToken: (t) => tokens.push(t),
        onDone: () => (done = true),
        onError: (e) => {
          throw e;
        },
      },
      { model: "qwen2.5" },
    );
    expect(tokens.join("")).toBe("Hello");
    expect(done).toBe(true);
  });

  it("isAvailable returns false when /api/tags is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await new OllamaProvider("http://localhost:11434").isAvailable()).toBe(false);
  });
});
