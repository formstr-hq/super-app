import { JsonRpcPeer, type RpcParams } from "./jsonrpc";

/** The ACP protocol version this client speaks. */
export const ACP_PROTOCOL_VERSION = 1;

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export interface ToolCallInfo {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequest {
  toolCallId?: string;
  options: PermissionOption[];
}

export interface AcpEvents {
  onMessageChunk?(text: string): void;
  onThoughtChunk?(text: string): void;
  onToolCall?(tc: ToolCallInfo): void;
  onToolCallUpdate?(tc: ToolCallInfo & { content?: unknown }): void;
  onPlan?(entries: Array<{ content: string; priority?: string; status?: string }>): void;
  /** Resolve with the chosen optionId, or null to cancel. */
  onPermissionRequest?(req: PermissionRequest): Promise<string | null>;
}

interface Duplexish {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close?(): Promise<void>;
}

function textOf(content: unknown): string {
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: unknown }).text ?? "");
  }
  return "";
}

/**
 * Drives an ACP agent (opencode) over the transport duplex. We declare NO
 * fs/terminal client capabilities, so the agent uses its own local tools on the
 * home node — exactly our topology. All the agent's progress arrives as
 * session/update notifications, surfaced here as typed callbacks for the UI.
 */
export class AcpClient {
  private readonly peer: JsonRpcPeer;
  private sessionId: string | null = null;

  constructor(
    private readonly duplex: Duplexish,
    private readonly events: AcpEvents = {},
  ) {
    this.peer = new JsonRpcPeer(duplex, {
      notifications: {
        "session/update": (params) => this.onSessionUpdate(params),
      },
      requests: {
        "session/request_permission": (params) => this.onRequestPermission(params),
      },
    });
  }

  /** initialize → session/new. Returns the new session id. */
  async connect(cwd = "."): Promise<string> {
    await this.peer.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      // No fs/terminal: the agent must use its own local tools (home node fs).
      clientCapabilities: {},
      clientInfo: { name: "formstr-super-app", version: "0.0.1" },
    });
    const res = await this.peer.request<{ sessionId: string }>("session/new", {
      cwd,
      mcpServers: [],
    });
    this.sessionId = res.sessionId;
    return res.sessionId;
  }

  /** Send a user turn; resolves with the stop reason when the turn ends. */
  async prompt(text: string): Promise<StopReason> {
    if (!this.sessionId) throw new Error("call connect() first");
    const res = await this.peer.request<{ stopReason: StopReason }>("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
    return res.stopReason;
  }

  /** Interrupt the current turn (notification, no response). */
  cancel(): void {
    if (this.sessionId) this.peer.notify("session/cancel", { sessionId: this.sessionId });
  }

  async close(): Promise<void> {
    await this.peer.close();
    await this.duplex.close?.();
  }

  private onSessionUpdate(params: RpcParams): void {
    const update = params.update as Record<string, unknown> | undefined;
    if (!update) return;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.events.onMessageChunk?.(textOf(update.content));
        break;
      case "agent_thought_chunk":
        this.events.onThoughtChunk?.(textOf(update.content));
        break;
      case "tool_call":
        this.events.onToolCall?.({
          toolCallId: String(update.toolCallId),
          title: update.title as string | undefined,
          kind: update.kind as string | undefined,
          status: update.status as ToolCallInfo["status"],
        });
        break;
      case "tool_call_update":
        this.events.onToolCallUpdate?.({
          toolCallId: String(update.toolCallId),
          status: update.status as ToolCallInfo["status"],
          content: update.content,
        });
        break;
      case "plan":
        this.events.onPlan?.(
          (update.entries as Array<{ content: string; priority?: string; status?: string }>) ?? [],
        );
        break;
      default:
        break; // usage_update, mode changes, etc. — ignored for now
    }
  }

  private async onRequestPermission(params: RpcParams): Promise<unknown> {
    const options = (params.options as PermissionOption[]) ?? [];
    const toolCall = params.toolCall as { toolCallId?: string } | undefined;
    const chosen = this.events.onPermissionRequest
      ? await this.events.onPermissionRequest({ toolCallId: toolCall?.toolCallId, options })
      : (options.find((o) => o.kind === "allow_once")?.optionId ?? null);

    return chosen
      ? { outcome: { outcome: "selected", optionId: chosen } }
      : { outcome: { outcome: "cancelled" } };
  }
}
