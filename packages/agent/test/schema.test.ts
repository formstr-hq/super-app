import { describe, it, expect } from "vitest";

import { getToolSchemas } from "../src/schema";

describe("getToolSchemas", () => {
  const schemas = getToolSchemas();

  it("derives one schema per registry tool (51)", () => {
    expect(schemas).toHaveLength(51);
    expect(new Set(schemas.map((s) => s.name)).size).toBe(51);
  });

  it("every schema has name, description and an object json-schema", () => {
    for (const s of schemas) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect((s.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("create_form exposes its zod fields as json-schema properties", () => {
    const cf = schemas.find((s) => s.name === "create_form")!;
    const params = cf.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(params.properties.name).toBeDefined();
    expect(params.properties.fields).toBeDefined();
    expect(params.required).toContain("name");
  });

  it("does not leak $schema or $ref into tool parameters", () => {
    const json = JSON.stringify(schemas);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$schema");
  });
});
