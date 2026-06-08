import {
  toolRegistry,
  isGated,
  CONFIRM_REQUIRED_PREFIX,
  type ToolCtx,
  type ToolResult,
} from "@formstr/agent";

import { moduleForTool, useAIPendingStore } from "../stores/aiPendingStore";

import type { ConversationContext } from "./context";
import { entityFromTool } from "./entityMap";
import { buildToolDefinitions } from "./toolSchemas";
import type {
  AgentCallbacks,
  LLMProvider,
  Message,
  RunStep,
  RunStepStatus,
  ToolCall,
} from "./types";

const MAX_STEPS = 8;
const DECLINED_TEXT = "User declined this action.";

function msg(role: Message["role"], content: string, toolCallId?: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), toolCallId };
}

const VALID_TOOL_NAMES = new Set(toolRegistry.map((t) => t.name));

/** Detect tool calls a small model embedded as plain-text JSON in its content. */
function extractTextToolCalls(text: string): ToolCall[] {
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }

  const calls: ToolCall[] = [];
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const fn = (obj.function ?? obj) as Record<string, unknown>;
      const name = typeof fn.name === "string" ? fn.name.toLowerCase() : "";
      const argsRaw = (fn.arguments ?? fn.parameters) as unknown;
      if (VALID_TOOL_NAMES.has(name) && typeof argsRaw === "object" && argsRaw !== null) {
        calls.push({
          id: crypto.randomUUID(),
          name,
          arguments: argsRaw as Record<string, unknown>,
        });
      }
    } catch {
      // not JSON — skip
    }
  }
  return calls;
}

/**
 * Provider-agnostic multi-step tool-use agent. Each iteration streams one
 * assistant turn from the provider; if it requests tools we run them against
 * the @formstr/agent registry (with allowWrites — the user's own session),
 * feed the results back, and loop so the model can chain further calls across
 * modules. Stops at a final text answer or MAX_STEPS.
 */
export class Agent {
  private provider: LLMProvider;
  private context: ConversationContext;
  private readonly ctx: ToolCtx = { allowWrites: true };

  constructor(provider: LLMProvider, context: ConversationContext) {
    this.provider = provider;
    this.context = context;
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  resetContext(): void {
    this.context.reset();
  }

  async run(
    userMessage: string,
    pubkey: string | null,
    cb: AgentCallbacks,
    model?: string,
  ): Promise<void> {
    this.context.addMessage(msg("user", userMessage));
    const system = this.context.buildSystemPrompt(pubkey);
    const tools = buildToolDefinitions();

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const messages: Message[] = [msg("system", system), ...this.context.getMessages()];
        const { text, toolCalls } = await this.runStep(messages, tools, model, cb.onToken);

        let calls = toolCalls;
        if (calls.length === 0 && text.includes("{")) {
          const extracted = extractTextToolCalls(text);
          if (extracted.length > 0) {
            calls = extracted;
            cb.onContentReset?.(); // the raw JSON will be replaced by the follow-up answer
          }
        }

        if (calls.length === 0) {
          if (text.trim()) this.context.addMessage(msg("assistant", text));
          cb.onDone();
          return;
        }

        // Record the assistant turn (with its tool_calls) so the model sees its
        // own prior calls, then clear the live buffer before executing.
        const assistant = msg("assistant", text || "");
        assistant.toolCalls = calls;
        this.context.addMessage(assistant);
        cb.onContentReset?.();

        for (const tc of calls) {
          await this.executeAndRecord(tc, cb);
        }
      }

      cb.onWarning?.(`Stopped after ${MAX_STEPS} steps to avoid an endless loop.`);
      cb.onDone();
    } catch (e) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** One provider round → accumulated text + normalized tool calls. */
  private runStep(
    messages: Message[],
    tools: ReturnType<typeof buildToolDefinitions>,
    model: string | undefined,
    onToken: (t: string) => void,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    return new Promise((resolve, reject) => {
      let text = "";
      const toolCalls: ToolCall[] = [];
      this.provider
        .generateStream(
          messages,
          tools,
          {
            onToken(t) {
              text += t;
              onToken(t);
            },
            onToolCall(tc) {
              toolCalls.push(tc);
            },
            onDone() {
              resolve({ text, toolCalls });
            },
            onError(err) {
              reject(err);
            },
          },
          { model },
        )
        .catch(reject);
    });
  }

  /** Run one tool call, emit step status + entity, and append the tool result to context. */
  private async executeAndRecord(tc: ToolCall, cb: AgentCallbacks): Promise<void> {
    const module = moduleForTool(tc.name);
    const base: RunStep = { id: tc.id, toolName: tc.name, module, status: "running" };
    cb.onStepStart?.(base);

    const pendingId = module ? useAIPendingStore.getState().begin(module, tc.name) : null;
    let result: ToolResult;
    try {
      result = await this.execTool(tc, cb);
    } catch (e) {
      result = { ok: false, text: e instanceof Error ? e.message : "Tool failed." };
    } finally {
      if (pendingId) useAIPendingStore.getState().end(pendingId);
    }

    const entity = result.ok
      ? (entityFromTool(tc.name, tc.arguments, result.data) ?? undefined)
      : undefined;
    if (entity) {
      this.context.registerEntity(entity);
      cb.onEntity?.(entity);
    }

    const status: RunStepStatus = result.ok
      ? "success"
      : result.errorCode === "DECLINED"
        ? "declined"
        : "error";
    cb.onStepUpdate?.({ ...base, status, resultText: result.text, entity });
    this.context.addMessage(msg("tool", result.text, tc.id));
  }

  /** Look up + invoke the registry handler, gating irreversible tools behind a confirm. */
  private async execTool(tc: ToolCall, cb: AgentCallbacks): Promise<ToolResult> {
    const entry = toolRegistry.find((t) => t.name === tc.name);
    if (!entry) return { ok: false, text: `Unknown tool: ${tc.name}` };

    if (!isGated(tc.name)) return entry.handler(tc.arguments, this.ctx);

    // Preview: requireConfirm short-circuits before any side effect and returns
    // the effect text. A non-confirm failure here is a real validation error.
    const preview = await entry.handler(tc.arguments, this.ctx);
    if (preview.ok || !preview.text.startsWith(CONFIRM_REQUIRED_PREFIX)) return preview;

    const approved = cb.onConfirmRequired
      ? await cb.onConfirmRequired({
          id: tc.id,
          toolName: tc.name,
          module: moduleForTool(tc.name),
          message: preview.text,
        })
      : false;

    if (!approved) return { ok: false, text: DECLINED_TEXT, errorCode: "DECLINED" };
    return entry.handler({ ...tc.arguments, confirm: true }, this.ctx);
  }
}
