# AI Orchestration — Stage 2 (Providers + BYOK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's single `provider.ts` (Ollama + a broken-Anthropic `CloudLLMProvider`) with a `providers/` layer of five normalized tool-calling providers — Anthropic (real `/v1/messages`), OpenAI, Gemini, Ollama, and a generic OpenAI-compatible — selected by a `createProvider(settings)` factory, and expand `settingsStore` to per-provider BYOK keys/models with a one-time migration from the old single-key shape.

**Architecture:** Every provider implements the existing `LLMProvider` interface (trimmed to `generateStream` / `getAvailableModels` / `isAvailable`) and translates the neutral `Message[]` + OpenAI-style `ToolDefinition[]` to/from its own wire format over raw browser `fetch` (no SDK in the bundle — the locked client-side-BYOK decision; Anthropic uses `anthropic-dangerous-direct-browser-access`). A shared line-reader (`providers/shared.ts`) handles SSE/NDJSON framing. `settingsStore` swaps its single `aiApiKey`/`aiModel` for `apiKeys{anthropic,openai,gemini}` + `aiModels{per-provider}` + `ollamaUrl` + `compatBaseUrl`/`compatKey`, migrated once from the legacy localStorage keys. `aiStore.initProvider` calls the synchronous `createProvider`, then `isAvailable()`/`getAvailableModels()`.

**Tech Stack:** pnpm workspaces, TypeScript (ESM, `moduleResolution: bundler`), zustand, React + MUI, vitest (Node/jsdom — global `fetch`/`Response`/`ReadableStream`/`TextEncoder` available). Raw `fetch`, no provider SDKs. Reference: spec `docs/superpowers/specs/2026-06-07-ai-orchestration-design.md` §4.4 (provider layer), §4.5 (settings/BYOK), §6 (Stage 2), §7 (testing). Anthropic wire format per the `claude-api` skill: `POST /v1/messages`, headers `x-api-key` + `anthropic-version: 2023-06-01` + `anthropic-dangerous-direct-browser-access: true`, `tool_use`/`tool_result` content blocks, SSE `content_block_start` / `content_block_delta`(`text_delta` | `input_json_delta`) / `content_block_stop`.

---

## File structure (what Stage 2 creates / modifies / deletes)

**New (`@formstr/app`, `packages/app/src/ai/providers/`):**

- `shared.ts` — `readLines(res, onLine)` raw line reader + `sseData(line)` SSE `data:` extractor (shared by all streaming providers).
- `openaiCompatible.ts` — `OpenAICompatibleProvider` (OpenAI `/chat/completions` wire format against a configurable base URL + optional key; fixes the dropped-assistant-`tool_calls` bug). Base class.
- `openai.ts` — `OpenAIProvider extends OpenAICompatibleProvider` (fixed `https://api.openai.com/v1`).
- `anthropic.ts` — `AnthropicProvider` (real `/v1/messages`, tool_use/tool_result, SSE).
- `gemini.ts` — `GeminiProvider` (`:streamGenerateContent?alt=sse`, `functionDeclarations`/`functionCall`/`functionResponse`).
- `ollama.ts` — `OllamaProvider` (moved verbatim from `provider.ts`, NDJSON).
- `factory.ts` — `createProvider(settings): LLMProvider` + `ProviderSettings` type.
- `index.ts` — barrel re-exporting the providers + `createProvider`.
- Tests: `shared.test.ts`, `openaiCompatible.test.ts`, `anthropic.test.ts`, `gemini.test.ts`, `ollama.test.ts`, `factory.test.ts`.

**Modified (`@formstr/app`):**

- `packages/app/src/ai/types.ts` — trim `LLMProvider` to `generateStream`/`getAvailableModels`/`isAvailable` (drop dead `generate`); drop `StreamCallbacks.onToolResult` (unused). `ActionResult` stays (used by `EntityRef`/types elsewhere).
- `packages/app/src/ai/index.ts` — export from `./providers` instead of `./provider`; drop `OllamaProvider`/`CloudLLMProvider`/`createLLMProvider` exports, add `createProvider` + provider classes.
- `packages/app/src/stores/settingsStore.ts` — new AI shape + migration + granular setters.
- `packages/app/src/stores/aiStore.ts` — use `createProvider` + new settings; `setModel` writes `aiModels[activeProvider]`.
- `packages/app/src/stores/aiStore.test.ts` — mock `createProvider` instead of `createLLMProvider`.
- `packages/app/src/components/ai/AIChatPanel.tsx` — derive `aiModel` from `aiModels[aiProvider]` (one line; keeps the model `Select` compiling — full header pill is Stage 3).

**New test (`@formstr/app`):**

- `packages/app/src/stores/settingsStore.test.ts` — migration + setters.

**Deleted (`@formstr/app`):**

- `packages/app/src/ai/provider.ts` — content moved into `providers/`.

---

## Conventions locked for this stage (use these exact names across tasks)

```ts
// settingsStore
export type AIProviderType = "anthropic" | "openai" | "gemini" | "ollama" | "openai-compat";
export type ApiKeys = { anthropic?: string; openai?: string; gemini?: string };
export type CloudProvider = "anthropic" | "openai" | "gemini";

// localStorage keys
"formstr:ai-provider"          // active AIProviderType
"formstr:ai-keys"              // JSON ApiKeys   (presence ⇒ migration already ran)
"formstr:ai-models"            // JSON Partial<Record<AIProviderType,string>>
"formstr:ai-ollama-url"        // string (migrated from legacy "formstr:ai-endpoint")
"formstr:ai-compat-base-url"   // string
"formstr:ai-compat-key"        // string

// factory input
export interface ProviderSettings {
  aiProvider: AIProviderType;
  apiKeys: ApiKeys;
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
}
```

Default models (used only when `aiModels[provider]` is unset; always overridable):
`anthropic → "claude-sonnet-4-6"`, `openai → "gpt-4o-mini"`, `gemini → "gemini-2.0-flash"`, `openai-compat → "local-model"`, `ollama → "qwen2.5:7b"`.

---

### Task 1: Trim the `LLMProvider` interface

**Files:**
- Modify: `packages/app/src/ai/types.ts`

