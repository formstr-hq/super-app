import { describe, it, expect } from "vitest";

import { GATED_TOOLS } from "../src/safety";
import { toolRegistry } from "../src/tools";

describe("toolRegistry", () => {
  it("exposes all 51 tools with unique names", () => {
    expect(toolRegistry).toHaveLength(51);
    expect(new Set(toolRegistry.map((t) => t.name)).size).toBe(51);
  });

  it("every entry has a description and inputSchema", () => {
    for (const t of toolRegistry) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTypeOf("object");
    }
  });

  it("every gated tool is also marked write", () => {
    const byName = new Map(toolRegistry.map((t) => [t.name, t]));
    for (const name of GATED_TOOLS) {
      expect(byName.get(name)?.write, `${name} should be a write tool`).toBe(true);
    }
  });
});
