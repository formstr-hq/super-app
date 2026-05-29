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

/**
 * Map a tool name to the module it mutates, so `dispatchAction` can flip
 * the pending flag without a giant switch duplicated here.
 */
export function moduleForTool(toolName: string): AIModule | null {
  if (
    toolName === "create_form" ||
    toolName === "update_form" ||
    toolName === "delete_form" ||
    toolName === "share_form" ||
    toolName === "import_form_from_naddr" ||
    toolName === "submit_form_response" ||
    toolName === "list_forms" ||
    toolName === "fetch_form_responses"
  )
    return "forms";
  if (
    toolName === "create_calendar_event" ||
    toolName === "update_event" ||
    toolName === "delete_event" ||
    toolName === "delete_calendar_event" ||
    toolName === "rsvp_event" ||
    toolName === "attach_form_to_event"
  )
    return "calendar";
  if (toolName === "create_page" || toolName === "save_private_note" || toolName === "share_page")
    return "pages";
  if (toolName === "browse_files") return "drive";
  if (toolName === "create_poll" || toolName === "fetch_poll_results") return "polls";
  return null;
}