- [ ] **Step 1: Confirm `generate` has no runtime callers**

Run: `grep -rn "\.generate(" packages/app/src --include="*.ts" --include="*.tsx" | grep -v "generateStream\|generateSecretKey"`
Expected: no output (only the test mock + old `provider.ts` define it; the `Agent` uses `generateStream`).

- [ ] **Step 2: Edit the interface and `StreamCallbacks`**

In `types.ts`, replace the `StreamCallbacks` and `LLMProvider` blocks with:

```ts
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onWarning?: (message: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void>;

  getAvailableModels(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}
```

(`Message`, `ToolCall`, `ToolDefinition`, `GenerateOptions`, `ActionResult` definitions are unchanged.)

- [ ] **Step 3: Typecheck (expected to fail on `provider.ts`)**

Run: `pnpm --filter @formstr/app exec tsc --noEmit 2>&1 | head -20`
Expected: errors only in `ai/provider.ts` (still implements `generate`) — that file is deleted in Task 8. Proceed; we fix the graph there.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/ai/types.ts
git commit -m "refactor(app): trim LLMProvider to streaming surface (drop dead generate)"
```

---

### Task 2: Shared stream-line reader

**Files:**
- Create: `packages/app/src/ai/providers/shared.ts`
- Test: `packages/app/src/ai/providers/shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { readLines, sseData } from "./shared";

