import { describe, expect, it, vi } from "vitest";

vi.mock("@formstr/core", () => ({
  relayManager: {
    getRelaysForModule: (m: string) => [`wss://${m}.test`],
    getAllRelays: () => ["wss://all.test"],
  },
}));

import { isCoveredBy } from "../localRelay/coverage";

import { scopesFor } from "./scopes";

const PUBKEY = "abc123";
const scopes = () => scopesFor(PUBKEY);
const byModule = (m: string) => scopes().find((s) => s.module === m);

describe("scopesFor", () => {
  it("covers each module's own-scope reads", () => {
    const kinds = scopes().flatMap((s) => s.filters.flatMap((f) => f.kinds ?? []));

    expect(kinds).toContain(14083); // forms list
    expect(kinds).toContain(30301); // public boards
    expect(kinds).toContain(32303); // private board list
    expect(kinds).toContain(32123); // calendar lists
    expect(kinds).toContain(34578); // drive file metadata
    expect(kinds).toContain(0); // own profile
  });

  it("gives every scope somewhere to read from", () => {
    // A warm interest pointed at the wrong relays would keep a cache warm with
    // events the module never publishes there.
    for (const scope of scopes()) {
      expect(scope.relays.length, scope.module).toBeGreaterThan(0);
    }
  });

  it("pins every filter to the user", () => {
    // A standing interest on a bare kind would have the worker sync the relay's
    // entire history of it.
    for (const scope of scopes()) {
      for (const filter of scope.filters) {
        const pinned =
          filter.authors?.includes(PUBKEY) ||
          (filter as Record<string, string[] | undefined>)["#p"]?.includes(PUBKEY);
        expect(pinned, `${scope.module}: ${JSON.stringify(filter)}`).toBe(true);
      }
    }
  });

  it("covers the deletion query every SDK read pairs itself with", () => {
    // kanban-sdk issues one of these alongside fetchBoards, fetchPrivateBoards
    // and fetchCards. Uncovered, it pays the full cold quiet window and sets the
    // floor for every refetch — defeating the warm path with its own companion.
    const declared = scopes().flatMap((s) => s.filters);
    const deletions = { kinds: [5], authors: [PUBKEY] };
    expect(declared.some((d) => isCoveredBy(deletions, d))).toBe(true);
  });

  it("covers the reads the kanban board list actually issues", () => {
    const declared = byModule("kanban")!.filters;
    for (const read of [
      { kinds: [30301], authors: [PUBKEY] },
      { kinds: [32301], authors: [PUBKEY] },
      { kinds: [30301], "#p": [PUBKEY] },
      { kinds: [32303], authors: [PUBKEY] },
    ]) {
      expect(
        declared.some((d) => isCoveredBy(read, d)),
        JSON.stringify(read),
      ).toBe(true);
    }
  });

  it("routes each module to its own relays, and profile to all of them", () => {
    expect(byModule("kanban")!.relays).toEqual(["wss://kanban.test"]);
    // The agent's profile service reads the user's whole relay set, so the
    // standing interest has to as well.
    expect(byModule("profile")!.relays).toEqual(["wss://all.test"]);
  });

  it("does not watch the invitation stream", () => {
    // invitationsStore runs its own live subscription; watching 1059 here would
    // decode every wrap twice.
    const invitations = scopes().find((s) => s.module === "invitations");
    expect(invitations?.watch).toBe(false);
  });
});
