import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { fail } from "./result";

export const GATED_TOOLS = [
  "delete_form",
  "delete_calendar_event",
  "submit_form_response",
  "submit_poll_response",
  "rsvp_event",
] as const;

export type GatedTool = (typeof GATED_TOOLS)[number];

export function isGated(tool: string): tool is GatedTool {
  return (GATED_TOOLS as readonly string[]).includes(tool);
}

/**
 * Returns a blocking CallToolResult when a gated tool is invoked without
 * `confirm: true`, naming the irreversible effect. Returns null when allowed.
 */
export function requireConfirm(
  tool: string,
  args: { confirm?: boolean },
  effect: string,
): CallToolResult | null {
  if (args.confirm === true) return null;
  return fail(
    `Confirmation required for "${tool}". This action is irreversible and acts on your Nostr identity: ${effect}. Re-call with "confirm": true to proceed.`,
  );
}
