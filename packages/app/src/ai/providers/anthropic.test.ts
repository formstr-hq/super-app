import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, ToolDefinition } from "../types";

import { AnthropicProvider } from "./anthropic";

function sseRes(events: object[]): Response {
  const lines = events.map(
    (e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`,
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_form",
      description: "Make a form",
      parameters: { type: "object", properties: {} },
    },
  },
];

describe("AnthropicProvider.generateStream", () => {
  it("streams text + a tool_use block and sends the right headers/body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseRes([
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Working" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "create_form", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"title":' },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '"Hi"}' },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]),
    );

    const tokens: string[] = [];
    const calls: { name: string; args: unknown }[] = [];
    await new AnthropicProvider("sk-ant").generateStream(
      [
        { id: "1", role: "system", content: "be helpful", timestamp: 0 },
        { id: "2", role: "user", content: "make a form", timestamp: 0 },
      ],
      tools,
      {
        onToken: (t) => tokens.push(t),
        onToolCall: (c) => calls.push({ name: c.name, args: c.arguments }),
        onDone: () => {},
        onError: (e) => {
          throw e;
        },
      },
      { model: "claude-sonnet-4-6" },
    );

    expect(tokens.join("")).toBe("Working");
    expect(calls).toEqual([{ name: "create_form", args: { title: "Hi" } }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-ant");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.system).toBe("be helpful");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: "user", content: "make a form" }]);
    expect(body.tools[0]).toMatchObject({ name: "create_form", description: "Make a form" });
    expect(body.tools[0].input_schema).toMatchObject({ type: "object" });
  });

  it("maps assistant tool_calls and tool results to tool_use/tool_result blocks", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseRes([{ type: "message_stop" }]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "do it", timestamp: 0 },
      {
        id: "2",
        role: "assistant",
        content: "sure",
        timestamp: 0,
        toolCalls: [{ id: "toolu_1", name: "create_form", arguments: { title: "X" } }],
      },
      { id: "3", role: "tool", content: "made form abc", timestamp: 0, toolCallId: "toolu_1" },
    ];
    await new AnthropicProvider("k").generateStream(messages, tools, {
      onToken: () => {},
      onDone: () => {},
      onError: (e) => {
        throw e;
      },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "sure" },
        { type: "tool_use", id: "toolu_1", name: "create_form", input: { title: "X" } },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "made form abc" }],
    });
  });

  it("coalesces consecutive tool results into one user turn", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseRes([{ type: "message_stop" }]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "two things", timestamp: 0 },
      {
        id: "2",
        role: "assistant",
        content: "",
        timestamp: 0,
        toolCalls: [
          { id: "toolu_1", name: "create_form", arguments: {} },
          { id: "toolu_2", name: "create_form", arguments: {} },
        ],
      },
      { id: "3", role: "tool", content: "a", timestamp: 0, toolCallId: "toolu_1" },
      { id: "4", role: "tool", content: "b", timestamp: 0, toolCallId: "toolu_2" },
    ];
    await new AnthropicProvider("k").generateStream(messages, tools, {
      onToken: () => {},
      onDone: () => {},
      onError: (e) => {
        throw e;
      },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "a" },
      { type: "tool_result", tool_use_id: "toolu_2", content: "b" },
    ]);
  });

  it("isAvailable reflects key presence", async () => {
    expect(await new AnthropicProvider("k").isAvailable()).toBe(true);
    expect(await new AnthropicProvider("").isAvailable()).toBe(false);
  });
});
