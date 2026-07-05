import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import { ok } from "../src/result";
import type { ToolEntry } from "../src/tools/types";
import { withStrictArgs } from "../src/tools/validate";

const ctx = { allowWrites: true };

function entry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    name: "demo_tool",
    description: "demo",
    inputSchema: { title: z.string(), count: z.number().optional() },
    handler: vi.fn(async () => ok("ran")),
    ...overrides,
  };
}

describe("withStrictArgs", () => {
  it("rejects unknown parameters, naming them and the valid ones", async () => {
    // The exact bug class from the field: update_calendar_event silently
    // accepted-and-ignored registrationFormRef, so the model believed the
    // write happened. Unknown keys must be a hard error.
    const t = entry();
    const strict = withStrictArgs(t);
    const res = await strict.handler({ title: "x", registrationFormRef: "naddr1" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("BAD_INPUT");
    expect(res.text).toContain("registrationFormRef");
    expect(res.text).toContain("title");
    expect(res.text).toContain("count");
    expect(t.handler).not.toHaveBeenCalled();
  });

  it("rejects wrong types with the offending path", async () => {
    const t = entry();
    const strict = withStrictArgs(t);
    const res = await strict.handler({ title: 42 }, ctx);
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe("BAD_INPUT");
    expect(res.text).toContain("title");
    expect(t.handler).not.toHaveBeenCalled();
  });

  it("passes valid args through to the handler", async () => {
    const t = entry();
    const strict = withStrictArgs(t);
    const res = await strict.handler({ title: "x", count: 2 }, ctx);
    expect(res.ok).toBe(true);
    expect(t.handler).toHaveBeenCalledWith({ title: "x", count: 2 }, ctx);
  });

  it("treats missing args as {} for parameterless tools", async () => {
    // MCP hosts may omit `arguments` entirely for a no-param tool.
    const t = entry({ inputSchema: {} });
    const strict = withStrictArgs(t);
    const res = await strict.handler(undefined, ctx);
    expect(res.ok).toBe(true);
  });

  it("preserves the write flag and metadata", () => {
    const t = entry({ write: true });
    const strict = withStrictArgs(t);
    expect(strict.write).toBe(true);
    expect(strict.name).toBe(t.name);
    expect(strict.inputSchema).toBe(t.inputSchema);
  });
});

describe("toolRegistry strict args", () => {
  it("every registered tool rejects an unknown parameter", async () => {
    // Import here (not top-level) so the services mock isn't needed: the
    // strict wrapper must fail BEFORE any handler/service code runs.
    const { toolRegistry } = await import("../src/tools");
    for (const t of toolRegistry) {
      const res = await t.handler({ definitely_not_a_real_param: 1 }, ctx);
      expect(res.ok, `${t.name} accepted an unknown parameter`).toBe(false);
      expect(res.errorCode, t.name).toBe("BAD_INPUT");
      expect(res.text, t.name).toContain("definitely_not_a_real_param");
    }
  });
});