function fakeRes(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("readLines", () => {
  it("splits on newlines across chunk boundaries and flushes the tail", async () => {
    const lines: string[] = [];
    await readLines(fakeRes(["he", "llo\nwor", "ld\n", "tail"]), (l) => lines.push(l));
    expect(lines).toEqual(["hello", "world", "tail"]);
  });

  it("throws when there is no body", async () => {
    const res = new Response(null, { status: 200 });
    await expect(readLines(res, () => {})).rejects.toThrow("No response body");
  });
});

describe("sseData", () => {
  it("extracts the payload after data:", () => {
    expect(sseData("data: {\"a\":1}")).toBe('{"a":1}');
    expect(sseData("data:[DONE]")).toBe("[DONE]");
  });
  it("returns null for non-data lines", () => {
    expect(sseData("event: message_start")).toBeNull();
    expect(sseData("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- shared.test`
Expected: FAIL — `Cannot find module './shared'`.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/ai/providers/shared.ts

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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- shared.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ai/providers/shared.ts packages/app/src/ai/providers/shared.test.ts
git commit -m "feat(app): shared stream line-reader + SSE data extractor"
```

---

### Task 3: OpenAI-compatible provider (base) + OpenAI subclass

**Files:**
- Create: `packages/app/src/ai/providers/openaiCompatible.ts`
- Create: `packages/app/src/ai/providers/openai.ts`
- Test: `packages/app/src/ai/providers/openaiCompatible.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, ToolDefinition } from "../types";

import { OpenAICompatibleProvider } from "./openaiCompatible";

function sseRes(events: object[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).concat("data: [DONE]\n\n");
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

const tools: ToolDefinition[] = [
  { type: "function", function: { name: "list_forms", description: "", parameters: { type: "object", properties: {} } } },
];

describe("OpenAICompatibleProvider.generateStream", () => {
  it("streams text deltas and accumulates tool calls by index", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseRes([
        { choices: [{ delta: { content: "Hi " } }] },
        { choices: [{ delta: { content: "there" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "list_forms", arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"limit":5}' } }] } }] },
      ]),
    );

    const tokens: string[] = [];
    const calls: { name: string; args: unknown }[] = [];
    let done = false;
    await new OpenAICompatibleProvider({ baseUrl: "http://x/v1", apiKey: "k" }).generateStream(
      [{ id: "1", role: "user", content: "hi", timestamp: 0 }],
      tools,
      {
        onToken: (t) => tokens.push(t),
        onToolCall: (c) => calls.push({ name: c.name, args: c.arguments }),
        onDone: () => (done = true),
        onError: (e) => { throw e; },
      },
      { model: "gpt-4o-mini" },
    );

    expect(tokens.join("")).toBe("Hi there");
    expect(calls).toEqual([{ name: "list_forms", args: { limit: 5 } }]);
    expect(done).toBe(true);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.tools[0].function.name).toBe("list_forms");
  });

  it("serializes assistant tool_calls and tool results back to the wire", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseRes([{ choices: [{ delta: { content: "ok" } }] }]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "do it", timestamp: 0 },
      { id: "2", role: "assistant", content: "", timestamp: 0, toolCalls: [{ id: "call_1", name: "list_forms", arguments: { limit: 5 } }] },
      { id: "3", role: "tool", content: "3 forms", timestamp: 0, toolCallId: "call_1" },
    ];
    await new OpenAICompatibleProvider({ baseUrl: "http://x/v1" }).generateStream(messages, tools, {
      onToken: () => {}, onDone: () => {}, onError: (e) => { throw e; },
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const assistant = body.messages[1];
    expect(assistant.tool_calls[0]).toMatchObject({ id: "call_1", type: "function", function: { name: "list_forms" } });
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ limit: 5 });
    const toolMsg = body.messages[2];
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "3 forms" });
  });

  it("surfaces non-ok responses via onError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    let err: Error | null = null;
    await new OpenAICompatibleProvider({ baseUrl: "http://x/v1", apiKey: "bad" }).generateStream(
      [{ id: "1", role: "user", content: "hi", timestamp: 0 }],
      [],
      { onToken: () => {}, onDone: () => { throw new Error("should not finish"); }, onError: (e) => (err = e) },
    );
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain("401");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- openaiCompatible.test`
Expected: FAIL — `Cannot find module './openaiCompatible'`.

- [ ] **Step 3: Implement the base provider**

```ts
// packages/app/src/ai/providers/openaiCompatible.ts
import type { GenerateOptions, LLMProvider, Message, StreamCallbacks, ToolDefinition } from "../types";

import { readLines, sseData } from "./shared";

export interface OpenAICompatOptions {
  baseUrl: string; // e.g. http://localhost:1234/v1
  apiKey?: string;
  defaultModel?: string;
}

/** OpenAI Chat Completions wire format against any compatible base URL.
 *  Covers OpenAI itself (see openai.ts) plus LM Studio / llama.cpp / vLLM / OpenRouter. */
export class OpenAICompatibleProvider implements LLMProvider {
  protected baseUrl: string;
  protected apiKey?: string;
  protected defaultModel: string;

  constructor(opts: OpenAICompatOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.defaultModel ?? "local-model";
  }

  protected headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.baseUrl);
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [this.defaultModel];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = data.data?.map((m) => m.id) ?? [];
      return ids.length ? ids : [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }

  async generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    cb: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      messages: messages.map(toOpenAIMsg),
      stream: true,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    };
    if (tools.length) body.tools = tools;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (!res.ok) {
      cb.onError(new Error(`LLM error: ${res.status} ${await safeText(res)}`));
      return;
    }

    const acc = new Map<number, { id: string; name: string; args: string }>();
    try {
      await readLines(res, (line) => {
        const payload = sseData(line);
        if (payload === null || payload === "[DONE]") return;
        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAIStreamChunk;
        } catch {
          return;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        if (delta.content) cb.onToken(delta.content);
        for (const tc of delta.tool_calls ?? []) {
          const cur = acc.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          acc.set(tc.index, cur);
        }
      });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    for (const buf of acc.values()) {
      try {
        cb.onToolCall?.({
          id: buf.id || crypto.randomUUID(),
          name: buf.name,
          arguments: JSON.parse(buf.args || "{}") as Record<string, unknown>,
        });
      } catch {
        // skip malformed tool-call args
      }
    }
    cb.onDone();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function toOpenAIMsg(m: Message): Record<string, unknown> {
  const msg: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.role === "tool" && m.toolCallId) msg.tool_call_id = m.toolCallId;
  if (m.role === "assistant" && m.toolCalls?.length) {
    msg.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  return msg;
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
}
```

- [ ] **Step 4: Implement the OpenAI subclass**

```ts
// packages/app/src/ai/providers/openai.ts
import { OpenAICompatibleProvider } from "./openaiCompatible";

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, defaultModel = "gpt-4o-mini") {
    super({ baseUrl: "https://api.openai.com/v1", apiKey, defaultModel });
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- openaiCompatible.test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ai/providers/openaiCompatible.ts packages/app/src/ai/providers/openai.ts packages/app/src/ai/providers/openaiCompatible.test.ts
git commit -m "feat(app): OpenAI-compatible provider (fix assistant tool_calls round-trip) + OpenAI subclass"
```

---

### Task 4: Anthropic provider

**Files:**
- Create: `packages/app/src/ai/providers/anthropic.ts`
- Test: `packages/app/src/ai/providers/anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, ToolDefinition } from "../types";

import { AnthropicProvider } from "./anthropic";

function sseRes(events: object[]): Response {
  const lines = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

const tools: ToolDefinition[] = [
  { type: "function", function: { name: "create_form", description: "Make a form", parameters: { type: "object", properties: {} } } },
];

describe("AnthropicProvider.generateStream", () => {
  it("streams text + a tool_use block and sends the right headers/body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseRes([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Working" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "create_form", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"title":' } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Hi"}' } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]),
    );

    const tokens: string[] = [];
    const calls: { name: string; args: unknown }[] = [];
    await new AnthropicProvider("sk-ant").generateStream(
      [{ id: "1", role: "system", content: "be helpful", timestamp: 0 }, { id: "2", role: "user", content: "make a form", timestamp: 0 }],
      tools,
      {
        onToken: (t) => tokens.push(t),
        onToolCall: (c) => calls.push({ name: c.name, args: c.arguments }),
        onDone: () => {},
        onError: (e) => { throw e; },
      },
      { model: "claude-sonnet-4-6" },
    );

    expect(tokens.join("")).toBe("Working");
    expect(calls).toEqual([{ name: "create_form", args: { title: "Hi" } }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-ant");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.system).toBe("be helpful");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: "user", content: "make a form" }]);
    expect(body.tools[0]).toMatchObject({ name: "create_form", description: "Make a form" });
    expect(body.tools[0].input_schema).toMatchObject({ type: "object" });
  });

  it("maps assistant tool_calls and tool results to tool_use/tool_result blocks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseRes([{ type: "message_stop" }]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "do it", timestamp: 0 },
      { id: "2", role: "assistant", content: "sure", timestamp: 0, toolCalls: [{ id: "toolu_1", name: "create_form", arguments: { title: "X" } }] },
      { id: "3", role: "tool", content: "made form abc", timestamp: 0, toolCallId: "toolu_1" },
    ];
    await new AnthropicProvider("k").generateStream(messages, tools, {
      onToken: () => {}, onDone: () => {}, onError: (e) => { throw e; },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "create_form", input: { title: "X" } }],
    });
    expect(body.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "made form abc" }],
    });
  });

  it("coalesces consecutive tool results into one user turn", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseRes([{ type: "message_stop" }]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "two things", timestamp: 0 },
      { id: "2", role: "assistant", content: "", timestamp: 0, toolCalls: [
        { id: "toolu_1", name: "create_form", arguments: {} },
        { id: "toolu_2", name: "create_form", arguments: {} },
      ] },
      { id: "3", role: "tool", content: "a", timestamp: 0, toolCallId: "toolu_1" },
      { id: "4", role: "tool", content: "b", timestamp: 0, toolCallId: "toolu_2" },
    ];
    await new AnthropicProvider("k").generateStream(messages, tools, {
      onToken: () => {}, onDone: () => {}, onError: (e) => { throw e; },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "a" },
      { type: "tool_result", tool_use_id: "toolu_2", content: "b" },
    ]);
  });

  it("isAvailable reflects key presence", async () => {
    expect(await new AnthropicProvider("k").isAvailable()).toBe(true);
    expect(await new AnthropicProvider("").isAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- anthropic.test`
Expected: FAIL — `Cannot find module './anthropic'`.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/ai/providers/anthropic.ts
import type { GenerateOptions, LLMProvider, Message, StreamCallbacks, ToolDefinition } from "../types";

import { readLines, sseData } from "./shared";

const API = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

/** Anthropic Messages API. Browser-direct (BYOK) via the dangerous-direct-access header. */
export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel = "claude-sonnet-4-6") {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [this.defaultModel];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = data.data?.map((m) => m.id).filter((id) => id.startsWith("claude")) ?? [];
      return ids.length ? ids : [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }

  async generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    cb: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      messages: toAnthropicMessages(messages),
      ...(system ? { system } : {}),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
    if (tools.length) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${API}/messages`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (!res.ok) {
      cb.onError(new Error(`Anthropic error: ${res.status} ${await safeText(res)}`));
      return;
    }

    // index → tool_use accumulator (only for tool_use content blocks)
    const tools_ = new Map<number, { id: string; name: string; json: string }>();
    try {
      await readLines(res, (line) => {
        const payload = sseData(line);
        if (payload === null) return;
        let ev: AnthropicEvent;
        try {
          ev = JSON.parse(payload) as AnthropicEvent;
        } catch {
          return;
        }
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          tools_.set(ev.index!, { id: ev.content_block.id!, name: ev.content_block.name!, json: "" });
        } else if (ev.type === "content_block_delta") {
          if (ev.delta?.type === "text_delta" && ev.delta.text) cb.onToken(ev.delta.text);
          else if (ev.delta?.type === "input_json_delta") {
            const cur = tools_.get(ev.index!);
            if (cur) cur.json += ev.delta.partial_json ?? "";
          }
        } else if (ev.type === "content_block_stop") {
          const cur = tools_.get(ev.index!);
          if (cur) {
            try {
              cb.onToolCall?.({
                id: cur.id || crypto.randomUUID(),
                name: cur.name,
                arguments: JSON.parse(cur.json || "{}") as Record<string, unknown>,
              });
            } catch {
              // skip malformed tool input
            }
            tools_.delete(ev.index!);
          }
        }
      });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    cb.onDone();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Neutral Message[] → Anthropic messages[] (system extracted by caller).
 *  Consecutive tool results coalesce into one user turn of tool_result blocks. */
function toAnthropicMessages(messages: Message[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : m.content });
    } else if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const prev = out[out.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        (prev.content as Array<unknown>).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- anthropic.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ai/providers/anthropic.ts packages/app/src/ai/providers/anthropic.test.ts
git commit -m "feat(app): real Anthropic Messages provider (tool_use/tool_result, SSE)"
```

---

### Task 5: Gemini provider

**Files:**
- Create: `packages/app/src/ai/providers/gemini.ts`
- Test: `packages/app/src/ai/providers/gemini.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, ToolDefinition } from "../types";

import { GeminiProvider } from "./gemini";

function sseRes(events: object[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

const tools: ToolDefinition[] = [
  { type: "function", function: { name: "create_poll", description: "Make a poll", parameters: { type: "object", properties: { q: { type: "string" } }, additionalProperties: false } } },
];

describe("GeminiProvider.generateStream", () => {
  it("streams text + functionCall and builds the right request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseRes([
        { candidates: [{ content: { parts: [{ text: "Sure " }] } }] },
        { candidates: [{ content: { parts: [{ text: "thing" }] } }] },
        { candidates: [{ content: { parts: [{ functionCall: { name: "create_poll", args: { q: "lunch?" } } }] } }] },
      ]),
    );

    const tokens: string[] = [];
    const calls: { name: string; args: unknown }[] = [];
    await new GeminiProvider("gkey").generateStream(
      [{ id: "1", role: "system", content: "be brief", timestamp: 0 }, { id: "2", role: "user", content: "poll", timestamp: 0 }],
      tools,
      {
        onToken: (t) => tokens.push(t),
        onToolCall: (c) => calls.push({ name: c.name, args: c.arguments }),
        onDone: () => {},
        onError: (e) => { throw e; },
      },
      { model: "gemini-2.0-flash" },
    );

    expect(tokens.join("")).toBe("Sure thing");
    expect(calls).toEqual([{ name: "create_poll", args: { q: "lunch?" } }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.0-flash:streamGenerateContent");
    expect(url).toContain("alt=sse");
    expect(url).toContain("key=gkey");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "poll" }] }]);
    expect(body.tools[0].functionDeclarations[0].name).toBe("create_poll");
    // unsupported JSON-schema keys stripped for Gemini
    expect(body.tools[0].functionDeclarations[0].parameters.additionalProperties).toBeUndefined();
  });

  it("maps assistant functionCall + tool result to model/functionResponse parts (name by id)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseRes([]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "go", timestamp: 0 },
      { id: "2", role: "assistant", content: "", timestamp: 0, toolCalls: [{ id: "x1", name: "create_poll", arguments: { q: "a" } }] },
      { id: "3", role: "tool", content: "poll made", timestamp: 0, toolCallId: "x1" },
    ];
    await new GeminiProvider("k").generateStream(messages, tools, {
      onToken: () => {}, onDone: () => {}, onError: (e) => { throw e; },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[1]).toEqual({ role: "model", parts: [{ functionCall: { name: "create_poll", args: { q: "a" } } }] });
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "create_poll", response: { result: "poll made" } } }] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- gemini.test`
Expected: FAIL — `Cannot find module './gemini'`.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/ai/providers/gemini.ts
import type { GenerateOptions, LLMProvider, Message, StreamCallbacks, ToolDefinition } from "../types";

import { readLines, sseData } from "./shared";

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Google Gemini generateContent (SSE). Browser-direct (BYOK) via ?key=. */
export class GeminiProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel = "gemini-2.0-flash") {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${API}/models?key=${encodeURIComponent(this.apiKey)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [this.defaultModel];
      const data = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
      const ids = (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      return ids.length ? ids : [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }

  async generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    cb: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void> {
    const model = options?.model ?? this.defaultModel;
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body: Record<string, unknown> = { contents: toGeminiContents(messages) };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools.length) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: cleanSchema(t.function.parameters),
          })),
        },
      ];
    }

    const url = `${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (!res.ok) {
      cb.onError(new Error(`Gemini error: ${res.status} ${await safeText(res)}`));
      return;
    }

    try {
      await readLines(res, (line) => {
        const payload = sseData(line);
        if (payload === null) return;
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(payload) as GeminiChunk;
        } catch {
          return;
        }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) cb.onToken(part.text);
          else if (part.functionCall) {
            cb.onToolCall?.({
              id: crypto.randomUUID(),
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
            });
          }
        }
      });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    cb.onDone();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Strip JSON-schema keys Gemini rejects (`$schema`, `additionalProperties`). */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties") continue;
      out[k] = cleanSchema(v);
    }
    return out;
  }
  return schema;
}

