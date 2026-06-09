import type {
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolDefinition,
} from "../types";

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
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}
