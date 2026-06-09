import { create } from "zustand";

import type { EntityRef } from "../ai/types";

export type AIModule = EntityRef["module"];

export interface PendingAIAction {
  id: string;
  module: AIModule;
  toolName: string;
  startedAt: number;
}

interface AIPendingStore {
  pending: PendingAIAction[];
  begin(module: AIModule, toolName: string): string;
  end(id: string): void;
  hasPendingFor(module: AIModule): boolean;
  clear(): void;
}

/**
 * Tracks AI-dispatched actions currently writing to each module, so module
 * pages can render a skeleton row while the tool call is in flight. Keeps
 * the liveness wiring out of individual module stores.
 */
export const useAIPendingStore = create<AIPendingStore>((set, get) => ({
  pending: [],
  begin(module, toolName) {
    const entry: PendingAIAction = {
      id: crypto.randomUUID(),
      module,
      toolName,
      startedAt: Date.now(),
    };
    set((s) => ({ pending: [...s.pending, entry] }));
    return entry.id;
  },
  end(id) {
    set((s) => ({ pending: s.pending.filter((e) => e.id !== id) }));
  },
  hasPendingFor(module) {
    return get().pending.some((e) => e.module === module);
  },
  clear() {
    set({ pending: [] });
  },
}));

const FORMS_TOOLS = new Set([
  "list_forms",
  "get_form",
  "fetch_form_responses",
  "create_form",
  "import_form_from_naddr",
  "update_form",
  "share_form",
  "delete_form",
  "submit_form_response",
]);

const CALENDAR_TOOLS = new Set([
  "list_calendar_events",
  "get_calendar_event",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "delete_event",
  "update_event",
  "attach_form_to_event",
  "rsvp_event",
  "fetch_event_rsvps",
  "list_invitations",
  "list_scheduling_pages",
  "list_booking_requests",
  "approve_booking",
  "decline_booking",
  "list_calendars",
  "create_calendar",
  "update_calendar",
  "delete_calendar",
  "add_event_to_calendar",
  "remove_event_from_calendar",
]);

const PAGES_TOOLS = new Set([
  "list_pages",
  "get_page",
  "create_page",
  "update_page",
  "delete_page",
  "save_private_note",
  "share_page",
  "list_shared_pages",
  "get_page_tags",
  "set_page_tags",
]);

const POLLS_TOOLS = new Set([
  "list_polls",
  "list_recent_polls",
  "get_poll",
  "create_poll",
  "delete_poll",
  "submit_poll_response",
  "clear_my_vote",
  "fetch_poll_results",
]);

const DRIVE_TOOLS = new Set([
  "browse_files",
  "get_file_info",
  "delete_file",
  "rename_file",
  "move_file",
]);

/**
 * Map a tool name to the module it belongs to, so the AI panel can color/group
 * steps and flip per-module pending flags without a giant switch.
 */
export function moduleForTool(toolName: string): AIModule | null {
  if (FORMS_TOOLS.has(toolName)) return "forms";
  if (CALENDAR_TOOLS.has(toolName)) return "calendar";
  if (PAGES_TOOLS.has(toolName)) return "pages";
  if (POLLS_TOOLS.has(toolName)) return "polls";
  if (DRIVE_TOOLS.has(toolName)) return "drive";
  return null;
}
