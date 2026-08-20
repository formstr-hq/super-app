import { describe, it, expect } from "vitest";

import { GATED_TOOLS } from "../src/safety";
import { toolRegistry } from "../src/tools";

describe("toolRegistry", () => {
  it("exposes all 53 tools with unique names", () => {
    expect(toolRegistry).toHaveLength(53);
    expect(new Set(toolRegistry.map((t) => t.name)).size).toBe(53);
  });

  it("every entry has a description and inputSchema", () => {
    for (const t of toolRegistry) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTypeOf("object");
    }
  });

  it("every entry is stamped with the module that owns it", () => {
    // Hosts expose a subset of the registry by module — the web app ships
    // Forms/Calendar/Drive while the MCP server ships everything. An untagged
    // tool would be filtered out of every host silently, so `module` is
    // required and stamped where the per-module arrays are combined.
    const modules = new Set(["forms", "calendar", "pages", "polls", "drive"]);
    for (const t of toolRegistry) {
      expect(modules, `${t.name} has an unknown module: ${t.module}`).toContain(t.module);
    }
  });

  it("gated tools and write tools are the same set", () => {
    // Every tool that enforces requireConfirm is marked `write`, so write ⟺ gated.
    // This is the drift catcher: a write tool missing from GATED_TOOLS bypasses the
    // in-app agent's human-confirmation UI (isGated decides whether to show it),
    // letting the model self-approve with confirm:true.
    const writeTools = toolRegistry
      .filter((t) => t.write)
      .map((t) => t.name)
      .sort();
    expect(writeTools).toEqual([...GATED_TOOLS].sort());
  });
});
