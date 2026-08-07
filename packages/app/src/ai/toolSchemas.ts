import { getToolSchemas } from "@formstr/agent";

import { APP_TOOL_MODULES } from "./registry";
import type { ToolDefinition } from "./types";

let cached: ToolDefinition[] | null = null;

/** The registry tools as OpenAI-style function definitions for the LLM providers. */
export function buildToolDefinitions(): ToolDefinition[] {
  if (cached) return cached;
  cached = getToolSchemas({ modules: APP_TOOL_MODULES }).map((s) => ({
    type: "function" as const,
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
  return cached;
}
