import type {
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolDefinition,
} from "../types";

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
