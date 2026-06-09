import { afterEach, describe, expect, it, vi } from "vitest";

import type { Message, ToolDefinition } from "../types";

import { GeminiProvider } from "./gemini";

function sseRes(events: object[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
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
      name: "create_poll",
      description: "Make a poll",
      parameters: {
        type: "object",
        properties: { q: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
];

describe("GeminiProvider.generateStream", () => {
  it("streams text + functionCall and builds the right request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        sseRes([
          { candidates: [{ content: { parts: [{ text: "Sure " }] } }] },
          { candidates: [{ content: { parts: [{ text: "thing" }] } }] },
          {
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { name: "create_poll", args: { q: "lunch?" } } }],
                },
              },
            ],
          },
        ]),
      );

    const tokens: string[] = [];
    const calls: { name: string; args: unknown }[] = [];
    await new GeminiProvider("gkey").generateStream(
      [
        { id: "1", role: "system", content: "be brief", timestamp: 0 },
        { id: "2", role: "user", content: "poll", timestamp: 0 },
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
      { model: "gemini-2.0-flash" },
    );

    expect(tokens.join("")).toBe("Sure thing");
    expect(calls).toEqual([{ name: "create_poll", args: { q: "lunch?" } }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-2.0-flash:streamGenerateContent");
    expect(url).toContain("alt=sse");
    expect(url).toContain("key=gkey");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "poll" }] }]);
    expect(body.tools[0].functionDeclarations[0].name).toBe("create_poll");
    // unsupported JSON-schema keys stripped for Gemini
    expect(body.tools[0].functionDeclarations[0].parameters.additionalProperties).toBeUndefined();
  });

  it("maps assistant functionCall + tool result to model/functionResponse parts (name by id)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseRes([]));
    const messages: Message[] = [
      { id: "1", role: "user", content: "go", timestamp: 0 },
      {
        id: "2",
        role: "assistant",
        content: "",
        timestamp: 0,
        toolCalls: [{ id: "x1", name: "create_poll", arguments: { q: "a" } }],
      },
      { id: "3", role: "tool", content: "poll made", timestamp: 0, toolCallId: "x1" },
    ];
    await new GeminiProvider("k").generateStream(messages, tools, {
      onToken: () => {},
      onDone: () => {},
      onError: (e) => {
        throw e;
      },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[1]).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "create_poll", args: { q: "a" } } }],
    });
    expect(body.contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "create_poll", response: { result: "poll made" } } }],
    });
  });
});
