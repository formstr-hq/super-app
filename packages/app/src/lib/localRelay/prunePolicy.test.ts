import { CALENDAR_KINDS } from "@formstr/calendar-sdk";
import { KANBAN_KINDS } from "@formstr/kanban-sdk";
import { EventDB, defaultPrunePolicy } from "@formstr/local-relay";
import { makeEvent } from "@formstr/local-relay/testkit";
import { describe, it, expect } from "vitest";

import { appPrunePolicy } from "./prunePolicy";

const DAY = 24 * 60 * 60;
const NOW_SECONDS = 1_800_000_000;
const daysAgo = (days: number) => NOW_SECONDS - days * DAY;

/**
 * Registry entries that are not storable event kinds, so the policy owes them
 * nothing. Everything else an SDK names must be covered — a new kind added
 * upstream should fail this suite rather than quietly inherit the 7-day default.
 */
const NOT_STORED = new Set<number>([
  13, // NIP-59 seal — only ever exists inside a gift wrap
  14, // NIP-17 rumor — unsigned, never on the wire
  53, // kanban invite rumor — likewise
  1052, // calendar invitation `k`-tag discriminator, not a kind
  1053, // kanban invitation `k`-tag discriminator, not a kind
  // Tracker interop kinds kanban-sdk can parse but this app has no UI for, so
  // it never subscribes to them and never caches one.
  1111,
  1617,
  1621,
  1630,
  1631,
  1632,
  1633,
]);

/** Is this kind spared the 7-day default — either protected, or given its own TTL? */
function isCovered(kind: number): boolean {
  const policy = appPrunePolicy();
  return policy.protectedKinds.has(kind) || policy.ttlByKind.has(kind);
}

describe("appPrunePolicy", () => {
  it("covers every storable kind the SDKs name", () => {
    const registryKinds = [...Object.values(KANBAN_KINDS), ...Object.values(CALENDAR_KINDS)].filter(
      (kind) => !NOT_STORED.has(kind),
    );

    const uncovered = [...new Set(registryKinds)].filter((kind) => !isCovered(kind));
    expect(uncovered).toEqual([]);
  });

  it("covers the app's own kinds, which no SDK registry names", () => {
    // The my-forms list, the drive index, and the legacy recurring calendar
    // variant are written by this repo, not by a published SDK.
    for (const kind of [14083, 34578, 32679]) {
      expect(isCovered(kind)).toBe(true);
    }
  });

  it("keeps a long-untouched calendar list that the default policy would delete", () => {
    // The bug this policy exists for, as observed against real relays: a kind-32123
    // calendar list 46 days old — still the current version of an addressable
    // event — swept on the next five-minute prune, leaving the module empty
    // offline and re-fetching it forever.
    const list = makeEvent({ kind: 32123, created_at: daysAgo(46) });

    const withDefaults = new EventDB(() => NOW_SECONDS);
    withDefaults.add(list);
    withDefaults.prune(defaultPrunePolicy());
    expect(withDefaults.allEvents()).toHaveLength(0);

    const withAppPolicy = new EventDB(() => NOW_SECONDS);
    withAppPolicy.add(list);
    withAppPolicy.prune(appPrunePolicy());
    expect(withAppPolicy.allEvents().map((e) => e.kind)).toEqual([32123]);
  });

  it("still ages out bulk kinds, so protection cannot run the store away", () => {
    const db = new EventDB(() => NOW_SECONDS);
    db.add(makeEvent({ id: "a".repeat(64), kind: 1069, created_at: daysAgo(200) }));
    db.add(makeEvent({ id: "b".repeat(64), kind: 1069, created_at: daysAgo(10) }));

    db.prune(appPrunePolicy());

    // Form responses have no natural ceiling, so they expire rather than being
    // protected — protection would also exempt them from the maxEvents cap.
    expect(db.allEvents().map((e) => e.created_at)).toEqual([daysAgo(10)]);
  });

  it("returns an independent policy per call", () => {
    // PrunePolicy holds a mutable Set and Map; a shared instance would leak
    // edits from one caller into the next.
    const first = appPrunePolicy();
    first.protectedKinds.add(99999);
    expect(appPrunePolicy().protectedKinds.has(99999)).toBe(false);
  });
});
