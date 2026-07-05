import { z } from "zod";

import { fail } from "../result";

import type { ToolEntry } from "./types";

/**
 * Wrap a tool so its handler strict-validates the arguments before running.
 *
 * Zod objects strip unknown keys by default, and the MCP SDK parses with the
 * same semantics — so a misspelled or invented parameter (e.g. passing
 * `registrationFormRef` to a tool that doesn't take it) used to be silently
 * dropped and the call "succeeded" without doing what the model asked.
 * Rejecting unknown keys with an error that names them (and the valid
 * parameters) lets an LLM caller self-correct instead of walking away
 * believing the write happened.
 */
export function withStrictArgs(entry: ToolEntry): ToolEntry {
  const schema = z.object(entry.inputSchema).strict();
  return {
    ...entry,
    handler: async (args, ctx) => {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) {
        const problems = parsed.error.issues
          .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
          .join("; ");
        const valid = Object.keys(entry.inputSchema);
        return fail(
          `Invalid arguments for ${entry.name}: ${problems}. ` +
            `Valid parameters: ${valid.length ? valid.join(", ") : "(none)"}.`,
          "BAD_INPUT",
        );
      }
      return entry.handler(parsed.data, ctx);
    },
  };
}
