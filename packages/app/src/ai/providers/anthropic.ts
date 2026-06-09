import type {
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolDefinition,
} from "../types";

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
      const res = await fetch(`${API}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
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
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
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
      res = await fetch(`${API}/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (!res.ok) {
      cb.onError(new Error(`Anthropic error: ${res.status} ${await safeText(res)}`));
      return;
    }

    // index → tool_use accumulator (only for tool_use content blocks)
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
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
          toolBlocks.set(ev.index!, {
            id: ev.content_block.id!,
            name: ev.content_block.name!,
            json: "",
          });
        } else if (ev.type === "content_block_delta") {
          if (ev.delta?.type === "text_delta" && ev.delta.text) cb.onToken(ev.delta.text);
          else if (ev.delta?.type === "input_json_delta") {
            const cur = toolBlocks.get(ev.index!);
            if (cur) cur.json += ev.delta.partial_json ?? "";
          }
        } else if (ev.type === "content_block_stop") {
          const cur = toolBlocks.get(ev.index!);
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
            toolBlocks.delete(ev.index!);
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
