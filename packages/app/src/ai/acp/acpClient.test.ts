import { describe, expect, it } from "vitest";

import { AcpClient } from "./acpClient";
import { JsonRpcPeer, type RpcParams } from "./jsonrpc";

/** Two linked in-memory duplexes (a.writable -> b.readable and vice versa). */
function duplexPair() {
  const a2b = new TransformStream<Uint8Array, Uint8Array>();
  const b2a = new TransformStream<Uint8Array, Uint8Array>();
  return {
    a: { readable: b2a.readable, writable: a2b.writable },
    b: { readable: a2b.readable, writable: b2a.writable },
  };
}

/** A scripted ACP agent good enough to exercise the client. */
function fakeAgent(duplex: {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}) {
  const peer: JsonRpcPeer = new JsonRpcPeer(duplex, {
    requests: {
      initialize: () => ({ protocolVersion: 1, agentCapabilities: {} }),
      "session/new": () => ({ sessionId: "sess_1" }),
      "session/prompt": async (params: RpcParams) => {
        const sessionId = params.sessionId as string;
        const u = (update: RpcParams) => peer.notify("session/update", { sessionId, update });
        u({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } });
        u({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } });
        u({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "read file",
          kind: "read",
          status: "pending",
        });
        // ask permission, then finish the tool
        const outcome = await peer.request<{ outcome: { outcome: string; optionId?: string } }>(
          "session/request_permission",
          {
            sessionId,
            toolCall: { toolCallId: "t1" },
            options: [
              { optionId: "allow-once", name: "Allow", kind: "allow_once" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          },
        );
        u({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: outcome.outcome.optionId === "allow-once" ? "completed" : "failed",
        });
        return { stopReason: "end_turn" };
      },
    },
  });
  return peer;
}

describe("AcpClient", () => {
  it("initializes, streams a turn, and handles a permission request", async () => {
    const { a, b } = duplexPair();
    fakeAgent(b);

    let message = "";
    const toolCalls: string[] = [];
    const toolUpdates: Array<{ id: string; status?: string }> = [];
    let permissionAsked = false;

    const client = new AcpClient(a, {
      onMessageChunk: (t) => {
        message += t;
      },
      onToolCall: (tc) => toolCalls.push(tc.toolCallId),
      onToolCallUpdate: (tc) => toolUpdates.push({ id: tc.toolCallId, status: tc.status }),
      onPermissionRequest: async (req) => {
        permissionAsked = true;
        expect(req.toolCallId).toBe("t1");
        return req.options.find((o) => o.kind === "allow_once")!.optionId;
      },
    });

    const sessionId = await client.connect("/home/me/project");
    expect(sessionId).toBe("sess_1");

    const stop = await client.prompt("hi");
    expect(stop).toBe("end_turn");
    expect(message).toBe("Hello world");
    expect(toolCalls).toEqual(["t1"]);
    expect(permissionAsked).toBe(true);
    expect(toolUpdates).toEqual([{ id: "t1", status: "completed" }]);

    await client.close();
  });

  it("cancels a permission request when the UI declines", async () => {
    const { a, b } = duplexPair();
    fakeAgent(b);
    const updates: Array<string | undefined> = [];
    const client = new AcpClient(a, {
      onToolCallUpdate: (tc) => updates.push(tc.status),
      onPermissionRequest: async () => null, // decline
    });
    await client.connect();
    await client.prompt("do it");
    expect(updates).toEqual(["failed"]);
    await client.close();
  });
});
