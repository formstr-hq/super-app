import type { LLMProvider, ActionResult, Message, StreamCallbacks, ToolCall } from "./types";
import { toolDefinitions } from "./tools";
import { ConversationContext } from "./context";
import { dispatchAction } from "./actionDispatcher";

function msg(role: Message["role"], content: string, toolCallId?: string): Message {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now(), toolCallId };
}

// Valid tool names from our tool definitions
const VALID_TOOL_NAMES = new Set(toolDefinitions.map((t) => t.function.name));

/**
 * Detect tool calls embedded as plain-text JSON in model output.
 * Smaller Ollama models (e.g. llama3.2) often emit the function call as
 * content text instead of in the structured `tool_calls` field.
 *
 * Patterns matched:
 *  - {"name": "create_form", "parameters": {...}}
 *  - {"function": {"name": "create_form", "arguments": {...}}}
 *  - Markdown-wrapped variants (```json ... ```)
 */
function tryExtractToolCallsFromText(text: string): ToolCall[] {
  const results: ToolCall[] = [];

  // Strip markdown code fences if present
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  // Try to find JSON objects in the text
  const jsonCandidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        jsonCandidates.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }

  for (const candidate of jsonCandidates) {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;

      // Pattern 1: {"name": "...", "parameters": {...}}
      if (
        typeof obj.name === "string" &&
        typeof obj.parameters === "object" &&
        obj.parameters !== null
      ) {
        const name = (obj.name as string).toLowerCase();
        if (VALID_TOOL_NAMES.has(name)) {
          results.push({
            id: crypto.randomUUID(),
            name,
            arguments: obj.parameters as Record<string, unknown>,
          });
          continue;
        }
      }

      // Pattern 2: {"function": {"name": "...", "arguments": {...}}}
      if (typeof obj.function === "object" && obj.function !== null) {
        const fn = obj.function as Record<string, unknown>;
        if (
          typeof fn.name === "string" &&
          typeof fn.arguments === "object" &&
          fn.arguments !== null
        ) {
          const name = (fn.name as string).toLowerCase();
          if (VALID_TOOL_NAMES.has(name)) {
            results.push({
              id: crypto.randomUUID(),
              name,
              arguments: fn.arguments as Record<string, unknown>,
            });
            continue;
          }
        }
      }

      // Pattern 3: {"name": "...", "arguments": {...}} (variant)
      if (
        typeof obj.name === "string" &&
        typeof obj.arguments === "object" &&
        obj.arguments !== null
      ) {
        const name = (obj.name as string).toLowerCase();
        if (VALID_TOOL_NAMES.has(name)) {
          results.push({
            id: crypto.randomUUID(),
            name,
            arguments: obj.arguments as Record<string, unknown>,
          });
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return results;
}

export class IntentRouter {
  private provider: LLMProvider;
  private context: ConversationContext;

  constructor(provider: LLMProvider, context: ConversationContext) {
    this.provider = provider;
    this.context = context;
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  async routeStream(
    userMessage: string,
    pubkey: string | null,
    callbacks: StreamCallbacks & {
      onActionResult?: (result: ActionResult) => void;
      onContentReset?: () => void;
    },
    model?: string,
  ): Promise<void> {
    this.context.addMessage(msg("user", userMessage));

    const systemPrompt = this.context.buildSystemPrompt(pubkey);
    const messages: Message[] = [msg("system", systemPrompt), ...this.context.getMessages()];

    let fullContent = "";
    const toolCallsReceived: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }> = [];

    // Determine if the message likely needs tools (action-oriented keywords)
    const looksLikeAction =
      /\b(create|make|build|delete|remove|add|fetch|get|show|list|browse|share|save)\b/i.test(
        userMessage,
      );

    await this.provider.generateStream(
      messages,
      looksLikeAction ? toolDefinitions : [],
      {
        onToken(token: string) {
          fullContent += token;
          callbacks.onToken(token);
        },
        onToolCall(tc) {
          toolCallsReceived.push(tc);
          callbacks.onToolCall?.(tc);
        },
        onDone: async () => {
          // If no structured tool calls were received, check if the model
          // embedded a tool call as plain-text JSON (common with smaller Ollama models)
          if (toolCallsReceived.length === 0 && fullContent.includes("{")) {
            const extracted = tryExtractToolCallsFromText(fullContent);
            if (extracted.length > 0) {
              // Clear the raw JSON from display — it will be replaced by a
              // natural-language follow-up after the tool call executes
              fullContent = "";
              callbacks.onContentReset?.();
              toolCallsReceived.push(...extracted);
            }
          }

          // If the model returned absolutely nothing (common with small models
          // when tool definitions are included), retry without tools so it can
          // at least produce a conversational response.
          if (!fullContent.trim() && toolCallsReceived.length === 0) {
            await this.provider.generateStream(
              messages,
              [],
              {
                onToken(token: string) {
                  fullContent += token;
                  callbacks.onToken(token);
                },
                onToolCall() {},
                onDone: () => {},
                onError: callbacks.onError,
              },
              { model },
            );

            // The retry without tools may have produced text-based tool calls
            if (toolCallsReceived.length === 0 && fullContent.includes("{")) {
              const extracted = tryExtractToolCallsFromText(fullContent);
              if (extracted.length > 0) {
                fullContent = "";
                callbacks.onContentReset?.();
                toolCallsReceived.push(...extracted);
              }
            }
          }

          // Process any tool calls
          if (toolCallsReceived.length > 0) {
            // Add assistant message that triggered the tool calls to context
            // (the model needs to see its own tool_calls in the conversation)
            const assistantToolMsg = msg("assistant", fullContent || "");
            assistantToolMsg.toolCalls = toolCallsReceived.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            }));
            this.context.addMessage(assistantToolMsg);

            // Reset fullContent — follow-up will produce the actual response text
            fullContent = "";
            callbacks.onContentReset?.();

            for (const tc of toolCallsReceived) {
              try {
                const result = await dispatchAction(tc);
                if (result.entity) {
                  this.context.registerEntity(result.entity);
                }
                callbacks.onActionResult?.(result);

                // Add tool result to context
                this.context.addMessage(
                  msg(
                    "tool",
                    result.message ?? (result.success ? "Done" : (result.error ?? "Failed")),
                    tc.id,
                  ),
                );

                // If we had tool calls, do a follow-up generation for the final response
                if (result.success) {
                  const followUpMessages: Message[] = [
                    msg("system", systemPrompt),
                    ...this.context.getMessages(),
                  ];

                  await this.provider.generateStream(
                    followUpMessages,
                    [],
                    {
                      onToken(token: string) {
                        fullContent += token;
                        callbacks.onToken(token);
                      },
                      onToolCall() {},
                      onDone: () => {},
                      onError: callbacks.onError,
                    },
                    { model },
                  );
                }
              } catch (e) {
                const errorMsg = e instanceof Error ? e.message : "Action failed";
                callbacks.onActionResult?.({ success: false, message: errorMsg });
                this.context.addMessage(msg("tool", `Error: ${errorMsg}`, tc.id));
              }
            }
          }

          // Record assistant message
          if (fullContent) {
            this.context.addMessage(msg("assistant", fullContent));
          }

          callbacks.onDone();
        },
        onError: callbacks.onError,
      },
      { model },
    );
  }

  resetContext(): void {
    this.context.reset();
  }
}
