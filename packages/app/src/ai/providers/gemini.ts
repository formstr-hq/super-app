import type {
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolDefinition,
} from "../types";

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
      const data = (await res.json()) as {
        models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
      };
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
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
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
      for (const tc of m.toolCalls ?? [])
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      out.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
    } else if (m.role === "tool") {
      const name = (m.toolCallId && nameById.get(m.toolCallId)) || "tool";
      out.push({
        role: "user",
        parts: [{ functionResponse: { name, response: { result: m.content } } }],
      });
    }
  }
  return out;
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: unknown } }> };
  }>;
}
