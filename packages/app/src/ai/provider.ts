import type {
  Message,
  ToolDefinition,
  ToolCall,
  GenerateOptions,
  StreamCallbacks,
  LLMProvider,
} from "./types";

// ── Ollama Provider ─────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  private endpoint: string;
  private _defaultModel: string | null = null;

  constructor(endpoint = "http://localhost:11434") {
    this.endpoint = endpoint.replace(/\/$/, "");
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) ?? [];
      // Cache the first available model as default
      if (models.length > 0 && !this._defaultModel) {
        this._defaultModel = models[0];
      }
      return models;
    } catch {
      return [];
    }
  }

  async generate(
    messages: Message[],
    options?: GenerateOptions,
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options?.model ?? this._defaultModel ?? "qwen2.5",
        messages: messages.map(toOllamaMsg),
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          ...(options?.maxTokens ? { num_predict: options.maxTokens } : {}),
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as OllamaChatResponse;
    return {
      content: data.message?.content ?? "",
      toolCalls: parseOllamaToolCalls(data.message),
    };
  }

  async generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: options?.model ?? this._defaultModel ?? "qwen2.5",
      messages: messages.map(toOllamaMsg),
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
        ...(options?.maxTokens ? { num_predict: options.maxTokens } : {}),
      },
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: t.function,
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    if (!res.ok) {
      callbacks.onError(new Error(`Ollama error: ${res.status}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error("No response body"));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as OllamaChatResponse;
            if (chunk.message?.content) {
              callbacks.onToken(chunk.message.content);
            }
            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                callbacks.onToolCall?.({
                  id: crypto.randomUUID(),
                  name: tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? {},
                });
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    callbacks.onDone();
  }
}

// ── Cloud LLM Provider (OpenAI-compatible) ──────────────────

export class CloudLLMProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(apiKey: string, provider: "openai" | "anthropic" = "openai", model?: string) {
    this.apiKey = apiKey;
    if (provider === "anthropic") {
      this.baseUrl = "https://api.anthropic.com/v1";
      this.defaultModel = model ?? "claude-sonnet-4-20250514";
    } else {
      this.baseUrl = "https://api.openai.com/v1";
      this.defaultModel = model ?? "gpt-4o-mini";
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [this.defaultModel];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (
        data.data?.map((m) => m.id).filter((id) => id.includes("gpt") || id.includes("claude")) ?? [
          this.defaultModel,
        ]
      );
    } catch {
      return [this.defaultModel];
    }
  }

  async generate(
    messages: Message[],
    options?: GenerateOptions,
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model ?? this.defaultModel,
        messages: messages.map(toOpenAIMsg),
        temperature: options?.temperature ?? 0.7,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Cloud LLM error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as OpenAIChatResponse;
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      toolCalls: choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
    };
  }

  async generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      messages: messages.map(toOpenAIMsg),
      temperature: options?.temperature ?? 0.7,
      stream: true,
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    if (!res.ok) {
      callbacks.onError(new Error(`Cloud LLM error: ${res.status}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error("No response body"));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              callbacks.onToken(delta.content);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCallBuffers.has(tc.index)) {
                  toolCallBuffers.set(tc.index, {
                    id: tc.id ?? "",
                    name: tc.function?.name ?? "",
                    args: "",
                  });
                }
                const buf = toolCallBuffers.get(tc.index)!;
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
              }
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit accumulated tool calls
    for (const [, buf] of toolCallBuffers) {
      try {
        callbacks.onToolCall?.({
          id: buf.id || crypto.randomUUID(),
          name: buf.name,
          arguments: JSON.parse(buf.args || "{}"),
        });
      } catch {
        // skip malformed tool call args
      }
    }

    callbacks.onDone();
  }
}

// ── Factory ─────────────────────────────────────────────────

export async function createLLMProvider(config: {
  aiProvider: string;
  aiEndpoint: string;
  aiApiKey: string | null;
  aiModel: string | null;
}): Promise<LLMProvider> {
  if (config.aiProvider === "ollama") {
    const ollama = new OllamaProvider(config.aiEndpoint);
    if (await ollama.isAvailable()) return ollama;
  }

  if (config.aiApiKey && (config.aiProvider === "openai" || config.aiProvider === "anthropic")) {
    return new CloudLLMProvider(config.aiApiKey, config.aiProvider, config.aiModel ?? undefined);
  }

  // Fallback: try Ollama at default endpoint
  const fallback = new OllamaProvider();
  if (await fallback.isAvailable()) return fallback;

  throw new Error(
    "No LLM provider available. Start Ollama or configure a cloud API key in settings.",
  );
}

// ── Internal helpers ────────────────────────────────────────

function toOllamaMsg(m: Message): Record<string, unknown> {
  // Ollama's /api/chat supports role "tool" for models with native tool calling (qwen2.5, etc.)
  const msg: Record<string, unknown> = {
    role: m.role,
    content: m.content,
  };
  if (m.role === "tool" && m.toolCallId) {
    msg.tool_call_id = m.toolCallId;
  }
  // Include tool_calls on assistant messages so the model sees its own prior calls
  if (m.role === "assistant" && m.toolCalls?.length) {
    msg.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  return msg;
}

function toOpenAIMsg(m: Message): { role: string; content: string; tool_call_id?: string } {
  const msg: { role: string; content: string; tool_call_id?: string } = {
    role: m.role,
    content: m.content,
  };
  if (m.role === "tool" && m.toolCallId) {
    msg.tool_call_id = m.toolCallId;
  }
  return msg;
}

function parseOllamaToolCalls(msg?: { tool_calls?: OllamaToolCall[] }): ToolCall[] | undefined {
  if (!msg?.tool_calls?.length) return undefined;
  return msg.tool_calls.map((tc) => ({
    id: crypto.randomUUID(),
    name: tc.function?.name ?? "",
    arguments: tc.function?.arguments ?? {},
  }));
}

// ── Response types ──────────────────────────────────────────

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
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
