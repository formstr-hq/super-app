import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { toolRegistry } from "./tools";
import type { ToolEntry, ToolModule } from "./tools";

/** A tool's name + description + a JSON-schema object for its parameters. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolSchemaOptions {
  /** Restrict to these modules. Omitted means every module in the registry. */
  modules?: readonly ToolModule[];
}

let cached: ToolSchema[] | null = null;

function toSchema(t: ToolEntry): ToolSchema {
  // .strict() so the advertised schema (additionalProperties: false) matches
  // the runtime contract — handlers hard-reject unknown keys (see tools/validate.ts).
  const json = zodToJsonSchema(z.object(t.inputSchema).strict(), {
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete json.$schema;
  return { name: t.name, description: t.description, parameters: json };
}

/**
 * Derive provider-neutral JSON-schema tool definitions from the registry's
 * zod input shapes. `$refStrategy: "none"` inlines nested objects (LLM tool
 * APIs reject `$ref`); we also strip the `$schema` meta key.
 *
 * Pass `modules` to advertise only part of the registry — a host must not offer
 * a model tools whose results it has no surface to show. Only the unfiltered
 * result is cached; the registry is static for the process lifetime, but a
 * filtered list is cheap and callers hold their own.
 */
export function getToolSchemas(options?: ToolSchemaOptions): ToolSchema[] {
  if (options?.modules) {
    const allowed = new Set<ToolModule>(options.modules);
    return toolRegistry.filter((t) => allowed.has(t.module)).map(toSchema);
  }
  if (cached) return cached;
  cached = toolRegistry.map(toSchema);
  return cached;
}