/** Neutral Message[] → Gemini contents[]. Tool results map by tool name,
 *  resolved from the assistant turn that issued the call (id → name). */
function toGeminiContents(messages: Message[]): Array<Record<string, unknown>> {
  const nameById = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) nameById.set(tc.id, tc.name);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      out.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
    } else if (m.role === "tool") {
      const name = (m.toolCallId && nameById.get(m.toolCallId)) || "tool";
      out.push({ role: "user", parts: [{ functionResponse: { name, response: { result: m.content } } }] });
    }
  }
  return out;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: unknown } }> } }>;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- gemini.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/ai/providers/gemini.ts packages/app/src/ai/providers/gemini.test.ts
git commit -m "feat(app): Gemini provider (functionDeclarations/functionCall/functionResponse)"
```

---

### Task 6: Ollama provider (move + smoke test)

**Files:**
- Create: `packages/app/src/ai/providers/ollama.ts`
- Test: `packages/app/src/ai/providers/ollama.test.ts`

- [ ] **Step 1: Create `ollama.ts` by porting from `provider.ts`**

Copy the `OllamaProvider` class out of `packages/app/src/ai/provider.ts` into `packages/app/src/ai/providers/ollama.ts`, with these adjustments:
- Imports become `import type { GenerateOptions, LLMProvider, Message, StreamCallbacks, ToolDefinition } from "../types";`
- **Delete the `generate()` method** (removed from the interface in Task 1).
- Keep `generateStream`, `getAvailableModels`, `isAvailable`, and the private helpers (`toOllamaMsg`, `parseOllamaToolCalls`) + the `OllamaToolCall`/`OllamaChatResponse` interfaces it uses. (`parseOllamaToolCalls` was only used by `generate`; if so, delete it too — verify with a grep before deleting.)

The resulting `generateStream` is byte-identical to the current one (it reads NDJSON lines directly via its own reader; leave that as-is — no need to route it through `shared.ts`).

- [ ] **Step 2: Write a smoke test**

```ts
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
      { onToken: (t) => tokens.push(t), onDone: () => (done = true), onError: (e) => { throw e; } },
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
```

- [ ] **Step 3: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- ollama.test`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/ai/providers/ollama.ts packages/app/src/ai/providers/ollama.test.ts
git commit -m "feat(app): move OllamaProvider into providers/ (drop dead generate)"
```

---

### Task 7: `createProvider` factory + barrel

**Files:**
- Create: `packages/app/src/ai/providers/factory.ts`
- Create: `packages/app/src/ai/providers/index.ts`
- Test: `packages/app/src/ai/providers/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { AnthropicProvider } from "./anthropic";
import { createProvider } from "./factory";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import { OpenAIProvider } from "./openai";

