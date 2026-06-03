import { describe, it, expect } from "vitest";

import { ok, fail, table } from "../src/result";

describe("result", () => {
  it("ok carries the text body and structuredContent", () => {
    const r = ok("hi", { a: 1 });
    expect(r.content[0]).toEqual({ type: "text", text: "hi" });
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.isError).toBeFalsy();
  });

  it("fail sets isError and appends a code when given", () => {
    expect(fail("bad", "E1").isError).toBe(true);
    expect((fail("bad", "E1").content[0] as { text: string }).text).toBe("bad (E1)");
    expect((fail("bad").content[0] as { text: string }).text).toBe("bad");
  });

  it("table renders rows and an empty marker", () => {
    expect(table([{ id: "a", name: "x" }], ["id", "name"])).toContain("| a | x |");
    expect(table([], ["id"])).toBe("_(none)_");
  });
});
