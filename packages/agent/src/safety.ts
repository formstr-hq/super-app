import { fail, type ToolResult } from "./result";

export const GATED_TOOLS = [
  "delete_form",
  "delete_calendar_event",
  "update_calendar_event",
  "attach_form_to_event",
  "submit_form_response",
  "submit_poll_response",
  "rsvp_event",
  "delete_page",
  "share_page",
  "add_page_comment",
  "delete_poll",
  "clear_my_vote",
  "delete_file",
  "rename_file",
  "move_file",
] as const;

export type GatedTool = (typeof GATED_TOOLS)[number];

export function isGated(tool: string): tool is GatedTool {
  return (GATED_TOOLS as readonly string[]).includes(tool);
}

/** Every `requireConfirm` rejection message starts with this — lets callers
 *  (the in-app agent) distinguish a "needs confirmation" preview from a real
 *  validation error without parsing the whole string. */
export const CONFIRM_REQUIRED_PREFIX = "Confirmation required";

/**
 * Returns a blocking `ToolResult` when a gated tool is invoked without `confirm: true`,
 * naming the irreversible effect. Returns null when allowed. The MCP adapter maps the
 * blocking result to an `isError` CallToolResult; the in-browser agent surfaces it as a
 * confirmation prompt.
 */
export function requireConfirm(
  tool: string,
  args: { confirm?: boolean },
  effect: string,
): ToolResult | null {
  if (args.confirm === true) return null;
  return fail(
    `${CONFIRM_REQUIRED_PREFIX} for "${tool}". This action is irreversible and acts on your Nostr identity: ${effect}. Re-call with "confirm": true to proceed.`,
  );
}
