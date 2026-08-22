import { describe, expect, it, vi } from "vitest";

const fetchMyForms = vi.fn(async () => {});
const fetchBoards = vi.fn(async () => {});
const fetchCalendars = vi.fn(async () => {});
const fetchFiles = vi.fn(async () => {});
const refreshProfile = vi.fn(async () => {});

vi.mock("../../stores/formsStore", () => ({
  useFormsStore: { getState: () => ({ fetchMyForms }) },
}));
vi.mock("../../stores/kanbanStore", () => ({
  useKanbanStore: { getState: () => ({ fetchBoards }) },
}));
vi.mock("../../stores/calendarStore", () => ({
  useCalendarStore: { getState: () => ({ fetchCalendars }) },
}));
vi.mock("../../stores/driveStore", () => ({
  useDriveStore: { getState: () => ({ fetchFiles }) },
}));
vi.mock("../../stores/authStore", () => ({
  useAuthStore: { getState: () => ({ refreshProfile }) },
}));
vi.mock("@formstr/core", () => ({
  relayManager: {
    getRelaysForModule: (m: string) => [`wss://${m}.test`],
    getAllRelays: () => ["wss://all.test"],
  },
}));

import { refetchFor } from "./bindings";
import { scopesFor } from "./scopes";

describe("refetchFor", () => {
  it("binds every watched scope to a store fetch", () => {
    // A watched scope with no binding would subscribe to a relay and then throw
    // away everything it heard.
    for (const scope of scopesFor("abc").filter((s) => s.watch)) {
      expect(refetchFor(scope.module), scope.module).toBeTypeOf("function");
    }
  });

  it("routes each module to its own store", async () => {
    await refetchFor("forms")!();
    expect(fetchMyForms).toHaveBeenCalledTimes(1);

    await refetchFor("kanban")!();
    expect(fetchBoards).toHaveBeenCalledTimes(1);

    await refetchFor("calendar")!();
    expect(fetchCalendars).toHaveBeenCalledTimes(1);

    await refetchFor("drive")!();
    expect(fetchFiles).toHaveBeenCalledTimes(1);

    await refetchFor("profile")!();
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  it("has no binding for a module that is not watched", () => {
    expect(refetchFor("invitations")).toBeUndefined();
  });

  it("resolves the store on call, not at import", async () => {
    // Bindings are built at module load, long before a store has any state.
    // Capturing getState() then would freeze the first snapshot forever.
    fetchBoards.mockClear();
    const refetch = refetchFor("kanban")!;
    await refetch();
    await refetch();
    expect(fetchBoards).toHaveBeenCalledTimes(2);
  });
});
