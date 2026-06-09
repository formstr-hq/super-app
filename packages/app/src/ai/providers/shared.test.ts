import { describe, expect, it } from "vitest";

import { readLines, sseData } from "./shared";

function fakeRes(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("readLines", () => {
  it("splits on newlines across chunk boundaries and flushes the tail", async () => {
    const lines: string[] = [];
    await readLines(fakeRes(["he", "llo\nwor", "ld\n", "tail"]), (l) => lines.push(l));
    expect(lines).toEqual(["hello", "world", "tail"]);
  });

  it("throws when there is no body", async () => {
    const res = new Response(null, { status: 200 });
    await expect(readLines(res, () => {})).rejects.toThrow("No response body");
  });
});

describe("sseData", () => {
  it("extracts the payload after data:", () => {
    expect(sseData('data: {"a":1}')).toBe('{"a":1}');
    expect(sseData("data:[DONE]")).toBe("[DONE]");
  });
  it("returns null for non-data lines", () => {
    expect(sseData("event: message_start")).toBeNull();
    expect(sseData("")).toBeNull();
  });
});
