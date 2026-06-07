import { describe, it, expect } from "vitest";

import { ok, fail, table } from "../src/result";

describe("ToolResult helpers", () => {
  it("ok carries text + data and ok:true", () => {
    expect(ok("done", { id: "x" })).toEqual({ ok: true, text: "done", data: { id: "x" } });
  });

  it("ok omits data when not provided", () => {
    expect(ok("done")).toEqual({ ok: true, text: "done" });
  });

  it("fail carries text + errorCode and ok:false (code kept separate, not in text)", () => {
    expect(fail("nope", "NOT_FOUND")).toEqual({
      ok: false,
      text: "nope",
      errorCode: "NOT_FOUND",
    });
    expect(fail("nope")).toEqual({ ok: false, text: "nope" });
  });

  it("table renders a markdown table, _(none)_ when empty", () => {
    expect(table([], ["a"])).toBe("_(none)_");
    expect(table([{ id: "a", name: "x" }], ["id", "name"])).toContain("| a | x |");
  });
});