const base = {
  apiKeys: { anthropic: "a", openai: "o", gemini: "g" },
  ollamaUrl: "http://localhost:11434",
  compatBaseUrl: "http://localhost:1234/v1",
  compatKey: null,
};

describe("createProvider", () => {
  it("selects the active provider", () => {
    expect(createProvider({ ...base, aiProvider: "anthropic" })).toBeInstanceOf(AnthropicProvider);
    expect(createProvider({ ...base, aiProvider: "openai" })).toBeInstanceOf(OpenAIProvider);
    expect(createProvider({ ...base, aiProvider: "gemini" })).toBeInstanceOf(GeminiProvider);
    expect(createProvider({ ...base, aiProvider: "ollama" })).toBeInstanceOf(OllamaProvider);
    const compat = createProvider({ ...base, aiProvider: "openai-compat" });
    expect(compat).toBeInstanceOf(OpenAICompatibleProvider);
    expect(compat).not.toBeInstanceOf(OpenAIProvider);
  });

  it("tolerates missing keys without throwing (availability gates later)", () => {
    expect(() => createProvider({ ...base, apiKeys: {}, aiProvider: "anthropic" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- factory.test`
Expected: FAIL — `Cannot find module './factory'`.

- [ ] **Step 3: Implement the factory**

```ts
// packages/app/src/ai/providers/factory.ts
import type { LLMProvider } from "../types";

import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import { OpenAIProvider } from "./openai";

export type AIProviderType = "anthropic" | "openai" | "gemini" | "ollama" | "openai-compat";

export interface ProviderSettings {
  aiProvider: AIProviderType;
  apiKeys: { anthropic?: string; openai?: string; gemini?: string };
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
}

export function createProvider(s: ProviderSettings): LLMProvider {
  switch (s.aiProvider) {
    case "anthropic":
      return new AnthropicProvider(s.apiKeys.anthropic ?? "");
    case "openai":
      return new OpenAIProvider(s.apiKeys.openai ?? "");
    case "gemini":
      return new GeminiProvider(s.apiKeys.gemini ?? "");
    case "openai-compat":
      return new OpenAICompatibleProvider({ baseUrl: s.compatBaseUrl, apiKey: s.compatKey ?? undefined });
    case "ollama":
    default:
      return new OllamaProvider(s.ollamaUrl);
  }
}
```

- [ ] **Step 4: Implement the barrel**

```ts
// packages/app/src/ai/providers/index.ts
export { AnthropicProvider } from "./anthropic";
export { GeminiProvider } from "./gemini";
export { OllamaProvider } from "./ollama";
export { OpenAIProvider } from "./openai";
export { OpenAICompatibleProvider } from "./openaiCompatible";
export { createProvider } from "./factory";
export type { AIProviderType, ProviderSettings } from "./factory";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- factory.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/ai/providers/factory.ts packages/app/src/ai/providers/index.ts packages/app/src/ai/providers/factory.test.ts
git commit -m "feat(app): createProvider factory + providers barrel"
```

---

### Task 8: Rewire `ai/index.ts` and delete `provider.ts`

**Files:**
- Modify: `packages/app/src/ai/index.ts`
- Delete: `packages/app/src/ai/provider.ts`

- [ ] **Step 1: Update `ai/index.ts` exports**

Replace the provider export line:

```ts
export { OllamaProvider, CloudLLMProvider, createLLMProvider } from "./provider";
```

with:

```ts
export {
  AnthropicProvider,
  GeminiProvider,
  OllamaProvider,
  OpenAIProvider,
  OpenAICompatibleProvider,
  createProvider,
} from "./providers";
export type { AIProviderType, ProviderSettings } from "./providers";
```

(Leave the `export type { … } from "./types"` block as-is; it no longer needs `StreamCallbacks` changes beyond what Task 1 did.)

- [ ] **Step 2: Delete the old file**

```bash
git rm packages/app/src/ai/provider.ts
```

- [ ] **Step 3: Typecheck (aiStore will still fail — fixed in Task 10)**

Run: `pnpm --filter @formstr/app exec tsc --noEmit 2>&1 | head -20`
Expected: the only remaining errors are in `stores/aiStore.ts` (still imports `createLLMProvider`). That's Task 10. The `ai/` graph itself is clean.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/ai/index.ts
git commit -m "refactor(app): point ai barrel at providers/, delete legacy provider.ts"
```

---

### Task 9: `settingsStore` — per-provider BYOK shape + migration

**Files:**
- Modify: `packages/app/src/stores/settingsStore.ts`
- Test: `packages/app/src/stores/settingsStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

import { migrateAISettings, readAISettings } from "./settingsStore";

describe("AI settings migration", () => {
  beforeEach(() => localStorage.clear());

  it("migrates a legacy single anthropic key + model + endpoint", () => {
    localStorage.setItem("formstr:ai-provider", "anthropic");
    localStorage.setItem("formstr:ai-apikey", "sk-ant-legacy");
    localStorage.setItem("formstr:ai-model", "claude-3-5-sonnet");
    localStorage.setItem("formstr:ai-endpoint", "http://host:11434");

    migrateAISettings();
    const s = readAISettings();

    expect(s.aiProvider).toBe("anthropic");
    expect(s.apiKeys.anthropic).toBe("sk-ant-legacy");
    expect(s.aiModels.anthropic).toBe("claude-3-5-sonnet");
    expect(s.ollamaUrl).toBe("http://host:11434");
    // migration marker written
    expect(localStorage.getItem("formstr:ai-keys")).not.toBeNull();
  });

  it("migrates a legacy ollama model into aiModels.ollama and is idempotent", () => {
    localStorage.setItem("formstr:ai-provider", "ollama");
    localStorage.setItem("formstr:ai-model", "qwen2.5:7b");

    migrateAISettings();
    // a second run must not clobber
    localStorage.setItem("formstr:ai-keys", JSON.stringify({ openai: "added-later" }));
    migrateAISettings();

    const s = readAISettings();
    expect(s.aiModels.ollama).toBe("qwen2.5:7b");
    expect(s.apiKeys.openai).toBe("added-later");
  });

  it("defaults cleanly when nothing is stored", () => {
    migrateAISettings();
    const s = readAISettings();
    expect(s.aiProvider).toBe("ollama");
    expect(s.apiKeys).toEqual({});
    expect(s.aiModels).toEqual({});
    expect(s.ollamaUrl).toBe("http://localhost:11434");
    expect(s.compatBaseUrl).toBe("http://localhost:1234/v1");
    expect(s.compatKey).toBeNull();
  });
});

describe("settings setters", () => {
  beforeEach(() => localStorage.clear());

  it("setApiKey / setProviderModel / setActiveProvider persist to localStorage and state", async () => {
    const { useSettingsStore } = await import("./settingsStore");
    useSettingsStore.getState().setApiKey("openai", "sk-openai");
    useSettingsStore.getState().setProviderModel("openai", "gpt-4o");
    useSettingsStore.getState().setActiveProvider("openai");

    expect(useSettingsStore.getState().apiKeys.openai).toBe("sk-openai");
    expect(useSettingsStore.getState().aiModels.openai).toBe("gpt-4o");
    expect(useSettingsStore.getState().aiProvider).toBe("openai");
    expect(JSON.parse(localStorage.getItem("formstr:ai-keys")!).openai).toBe("sk-openai");
    expect(JSON.parse(localStorage.getItem("formstr:ai-models")!).openai).toBe("gpt-4o");
    expect(localStorage.getItem("formstr:ai-provider")).toBe("openai");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- settingsStore.test`
Expected: FAIL — `migrateAISettings`/`readAISettings` are not exported.

- [ ] **Step 3: Rewrite the AI portion of `settingsStore.ts`**

Replace the `AIProviderType` type, the `interface SettingsStore` AI fields + AI methods, the AI initializers, and `setAIConfig` with the following. Keep the theme/sidebar/formsView parts untouched.

Add near the top (after `type ThemeMode`):

```ts
export type AIProviderType = "anthropic" | "openai" | "gemini" | "ollama" | "openai-compat";
export type CloudProvider = "anthropic" | "openai" | "gemini";
export type ApiKeys = { anthropic?: string; openai?: string; gemini?: string };

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_COMPAT_URL = "http://localhost:1234/v1";

interface AISettingsState {
  aiProvider: AIProviderType;
  apiKeys: ApiKeys;
  aiModels: Partial<Record<AIProviderType, string>>;
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
}

/** One-time migration from the legacy single-key shape. Idempotent: gated on the
 *  presence of "formstr:ai-keys". Safe to call on every module load. */
export function migrateAISettings(): void {
  if (localStorage.getItem("formstr:ai-keys") !== null) return; // already migrated

  const legacyProvider = localStorage.getItem("formstr:ai-provider");
  const legacyKey = localStorage.getItem("formstr:ai-apikey");
  const legacyModel = localStorage.getItem("formstr:ai-model");
  const legacyEndpoint = localStorage.getItem("formstr:ai-endpoint");

  const apiKeys: ApiKeys = {};
  if (legacyKey && (legacyProvider === "openai" || legacyProvider === "anthropic")) {
    apiKeys[legacyProvider] = legacyKey;
  }
  const aiModels: Partial<Record<AIProviderType, string>> = {};
  if (legacyModel && legacyProvider && isAIProvider(legacyProvider)) {
    aiModels[legacyProvider] = legacyModel;
  }

  localStorage.setItem("formstr:ai-keys", JSON.stringify(apiKeys));
  localStorage.setItem("formstr:ai-models", JSON.stringify(aiModels));
  if (legacyEndpoint) localStorage.setItem("formstr:ai-ollama-url", legacyEndpoint);
}

/** Read the (already-migrated) AI settings out of localStorage. */
export function readAISettings(): AISettingsState {
  return {
    aiProvider: (localStorage.getItem("formstr:ai-provider") as AIProviderType) ?? "ollama",
    apiKeys: parseJson<ApiKeys>(localStorage.getItem("formstr:ai-keys"), {}),
    aiModels: parseJson<Partial<Record<AIProviderType, string>>>(localStorage.getItem("formstr:ai-models"), {}),
    ollamaUrl: localStorage.getItem("formstr:ai-ollama-url") ?? DEFAULT_OLLAMA_URL,
    compatBaseUrl: localStorage.getItem("formstr:ai-compat-base-url") ?? DEFAULT_COMPAT_URL,
    compatKey: localStorage.getItem("formstr:ai-compat-key"),
  };
}

function isAIProvider(v: string): v is AIProviderType {
  return ["anthropic", "openai", "gemini", "ollama", "openai-compat"].includes(v);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
```

Run the migration before constructing the store (alongside the existing `applyTheme(storedTheme)` call):

```ts
migrateAISettings();
const _ai = readAISettings();
```

In `interface SettingsStore`, replace the AI block:

```ts
  // AI settings
  aiProvider: AIProviderType;
  apiKeys: ApiKeys;
  aiModels: Partial<Record<AIProviderType, string>>;
  ollamaUrl: string;
  compatBaseUrl: string;
  compatKey: string | null;
  aiPanelOpen: boolean;
```

and replace the AI methods:

```ts
  setActiveProvider(provider: AIProviderType): void;
  setApiKey(provider: CloudProvider, key: string | null): void;
  setProviderModel(provider: AIProviderType, model: string | null): void;
  setOllamaUrl(url: string): void;
  setCompatConfig(config: { baseUrl?: string; key?: string | null }): void;
  setAIPanelOpen(open: boolean): void;
```

In `create<SettingsStore>((set) => ({ … }))`, replace the AI initializers:

```ts
  aiProvider: _ai.aiProvider,
  apiKeys: _ai.apiKeys,
  aiModels: _ai.aiModels,
  ollamaUrl: _ai.ollamaUrl,
  compatBaseUrl: _ai.compatBaseUrl,
  compatKey: _ai.compatKey,
  aiPanelOpen: false,
```

and replace `setAIConfig` with:

```ts
  setActiveProvider(provider) {
    localStorage.setItem("formstr:ai-provider", provider);
    set({ aiProvider: provider });
  },

  setApiKey(provider, key) {
    set((state) => {
      const apiKeys = { ...state.apiKeys };
      if (key) apiKeys[provider] = key;
      else delete apiKeys[provider];
      localStorage.setItem("formstr:ai-keys", JSON.stringify(apiKeys));
      return { apiKeys };
    });
  },

  setProviderModel(provider, model) {
    set((state) => {
      const aiModels = { ...state.aiModels };
      if (model) aiModels[provider] = model;
      else delete aiModels[provider];
      localStorage.setItem("formstr:ai-models", JSON.stringify(aiModels));
      return { aiModels };
    });
  },

  setOllamaUrl(url) {
    localStorage.setItem("formstr:ai-ollama-url", url);
    set({ ollamaUrl: url });
  },

  setCompatConfig(config) {
    set((state) => {
      const next: Partial<Pick<SettingsStore, "compatBaseUrl" | "compatKey">> = {};
      if (config.baseUrl !== undefined) {
        localStorage.setItem("formstr:ai-compat-base-url", config.baseUrl);
        next.compatBaseUrl = config.baseUrl;
      }
      if (config.key !== undefined) {
        if (config.key) localStorage.setItem("formstr:ai-compat-key", config.key);
        else localStorage.removeItem("formstr:ai-compat-key");
        next.compatKey = config.key;
      }
      return { ...state, ...next };
    });
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- settingsStore.test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/stores/settingsStore.ts packages/app/src/stores/settingsStore.test.ts
git commit -m "feat(app): per-provider BYOK settings + one-time legacy migration"
```

---

### Task 10: Rewire `aiStore` + `AIChatPanel` to the new provider/settings API

**Files:**
- Modify: `packages/app/src/stores/aiStore.ts`
- Modify: `packages/app/src/stores/aiStore.test.ts`
- Modify: `packages/app/src/components/ai/AIChatPanel.tsx`

- [ ] **Step 1: Update the `aiStore.test.ts` mock to `createProvider`**

In `aiStore.test.ts`, inside the `vi.mock("../ai", …)` factory, replace the `createLLMProvider` mock with:

```ts
    createProvider: vi.fn(() => ({
      getAvailableModels: async () => ["fake-model"],
      isAvailable: async () => true,
      generateStream: async () => {},
    })),
```

(The `FakeAgent` and all existing assertions stay unchanged.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @formstr/app test -- aiStore.test`
Expected: FAIL — `aiStore.ts` still imports `createLLMProvider` and reads `aiEndpoint`/`aiApiKey` (now removed from settings), so the store init mismatches.

- [ ] **Step 3: Rewire `aiStore.ts`**

Change the import:

```ts
import { createProvider, ConversationContext, Agent } from "../ai";
```

Replace `initProvider`:

```ts
  async initProvider() {
    const settings = useSettingsStore.getState();
    set({ providerStatus: "connecting", errorMessage: null });

    try {
      const provider = createProvider({
        aiProvider: settings.aiProvider,
        apiKeys: settings.apiKeys,
        ollamaUrl: settings.ollamaUrl,
        compatBaseUrl: settings.compatBaseUrl,
        compatKey: settings.compatKey,
      });

      if (!(await provider.isAvailable())) {
        set({ providerStatus: "error", errorMessage: unavailableMessage(settings.aiProvider) });
        return;
      }

      const models = await provider.getAvailableModels();
      const context = get()._context;
      const agent = new Agent(provider, context);

      // Auto-select the first model when none is chosen for this provider.
      if (!settings.aiModels[settings.aiProvider] && models.length > 0) {
        useSettingsStore.getState().setProviderModel(settings.aiProvider, models[0]);
      }

      set({ _provider: provider, _agent: agent, availableModels: models, providerStatus: "connected" });
    } catch (e) {
      set({
        providerStatus: "error",
        errorMessage: e instanceof Error ? e.message : "Failed to connect to AI provider",
      });
    }
  },
```

In `sendMessage`, change the model read:

```ts
    const { aiProvider, aiModels } = useSettingsStore.getState();
    const aiModel = aiModels[aiProvider] ?? undefined;
```

and pass `aiModel` (already `string | undefined`) to `agent.run(content, pubkey, { … }, aiModel)` (drop the `?? undefined`).

Replace `setModel`:

```ts
  setModel(model: string) {
    const { aiProvider } = useSettingsStore.getState();
    useSettingsStore.getState().setProviderModel(aiProvider, model);
  },
```

Add the helper at the bottom of the file (module scope):

```ts
function unavailableMessage(provider: string): string {
  if (provider === "ollama") return "Ollama is not reachable. Start it or pick a cloud provider in Settings.";
  if (provider === "openai-compat") return "No local endpoint configured. Set a base URL in Settings.";
  return "No API key configured for this provider. Add one in Settings.";
}
```

- [ ] **Step 4: Fix `AIChatPanel.tsx` (one line)**

Replace line 55:

```ts
  const { aiPanelOpen, setAIPanelOpen, aiModel } = useSettingsStore();
```

with:

```ts
  const { aiPanelOpen, setAIPanelOpen, aiProvider, aiModels } = useSettingsStore();
  const aiModel = aiModels[aiProvider] ?? null;
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- aiStore.test`
Expected: PASS (all existing aiStore tests green).

- [ ] **Step 6: Typecheck the app**

Run: `pnpm --filter @formstr/app exec tsc --noEmit`
Expected: clean (0 errors).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/stores/aiStore.ts packages/app/src/stores/aiStore.test.ts packages/app/src/components/ai/AIChatPanel.tsx
git commit -m "feat(app): drive the AI store from createProvider + per-provider BYOK settings"
```

---

### Task 11: Whole-repo green gate

**Files:** none (verification only).

- [ ] **Step 1: Run all app tests**

Run: `pnpm --filter @formstr/app test`
Expected: PASS — existing suites plus the new `shared`, `openaiCompatible`, `anthropic`, `gemini`, `ollama`, `factory`, `settingsStore` tests.

- [ ] **Step 2: Whole-repo typecheck**

Run: `pnpm -r typecheck`
Expected: PASS in core / agent / app / mcp.

- [ ] **Step 3: Whole-repo tests**

Run: `pnpm -r test`
Expected: PASS in all packages (Stage 2 touches only `@formstr/app`; core/agent/mcp unchanged).

- [ ] **Step 4: Whole-repo build**

Run: `pnpm -r build`
Expected: PASS. (The app bundles the new providers; no SDK was added — confirm `packages/app/package.json` gained no `@anthropic-ai`/`openai`/`@google` dependency.)

- [ ] **Step 5: Lint**

Run: `pnpm --filter @formstr/app exec eslint src/ai/providers src/stores/settingsStore.ts src/stores/aiStore.ts`
Expected: 0 errors (warnings tolerated, matching the Stage-0 import/order baseline).

- [ ] **Step 6: Final stage commit (only if Step 1-5 surfaced fixups)**

If any fixups were needed, commit them:

```bash
git add -A
git commit -m "chore(app): Stage 2 green gate (providers + BYOK)"
```

Otherwise Stage 2 is complete across the per-task commits above.

---

## Self-review

**1. Spec coverage (§4.4 / §4.5 / §6 / §7):**
- AnthropicProvider (real `/v1/messages`, headers, tool_use/tool_result, SSE) → Task 4. ✓
- OpenAIProvider (refine existing) → Task 3 (subclass) + the assistant-`tool_calls` fix. ✓
- GeminiProvider (`:streamGenerateContent`, functionDeclarations) → Task 5. ✓
- OllamaProvider (existing) → Task 6. ✓
- OpenAICompatibleProvider (configurable base URL + optional key) → Task 3. ✓
- `createProvider(settings)` factory → Task 7. ✓
- Settings: per-provider `apiKeys` + `aiModels` + `ollamaUrl` + `compatBaseUrl`/`compatKey` + one-time migration → Task 9. ✓
- Testing: provider adapters with mocked `fetch` (Anthropic/Gemini/OpenAI/Ollama tool round-trips) + `settingsStore` migration; backend/logic only, no new frontend component tests → Tasks 2-7, 9, 10. ✓

**2. Placeholder scan:** no TBD/TODO/"add error handling"; every code step shows complete code. ✓

**3. Type consistency:** `AIProviderType` is identical in `settingsStore.ts` and `factory.ts` (kept in sync deliberately — `ProviderSettings` is structurally what `initProvider` passes); `ProviderSettings` fields (`aiProvider`, `apiKeys`, `ollamaUrl`, `compatBaseUrl`, `compatKey`) match `readAISettings()`'s output and the object `aiStore.initProvider` builds. `setProviderModel(provider, model)` signature matches both the `setModel` caller and the auto-select caller. `LLMProvider` (trimmed in Task 1) is implemented by all five providers (3 methods each). ✓

**Note on the two `AIProviderType` declarations:** `factory.ts` re-declares the union (so `@formstr/app/ai` has no import cycle back into `stores`). They must stay identical — if the union ever changes, update both. This is intentional, not a placeholder.
