import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, ToolDefinition } from "../types";

import { OpenAICompatibleProvider } from "./openaiCompatible";

function sseRes(events: object[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).concat("data: [DONE]\n\n");
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
      name: "list_forms",
      description: "",
      parameters: { type: "object", properties: {} },
    },
  },
];

describe("OpenAICompatibleProvider.generateStream", () => {
  it("streams text deltas and accumulates tool calls by index", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseRes([
        { choices: [{ delta: { content: "Hi " } }] },
        { choices: [{ delta: { content: "there" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "list_forms", arguments: "" } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: '{"limit":5}' } }] } },
          ],
        },
      ]),
    );

    const tokens: string[] = [];
    const calls: { name: string; args: unknown }[] = [];
    let done = false;
    await new OpenAICompatibleProvider({ baseUrl: "http://x/v1", apiKey: "k" }).generateStream(
      [{ id: "1", role: "user", content: "hi", timestamp: 0 }],
      tools,
      {
        onToken: (t) => tokens.push(t),
        onToolCall: (c) => calls.push({ name: c.name, args: c.arguments }),
        onDone: () => (done = true),
        onError: (e) => {
          throw e;
        },
      },
      { model: "gpt-4o-mini" },
    );

    expect(tokens.join("")).toBe("Hi there");
    expect(calls).toEqual([{ name: "list_forms", args: { limit: 5 } }]);
    expect(done).toBe(true);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.tools[0].function.name).toBe("list_forms");
  });

  it("serializes assistant tool_calls and tool results back to the wire", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseRes([{ choices: [{ delta: { content: "ok" } }] }]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "do it", timestamp: 0 },
      {
        id: "2",
        role: "assistant",
        content: "",
        timestamp: 0,
        toolCalls: [{ id: "call_1", name: "list_forms", arguments: { limit: 5 } }],
      },
      { id: "3", role: "tool", content: "3 forms", timestamp: 0, toolCallId: "call_1" },
    ];
    await new OpenAICompatibleProvider({ baseUrl: "http://x/v1" }).generateStream(messages, tools, {
      onToken: () => {},
      onDone: () => {},
      onError: (e) => {
        throw e;
      },
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const assistant = body.messages[1];
    expect(assistant.tool_calls[0]).toMatchObject({
      id: "call_1",
      type: "function",
      function: { name: "list_forms" },
    });
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ limit: 5 });
    const toolMsg = body.messages[2];
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "3 forms" });
  });

  it("surfaces non-ok responses via onError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));
    let err: Error | null = null;
    await new OpenAICompatibleProvider({ baseUrl: "http://x/v1", apiKey: "bad" }).generateStream(
      [{ id: "1", role: "user", content: "hi", timestamp: 0 }],
      [],
      {
        onToken: () => {},
        onDone: () => {
          throw new Error("should not finish");
        },
        onError: (e) => (err = e),
      },
    );
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain("401");
  });
});
