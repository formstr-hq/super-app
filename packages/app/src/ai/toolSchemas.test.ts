import { toolRegistry } from "@formstr/agent";
import { describe, it, expect } from "vitest";

import { APP_TOOL_MODULES } from "./registry";
import { buildToolDefinitions } from "./toolSchemas";

describe("buildToolDefinitions", () => {
  const defs = buildToolDefinitions();
  const expected = toolRegistry.filter((t) =>
    (APP_TOOL_MODULES as readonly string[]).includes(t.module),
  );

  it("wraps every app-surfaced registry schema as an OpenAI-style function tool", () => {
    expect(defs.length).toBe(expected.length);
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(d.function.name).toBeTruthy();
      expect(d.function.description).toBeTruthy();
      expect((d.function.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("omits tools from modules this app has no UI for", () => {
    // The shared registry keeps Pages and Polls for the MCP server. Advertising
    // them here would let the model write to relays with nothing to show for it.
    const names = defs.map((d) => d.function.name);
    expect(names).not.toContain("create_poll");
    expect(names).not.toContain("update_page");
    expect(defs.length).toBeLessThan(toolRegistry.length);
  });

  it("includes create_form with its parameters", () => {
    const cf = defs.find((d) => d.function.name === "create_form")!;
    expect(
      (cf.function.parameters as { properties: Record<string, unknown> }).properties.name,
    ).toBeDefined();
  });

  it("returns a stable cached array", () => {
    expect(buildToolDefinitions()).toBe(defs);
  });
});
