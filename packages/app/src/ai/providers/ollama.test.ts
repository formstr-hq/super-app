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

// ── diagnose ─────────────────────────────────────────────

const PAGE_HTTPS = { protocol: "https:", origin: "https://super-app.example" };
const PAGE_HTTP = { protocol: "http:", origin: "http://localhost:5173" };

describe("OllamaProvider.diagnose", () => {
  it("returns the installed models when the endpoint answers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5:7b" }] }), {
        status: 200,
      }),
    );
    const d = await new OllamaProvider("http://localhost:11434").diagnose(PAGE_HTTP);
    expect(d).toEqual({ ok: true, models: ["llama3.2:3b", "qwen2.5:7b"] });
  });

  it("reports an empty install rather than inventing a model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
    const d = await new OllamaProvider("http://localhost:11434").diagnose(PAGE_HTTP);
    expect(d.ok).toBe(true);
    expect(d.models).toEqual([]);
  });

  it("names OLLAMA_ORIGINS when the server is up but the browser is blocked", async () => {
    // The CORS-blocked request rejects; the no-cors probe resolves. A real
    // opaque response cannot be constructed here, and the code only cares that
    // the probe settled rather than threw.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
      (init as RequestInit | undefined)?.mode === "no-cors"
        ? Promise.resolve(new Response(null, { status: 200 }))
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    const d = await new OllamaProvider("http://ollama.example:11434").diagnose(PAGE_HTTPS);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("cors");
    expect(d.message).toContain("OLLAMA_ORIGINS=https://super-app.example");
  });

  it("reports mixed content for a remote http endpoint on an https page", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const d = await new OllamaProvider("http://ollama.example:11434").diagnose(PAGE_HTTPS);
    expect(d.reason).toBe("mixed-content");
    expect(d.message).toContain("HTTPS");
  });

  it("treats a dead loopback endpoint as unreachable, not mixed content", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const d = await new OllamaProvider("http://localhost:11434").diagnose(PAGE_HTTPS);
    expect(d.reason).toBe("unreachable");
    expect(d.message).toContain("ollama serve");
    // Loopback is exempt from mixed-content blocking in some browsers but not
    // all, so the hint has to survive.
    expect(d.message).toContain("HTTPS");
  });

  it("surfaces a non-2xx answer with its status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));
    const d = await new OllamaProvider("http://localhost:11434").diagnose(PAGE_HTTP);
    expect(d.reason).toBe("http-error");
    expect(d.message).toContain("403");
  });

  it("isAvailable stays a boolean view of the same probe", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "a" }] }), { status: 200 }),
    );
    expect(await new OllamaProvider("http://localhost:11434").isAvailable()).toBe(true);
  });
});
