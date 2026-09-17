import type {
  GenerateOptions,
  LLMProvider,
  Message,
  StreamCallbacks,
  ToolDefinition,
} from "../types";

import { AcpClient } from "./acpClient";
import { connectHomeNode, type HomeNodeConfig } from "./homeNode";

/**
 * An LLMProvider backed by a home-node ACP harness (opencode), used as a *model*:
 * the browser's Agent owns the tool loop, so tools run here (under the UI signer)
 * and opencode just generates text — including JSON tool calls the Agent parses.
 *
 * This keeps identity in the browser (no second login, no npub mismatch) and
 * reuses the entire existing agent/tool/UI machinery.
 */
function toolPreamble(tools: ToolDefinition[]): string {
  const list = tools.map((t) => `- ${t.function.name}: ${t.function.description}`).join("\n");
  return [
    "You are the Formstr assistant. You can read and act on the user's own Nostr data",
    "(forms, calendar, drive) by calling tools.",
    "",
    "To call a tool, reply with ONLY a single JSON object and no other text:",
    '{"name": "<tool_name>", "arguments": { ... }}',
    "You will then be given the tool result and can call more tools or answer.",
    "When you have the final answer, reply in plain prose (no JSON).",
    "Do NOT use file, shell, or code-editing tools — only the tools below.",
    "",
    "Available tools:",
    list,
  ].join("\n");
}

function formatForPrompt(m: Message): string {
  if (m.role === "system") return m.content;
  if (m.role === "tool") return `TOOL RESULT: ${m.content}`;
  if (m.role === "user") return m.content;
  return ""; // assistant turns are opencode's own output; it already has them
}

export class AcpProvider implements LLMProvider {
  private acp: AcpClient | null = null;
  private onToken: ((t: string) => void) | null = null;
  // opencode keeps session state, so we send only what's NEW each round.
  private sentCount = 0;
  private preambleSent = false;

  constructor(
    private readonly config: HomeNodeConfig,
    private readonly cwd: string,
  ) {}

  /** Establish the tunnel + ACP session (initialize + session/new). */
  async connect(): Promise<void> {
    await this.ensure();
  }

  private async ensure(): Promise<AcpClient> {
    if (this.acp) return this.acp;
    const duplex = await connectHomeNode(this.config);
    this.acp = new AcpClient(duplex, {
      onMessageChunk: (t) => this.onToken?.(t),
    });
    await this.acp.connect(this.cwd || ".");
    return this.acp;
  }

  async generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    cb: StreamCallbacks,
    _options?: GenerateOptions,
  ): Promise<void> {
    try {
      const acp = await this.ensure();
      const delta = messages.slice(this.sentCount);
      this.sentCount = messages.length;

      const parts: string[] = [];
      if (!this.preambleSent) {
        parts.push(toolPreamble(tools));
        this.preambleSent = true;
      }
      for (const m of delta) {
        if (m.role === "assistant") continue; // opencode produced these
        const text = formatForPrompt(m);
        if (text) parts.push(text);
      }
      const prompt = parts.join("\n\n").trim();

      this.onToken = cb.onToken;
      if (prompt) await acp.prompt(prompt);
      this.onToken = null;
      cb.onDone();
    } catch (e) {
      this.onToken = null;
      cb.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return ["home-node"];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    await this.acp?.close();
    this.acp = null;
  }
}
