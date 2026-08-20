import type {
  GenerateOptions,
  LLMProvider,
  Message,
  ProviderDiagnosis,
  StreamCallbacks,
  ToolDefinition,
} from "../types";

const PROBE_TIMEOUT_MS = 3000;

/** Why the browser could not talk to Ollama. */
export type OllamaFailure = "mixed-content" | "cors" | "unreachable" | "http-error";

export interface OllamaDiagnosis extends ProviderDiagnosis {
  reason?: OllamaFailure;
}

/** The page the request is made from. Injected so it can be tested. */
export interface PageOrigin {
  protocol: string;
  origin: string;
}

function currentPage(): PageOrigin | null {
  const loc = (globalThis as { location?: Location }).location;
  return loc ? { protocol: loc.protocol, origin: loc.origin } : null;
}

/**
 * Loopback is exempt from mixed-content blocking in Chrome but not in every
 * browser, which is why a dead localhost endpoint is reported as unreachable
 * with a hint rather than as a mixed-content failure.
 */
function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export class OllamaProvider implements LLMProvider {
  private endpoint: string;
  private _defaultModel: string | null = null;

  constructor(endpoint = "http://localhost:11434") {
    this.endpoint = endpoint.replace(/\/$/, "");
  }

  async isAvailable(): Promise<boolean> {
    return (await this.diagnose()).ok;
  }

  /**
   * One probe that answers both "can we reach Ollama" and "which models are
   * installed", and says what to do when the answer is no.
   *
   * A rejected `fetch` cannot distinguish a blocked origin from a dead port —
   * both surface as the same `TypeError`. A second request in `no-cors` mode
   * separates them: an opaque response means something *is* listening and the
   * browser refused to show it to us.
   */
  async diagnose(page: PageOrigin | null = currentPage()): Promise<OllamaDiagnosis> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch {
      return this.explainFailure(page);
    }

    if (!res.ok) {
      return {
        ok: false,
        models: [],
        reason: "http-error",
        message: `Ollama answered ${res.status} at ${this.endpoint}. Check the endpoint in Settings.`,
      };
    }

    let models: string[] = [];
    try {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      models = data.models?.map((m) => m.name) ?? [];
    } catch {
      return {
        ok: false,
        models: [],
        reason: "http-error",
        message: `${this.endpoint} answered, but not with an Ollama model list. Check the endpoint in Settings.`,
      };
    }

    if (models.length > 0 && !this._defaultModel) this._defaultModel = models[0];
    return { ok: true, models };
  }

  private async explainFailure(page: PageOrigin | null): Promise<OllamaDiagnosis> {
    let listening = false;
    try {
      await fetch(`${this.endpoint}/api/tags`, {
        mode: "no-cors",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      listening = true;
    } catch {
      listening = false;
    }

    if (listening) {
      const origin = page?.origin;
      return {
        ok: false,
        models: [],
        reason: "cors",
        message: origin
          ? `Ollama is running at ${this.endpoint} but refused a request from ${origin}. Restart it with OLLAMA_ORIGINS=${origin} to allow this app.`
          : `Ollama is running at ${this.endpoint} but refused this request. Set OLLAMA_ORIGINS to this app's URL and restart it.`,
      };
    }

    const pageIsHttps = page?.protocol === "https:";
    const endpointIsHttp = this.endpoint.startsWith("http://");
    let loopback = false;
    try {
      loopback = isLoopback(new URL(this.endpoint).hostname);
    } catch {
      loopback = false;
    }

    if (pageIsHttps && endpointIsHttp && !loopback) {
      return {
        ok: false,
        models: [],
        reason: "mixed-content",
        message: `${page?.origin ?? "This app"} is served over HTTPS, so the browser blocks ${this.endpoint} over HTTP. Put Ollama behind HTTPS, or open Formstr over HTTP.`,
      };
    }

    const httpsHint =
      pageIsHttps && endpointIsHttp
        ? " If it is running, note that some browsers block HTTP requests from an HTTPS page."
        : "";
    return {
      ok: false,
      models: [],
      reason: "unreachable",
      message: `Nothing answered at ${this.endpoint}. Start Ollama with "ollama serve", or change the endpoint in Settings.${httpsHint}`,
    };
  }

  async getAvailableModels(): Promise<string[]> {
    return (await this.diagnose()).models;
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
