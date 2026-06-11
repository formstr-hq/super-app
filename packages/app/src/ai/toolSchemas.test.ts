import { describe, it, expect } from "vitest";

import { buildToolDefinitions } from "./toolSchemas";

describe("buildToolDefinitions", () => {
  const defs = buildToolDefinitions();

  it("wraps every registry schema as an OpenAI-style function tool", () => {
    expect(defs.length).toBe(53);
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(d.function.name).toBeTruthy();
      expect(d.function.description).toBeTruthy();
      expect((d.function.parameters as { type?: string }).type).toBe("object");
    }
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
