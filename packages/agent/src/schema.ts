import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { toolRegistry } from "./tools";

/** A tool's name + description + a JSON-schema object for its parameters. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

let cached: ToolSchema[] | null = null;

/**
 * Derive provider-neutral JSON-schema tool definitions from the registry's
 * zod input shapes. `$refStrategy: "none"` inlines nested objects (LLM tool
 * APIs reject `$ref`); we also strip the `$schema` meta key. Cached — the
 * registry is static for the process lifetime.
 */
export function getToolSchemas(): ToolSchema[] {
  if (cached) return cached;
  cached = toolRegistry.map((t) => {
    const json = zodToJsonSchema(z.object(t.inputSchema), {
      $refStrategy: "none",
    }) as Record<string, unknown>;
    delete json.$schema;
    return { name: t.name, description: t.description, parameters: json };
  });
  return cached;
}
