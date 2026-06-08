import { toolRegistry, type ToolCtx, type ToolResult } from "@formstr/agent";

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

function msg(role: Message["role"], content: string, toolCallId?: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), toolCallId };
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

        if (toolCalls.length === 0) {
          if (text.trim()) this.context.addMessage(msg("assistant", text));
          cb.onDone();
          return;
        }

        // Record the assistant turn (with its tool_calls) so the model sees its
        // own prior calls, then clear the live buffer before executing.
        const assistant = msg("assistant", text || "");
        assistant.toolCalls = toolCalls;
        this.context.addMessage(assistant);
        cb.onContentReset?.();

        for (const tc of toolCalls) {
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

  /** Look up + invoke the registry handler. (Confirm gate added in Task 6.) */
  private async execTool(tc: ToolCall, _cb: AgentCallbacks): Promise<ToolResult> {
    const entry = toolRegistry.find((t) => t.name === tc.name);
    if (!entry) return { ok: false, text: `Unknown tool: ${tc.name}` };
    return entry.handler(tc.arguments, this.ctx);
  }
}
