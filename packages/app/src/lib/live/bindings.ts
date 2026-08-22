import { useAuthStore } from "../../stores/authStore";
import { useCalendarStore } from "../../stores/calendarStore";
import { useDriveStore } from "../../stores/driveStore";
import { useFormsStore } from "../../stores/formsStore";
import { useKanbanStore } from "../../stores/kanbanStore";

/**
 * Which store re-reads itself when a scope changes.
 *
 * The whole reactive design in one table: nothing here decodes an event, it just
 * re-runs the fetch the module already had. That read is covered by a standing
 * warm interest, so it settles on the short grace rather than waiting out the
 * network — which is what makes refetching cheap enough to do on every change.
 *
 * Each entry resolves its store on call. Bindings are built at module load, long
 * before a store holds anything, so capturing `getState()` here would freeze the
 * first snapshot forever.
 */
const BINDINGS: Record<string, () => Promise<void>> = {
  forms: () => useFormsStore.getState().fetchMyForms(),
  kanban: () => useKanbanStore.getState().fetchBoards(),
  calendar: () => useCalendarStore.getState().fetchCalendars(),
  drive: () => useDriveStore.getState().fetchFiles(),
  profile: () => useAuthStore.getState().refreshProfile(),
};

/** The refetch for a module, or undefined if the scope is warm-only. */
export function refetchFor(module: string): (() => Promise<void>) | undefined {
  return BINDINGS[module];
}
