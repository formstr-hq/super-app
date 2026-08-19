# Calendar SDK Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@formstr/calendar-sdk` the only calendar protocol implementation in this repo, deleting the ~4,500-line duplicate in `packages/agent/src/services/calendar/`.

**Architecture:** Both consumers build a `CalendarSDK` from the singletons they already have — `signerManager` for the signer, `nostrRuntime` as the injected `NostrRuntime`, `relayManager` for the calendar relay set. One shared discovery composer lives in the agent (app and MCP tools both need it). The agent keeps only booking, which the SDK does not implement.

**Tech Stack:** TypeScript, pnpm workspace, vitest, zustand, React 19, `@formstr/calendar-sdk` 0.1.0, `@formstr/core` (workspace).

**Spec:** [2026-08-18-calendar-sdk-integration.md](2026-08-18-calendar-sdk-integration.md)

## Global Constraints

- Branch: `calendar-sdk-integration`, based on `dev`. PR targets `dev`.
- `@formstr/calendar-sdk` version: `^0.1.0` — resolved from npm, never a workspace link.
- Commits: GPG-signed, conventional prefixes, **no AI attribution anywhere** (message, body, trailers).
- `pnpm` is not global. Use `corepack pnpm …`. The husky pre-commit hook shells out to bare `pnpm`, so commits need a shim on PATH:
  ```bash
  SCRATCH=<your scratch dir>; mkdir -p $SCRATCH/bin
  printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > $SCRATCH/bin/pnpm && chmod +x $SCRATCH/bin/pnpm
  PATH="$SCRATCH/bin:$PATH" git commit -m "…"
  ```
- Baselines recorded on `dev` at plan time: **app 381 tests / 66 files**, **agent 357 tests / 25 files**. Test counts only go up.
- Package layering is `mcp → agent → core`. The agent must never import from `packages/app`.
- `packages/mcp` needs **no changes**: it consumes tools through the registry and references no calendar type directly (verified by grep at plan time). Tool names and input schemas must therefore stay identical.
- Every SDK type comes from `@formstr/calendar-sdk`. No re-declaring protocol types anywhere in this repo.

## Deviation from the spec

The spec put the discovery composer at `packages/app/src/lib/calendar/discovery.ts`. Planning found that the agent's MCP tool `list_calendar_events` needs the identical composition (direct-by-author query + deletion sweep), so an app-side copy would immediately be duplicated in the agent. **The composer therefore lives at `packages/agent/src/services/calendar/discovery.ts`** and the app imports it. One copy, one deletion when SDK follow-up 1 lands.

---

### Task 1: Depend on the published SDK

**Files:**

- Modify: `packages/app/package.json:15-35` (dependencies)
- Modify: `packages/agent/package.json` (dependencies)
- Modify: `pnpm-workspace.yaml`

**Interfaces:**

- Produces: `@formstr/calendar-sdk@^0.1.0` resolvable from both packages.

- [ ] **Step 1: Add the dependency to both packages**

In `packages/app/package.json`, inside `dependencies`, after the `@formstr/agent` line:

```json
    "@formstr/calendar-sdk": "^0.1.0",
```

In `packages/agent/package.json`, inside `dependencies`, before `@formstr/core`:

```json
    "@formstr/calendar-sdk": "^0.1.0",
```

- [ ] **Step 2: Allow the young release**

`@formstr/calendar-sdk` 0.1.0 was published 2026-08-17. pnpm's release-age gate rejects packages younger than the configured floor, so add it to `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - "@formstr/kanban-sdk@0.1.0"
  - "@formstr/calendar-sdk@0.1.0"
```

- [ ] **Step 3: Install**

Run: `corepack pnpm install`
Expected: lockfile updated, `@formstr/calendar-sdk` present under both packages, exit 0. If install fails with a release-age error, Step 2 was skipped or the version string does not match exactly.

- [ ] **Step 4: Verify the package resolves and exports what this plan assumes**

Run:

```bash
corepack pnpm --filter @formstr/app exec node -e "import('@formstr/calendar-sdk').then(m => console.log(['CalendarSDK','toCalendarSigner','parseCalendarEvent','fetchDeletions','isDeleted','newestByCoordinate','lookupViewKey','coordinate','CALENDAR_KINDS','unwrapEvent','parseInvitationRumor','collectBusyRanges','busyListMonthKeysForRange'].filter(k => !(k in m))))"
```

Expected: `[]` — every symbol present.

- [ ] **Step 5: Commit**

```bash
git add packages/app/package.json packages/agent/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: depend on @formstr/calendar-sdk"
```

---

### Task 2: SDK factories

**Files:**

- Create: `packages/agent/src/services/calendar/sdk.ts`
- Create: `packages/agent/src/services/calendar/sdk.test.ts`
- Create: `packages/app/src/lib/calendar/sdk.ts`
- Create: `packages/app/src/lib/calendar/sdk.test.ts`

**Interfaces:**

- Consumes: `@formstr/calendar-sdk` from Task 1; `signerManager`, `nostrRuntime`, `relayManager` from `@formstr/core`.
- Produces:
  - agent: `getCalendarSdk(): Promise<CalendarSDK>`, `calendarRelays(): string[]`, `resetCalendarSdk(): void`
  - app: `getCalendarSdk(): Promise<CalendarSDK>`, `resetCalendarSdk(): void`

Core's `NostrRuntime` (`packages/core/src/runtime/NostrRuntime.ts:12`) already matches the SDK's `NostrRuntime` interface structurally — `querySync(relays, filter, timeoutMs)`, `subscribe(relays, filters, {onEvent, onEose})` returning `{unsub()}`, `publish(relays, event, timeoutMs)`. Pass it directly; do not write an adapter.

- [ ] **Step 1: Write the failing test for the agent factory**

Create `packages/agent/src/services/calendar/sdk.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { querySync: vi.fn(), subscribe: vi.fn(), publish: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

import { signerManager, relayManager } from "@formstr/core";

import { getCalendarSdk, resetCalendarSdk } from "./sdk";

function signer(pubkey: string) {
  return {
    getPublicKey: vi.fn().mockResolvedValue(pubkey),
    signEvent: vi.fn(),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCalendarSdk();
  (relayManager.getRelaysForModule as any).mockReturnValue(["wss://a.test"]);
});

describe("getCalendarSdk", () => {
  it("reuses one instance for the same pubkey and relay set", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    expect(await getCalendarSdk()).toBe(await getCalendarSdk());
  });

  it("rebuilds when the signed-in pubkey changes", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    const first = await getCalendarSdk();
    (signerManager.getSigner as any).mockResolvedValue(signer("bob"));
    expect(await getCalendarSdk()).not.toBe(first);
  });

  it("rebuilds when the relay set changes", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    const first = await getCalendarSdk();
    (relayManager.getRelaysForModule as any).mockReturnValue(["wss://b.test"]);
    expect(await getCalendarSdk()).not.toBe(first);
  });

  it("asks for the calendar relay set", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    await getCalendarSdk();
    expect(relayManager.getRelaysForModule).toHaveBeenCalledWith("calendar");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `corepack pnpm --filter @formstr/agent test src/services/calendar/sdk.test.ts`
Expected: FAIL — cannot resolve `./sdk`.

- [ ] **Step 3: Write the agent factory**

Create `packages/agent/src/services/calendar/sdk.ts`:

```ts
import { CalendarSDK, toCalendarSigner } from "@formstr/calendar-sdk";
import { signerManager, nostrRuntime, relayManager } from "@formstr/core";

/**
 * One `CalendarSDK` per (signed-in pubkey, relay set).
 *
 * The SDK takes a signer *instance*, not a resolver, so a cached instance
 * outlives an account switch unless we key the cache on the pubkey. The
 * runtime is injected rather than defaulted, so the SDK shares core's pool and
 * its `dispose()` leaves those sockets alone — core owns them.
 */
let cached: { pubkey: string; relayKey: string; sdk: CalendarSDK } | null = null;

export function calendarRelays(): string[] {
  return relayManager.getRelaysForModule("calendar");
}

export async function getCalendarSdk(): Promise<CalendarSDK> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = calendarRelays();
  const relayKey = relays.join(",");

  if (cached && cached.pubkey === pubkey && cached.relayKey === relayKey) return cached.sdk;

  const sdk = new CalendarSDK({
    signer: toCalendarSigner(signer),
    runtime: nostrRuntime,
    relays,
  });
  cached = { pubkey, relayKey, sdk };
  return sdk;
}

/** Drops the cached instance. Call on logout, and from tests. */
export function resetCalendarSdk(): void {
  cached = null;
}
```

- [ ] **Step 4: Run the agent test to verify it passes**

Run: `corepack pnpm --filter @formstr/agent test src/services/calendar/sdk.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the app factory**

Create `packages/app/src/lib/calendar/sdk.test.ts`. Same four cases as Step 1, importing from `./sdk`, plus one more:

```ts
it("exposes the calendar relay set it was built with", async () => {
  (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
  const sdk = await getCalendarSdk();
  expect(sdk.relays).toEqual(["wss://a.test"]);
});
```

Copy the `vi.mock("@formstr/core", …)`, `signer()` helper and `beforeEach` block verbatim from Step 1 — the app test cannot import them from the agent test.

- [ ] **Step 6: Run it to confirm it fails**

Run: `corepack pnpm --filter @formstr/app test src/lib/calendar/sdk.test.ts`
Expected: FAIL — cannot resolve `./sdk`.

- [ ] **Step 7: Write the app factory**

Create `packages/app/src/lib/calendar/sdk.ts` — identical to the agent's, with one extra constructor option and no `calendarRelays` export:

```ts
const sdk = new CalendarSDK({
  signer: toCalendarSigner(signer),
  runtime: nostrRuntime,
  relays,
  // Invitation rumors embed a share link; without this they carry none.
  appBaseUrl: window.location.origin,
});
```

- [ ] **Step 8: Reset the cache on logout**

In `packages/app/src/stores/authStore.ts`, find the `signerManager.logout()` call (around line 99) and add `resetCalendarSdk();` immediately after it, importing from `../lib/calendar/sdk`. A stale SDK holds the logged-out user's signer.

- [ ] **Step 9: Run both suites**

Run: `corepack pnpm --filter @formstr/app test && corepack pnpm --filter @formstr/agent test`
Expected: app ≥ 386 passed, agent ≥ 361 passed.

- [ ] **Step 10: Commit**

```bash
git add packages/agent/src/services/calendar/sdk.ts packages/agent/src/services/calendar/sdk.test.ts \
        packages/app/src/lib/calendar/sdk.ts packages/app/src/lib/calendar/sdk.test.ts \
        packages/app/src/stores/authStore.ts
git commit -m "feat: build the calendar SDK from the shared runtime"
```

---

### Task 3: Event discovery composer

**Files:**

- Create: `packages/agent/src/services/calendar/discovery.ts`
- Create: `packages/agent/src/services/calendar/discovery.test.ts`

**Interfaces:**

- Consumes: `getCalendarSdk`, `calendarRelays` from Task 2.
- Produces:
  ```ts
  interface DiscoveryOptions { calendars?: readonly CalendarList[]; authors?: string[]; since?: number; until?: number }
  fetchEventsForUser(options?: DiscoveryOptions): Promise<CalendarEvent[]>
  fetchEventsDirect(options?: Omit<DiscoveryOptions, "calendars">): Promise<CalendarEvent[]>
  ```

Why this exists: `sdk.fetchEventsFromCalendars()` returns only events a calendar list references, and no SDK read path filters NIP-09 deletions. See the spec's "Event discovery" section.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent/src/services/calendar/discovery.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const querySync = vi.fn();

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { querySync, subscribe: vi.fn(), publish: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

const sdk = {
  fetchEventsFromCalendars: vi.fn(),
  fetchPublicEvents: vi.fn(),
};
vi.mock("./sdk", () => ({
  getCalendarSdk: vi.fn(async () => sdk),
  calendarRelays: () => ["wss://a.test"],
}));

import { signerManager } from "@formstr/core";

import { fetchEventsForUser } from "./discovery";

function wire(over: Partial<any> = {}) {
  return {
    id: "abc",
    pubkey: "alice",
    kind: 31923,
    created_at: 1000,
    tags: [
      ["d", "party"],
      ["title", "Party"],
      ["start", "1700000000"],
      ["end", "1700003600"],
    ],
    content: "",
    sig: "",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue("alice"),
  });
  sdk.fetchEventsFromCalendars.mockResolvedValue([]);
  sdk.fetchPublicEvents.mockResolvedValue([]);
  querySync.mockResolvedValue([]);
});

describe("fetchEventsForUser", () => {
  it("returns an authored event that no calendar list references", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    const events = await fetchEventsForUser({ calendars: [] });
    expect(events.map((e) => e.id)).toEqual(["party"]);
  });

  it("drops an event its author deleted", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    // The deletion sweep queries kind 5 per collected author.
    querySync.mockImplementation(async (_relays: string[], filter: any) =>
      filter.kinds?.[0] === 5 ? [wire({ kind: 5, tags: [["a", "31923:alice:party"]] })] : [],
    );
    expect(await fetchEventsForUser({ calendars: [] })).toEqual([]);
  });

  it("keeps one copy when a list ref and the direct query return the same event", async () => {
    sdk.fetchPublicEvents.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    sdk.fetchEventsFromCalendars.mockResolvedValue([{ id: "party", user: "alice", kind: 31923 }]);
    expect(await fetchEventsForUser({ calendars: [] })).toHaveLength(1);
  });

  it("queries the private kinds for the signed-in user", async () => {
    await fetchEventsForUser({ calendars: [] });
    const kinds = querySync.mock.calls.map((c: any[]) => c[1].kinds).flat();
    expect(kinds).toContain(32678);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `corepack pnpm --filter @formstr/agent test src/services/calendar/discovery.test.ts`
Expected: FAIL — cannot resolve `./discovery`.

- [ ] **Step 3: Write the composer**

Create `packages/agent/src/services/calendar/discovery.ts`:

```ts
import {
  CALENDAR_KINDS,
  coordinate,
  fetchDeletions,
  isDeleted,
  lookupViewKey,
  newestByCoordinate,
  parseCalendarEvent,
  type CalendarEvent,
  type CalendarList,
  type DeletionIndex,
} from "@formstr/calendar-sdk";
import { signerManager, nostrRuntime } from "@formstr/core";
import type { Event, Filter } from "nostr-tools";

import { calendarRelays, getCalendarSdk } from "./sdk";

export interface DiscoveryOptions {
  /** Pre-fetched calendar lists, whose refs carry the view keys. */
  calendars?: readonly CalendarList[];
  /** Defaults to the signed-in user. */
  authors?: string[];
  since?: number;
  until?: number;
}

async function selfPubkey(): Promise<string | undefined> {
  try {
    return await (await signerManager.getSigner()).getPublicKey();
  } catch {
    return undefined; // anonymous — public browse only
  }
}

/** kind-5 sweep across every author whose events we collected, in parallel. */
async function deletionsFor(authors: Iterable<string>): Promise<DeletionIndex[]> {
  const relays = calendarRelays();
  return Promise.all([...authors].map((a) => fetchDeletions(nostrRuntime, relays, a)));
}

function surviving(events: CalendarEvent[], indexes: DeletionIndex[]): CalendarEvent[] {
  return events.filter((event) => {
    const coord = coordinate(event.kind, event.user, event.id);
    return !indexes.some((index) => isDeleted(index, { id: event.eventId, coordinate: coord }));
  });
}

/**
 * The user's own private events, including any never linked into a calendar
 * list — `publishPrivateEvent`'s `calendarId` is optional, and the SDK's only
 * read path is through list refs.
 */
async function fetchOwnPrivateEvents(
  author: string,
  calendars: readonly CalendarList[],
  options: DiscoveryOptions,
): Promise<CalendarEvent[]> {
  const filter: Filter = {
    kinds: [CALENDAR_KINDS.privateEvent],
    authors: [author],
    ...(options.since && { since: options.since }),
    ...(options.until && { until: options.until }),
  };
  const wire = await nostrRuntime.querySync(calendarRelays(), filter);
  const out: CalendarEvent[] = [];
  for (const [coord, newest] of newestByCoordinate(wire)) {
    try {
      out.push(parseCalendarEvent(newest, { viewKey: lookupViewKey(calendars, coord) }));
    } catch {
      // Undecryptable without a view key — the list-ref path may still supply one.
    }
  }
  return out;
}

/**
 * Every calendar event the user should see: their own (linked or not), the ones
 * their calendar lists reference, minus anything the author deleted.
 *
 * Replaces the agent's former `fetchCalendarEventsForUser`. Candidate to move
 * into the SDK — see docs/sdk/calendar-sdk-followups.md item 1.
 */
export async function fetchEventsForUser(options: DiscoveryOptions = {}): Promise<CalendarEvent[]> {
  const sdk = await getCalendarSdk();
  const calendars = options.calendars ?? [];
  const authors = options.authors ?? [(await selfPubkey()) ?? ""].filter(Boolean);

  const [fromLists, publicEvents, privateEvents] = await Promise.all([
    calendars.length > 0 ? sdk.fetchEventsFromCalendars(calendars) : Promise.resolve([]),
    sdk.fetchPublicEvents({
      ...(authors.length > 0 && { authors }),
      ...(options.since !== undefined && { since: options.since }),
      ...(options.until !== undefined && { until: options.until }),
    }),
    authors.length === 1
      ? fetchOwnPrivateEvents(authors[0], calendars, options)
      : Promise.resolve([]),
  ]);

  const byCoordinate = new Map<string, CalendarEvent>();
  for (const event of [...fromLists, ...publicEvents, ...privateEvents]) {
    const coord = coordinate(event.kind, event.user, event.id);
    const held = byCoordinate.get(coord);
    if (!held || event.createdAt > held.createdAt) byCoordinate.set(coord, event);
  }
  const merged = [...byCoordinate.values()];

  return surviving(merged, await deletionsFor(new Set(merged.map((e) => e.user))));
}

/**
 * Direct query only, no calendar-list refs. The MCP `list_calendar_events` tool
 * has no list context to pass, matching the former `fetchCalendarEventsSync`.
 */
export async function fetchEventsDirect(
  options: Omit<DiscoveryOptions, "calendars"> = {},
): Promise<CalendarEvent[]> {
  return fetchEventsForUser({ ...options, calendars: [] });
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @formstr/agent test src/services/calendar/discovery.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter @formstr/agent typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/services/calendar/discovery.ts packages/agent/src/services/calendar/discovery.test.ts
git commit -m "feat(agent): compose calendar event discovery on the SDK"
```

---

### Task 4: Booking onto SDK types

**Files:**

- Modify: `packages/agent/src/services/calendar/booking.ts`
- Modify: `packages/agent/src/services/calendar/booking.test.ts`

**Interfaces:**

- Consumes: SDK types + primitives.
- Produces: unchanged exports — `SchedulingPage`, `BookingRequest`, `fetchSchedulingPages`, `bookingLinkUrl`, `fetchBookingRequests`, `approveBookingRequest`, `declineBookingRequest`. Signatures are unchanged except that `CalendarList` and `CalendarEvent` now come from the SDK.

Booking's wire format stays as it is on this branch (kinds 31927 / 32680 / 1057 / 1058). Upgrading it to `1059 + ["k", …]` is follow-up 3.

- [ ] **Step 1: Repoint the imports**

In `packages/agent/src/services/calendar/booking.ts`, replace the local imports:

| Remove                                                                            | Add                                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { CALENDAR_KINDS, type CalendarList, type CalendarEvent } from "./types"` | `import { CALENDAR_KINDS, coordinate, nextCreatedAt, unwrapEvent, wrapEvent, type CalendarList, type CalendarEvent } from "@formstr/calendar-sdk"` |
| `import { … } from "./viewKey"`                                                   | drop — use the SDK's `generateViewKey`, `encryptWithViewKey`, `decryptWithViewKey`, `buildEventRef`                                                |
| `import { wrapEvent } from "@formstr/core"`                                       | drop — the SDK's `wrapEvent` verifies the seal on unwrap                                                                                           |

The SDK's `CALENDAR_KINDS` has no booking kinds. Declare them locally at the top of `booking.ts`, since they are this file's protocol and nothing else's:

```ts
/**
 * Booking kinds, absent from @formstr/calendar-sdk 0.1.0. Tracked as follow-up
 * 2 in docs/sdk/calendar-sdk-followups.md; delete this block when the SDK
 * grows a booking service.
 */
const BOOKING_KINDS = {
  schedulingPage: 31927,
  schedulingPagesList: 32680,
  requestGiftWrap: 1057,
  requestRumor: 57,
  responseGiftWrap: 1058,
  responseRumor: 58,
} as const;
```

- [ ] **Step 2: Replace publish plumbing with the SDK-backed one**

Keep booking's own `signerManager.getSigner()` + `nostrRuntime.publish(...)` calls: it publishes kinds 31927 / 32680 / 1057 / 1058, which the SDK cannot. Only the shared pieces move.

`approveBookingRequest` currently builds and publishes the confirmed calendar event by hand. Replace that block with the SDK, which already does the publish, the view-key mint and the calendar-list link:

```ts
const sdk = await getCalendarSdk();
const published = await sdk.publishPrivateEvent(
  {
    title: request.title,
    description: request.description ?? "",
    begin: request.begin, // milliseconds
    end: request.end,
    participants: [request.requesterPubkey],
  },
  {
    // The booker generated this d-tag in advance and referenced it in the
    // request, so the confirmed event has to land on exactly that coordinate.
    dTag: request.eventDTag,
    calendarId: list.id,
  },
);
```

`published.event` replaces whatever the old code returned as `{ event }`, and `published.viewKey` is what the decline/approve response wrap carries back to the requester.

- [ ] **Step 3: Update the tests for the SDK's field names**

In `booking.test.ts`, the `CalendarEvent` fixtures change: `existingId` → `id`, `begin`/`end` stay milliseconds, `website` → `references: []`, add `allDay: false`, drop `startTzid`/`endTzid`/`calendarId`/`isInvitation`.

- [ ] **Step 4: Run the booking tests**

Run: `corepack pnpm --filter @formstr/agent test src/services/calendar/booking.test.ts`
Expected: PASS, same count as before the change (no test deleted).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter @formstr/agent typecheck`
Expected: exit 0. Errors here will point at any remaining `./types` import.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/services/calendar/booking.ts packages/agent/src/services/calendar/booking.test.ts
git commit -m "refactor(agent): rebuild booking on SDK types and primitives"
```

---

### Task 5: Agent tools on the SDK

**Files:**

- Modify: `packages/agent/src/tools/calendar.ts` (686 lines, 20 tools)
- Modify: `packages/agent/test/calendar.test.ts`
- Modify: `packages/agent/src/services/index.ts`

**Interfaces:**

- Consumes: Tasks 2–4.
- Produces: the same 20 tool names with the same input schemas. No tool is added, removed or renamed.

Call-site map — every service call in the file and its replacement:

| Line | Was                                                                    | Now                                                                                          |
| ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 55   | `calendar.fetchCalendarEventsSync({authors, since, until})`            | `discovery.fetchEventsDirect({authors, since, until})`                                       |
| 110  | `calendar.fetchCalendarLists()`                                        | `sdk.fetchCalendars()`                                                                       |
| 147  | `calendar.createCalendarEvent(draft, {calendars})`                     | `sdk.publishPrivateEvent(draft, {calendarId, calendars})` or `sdk.publishPublicEvent(draft)` |
| 177  | `calendar.lookupEventViewKey(coord)`                                   | `sdk.lookupEventViewKey(coord)`                                                              |
| 178  | `calendar.fetchCalendarEventByCoordinate(coord, viewKey)`              | `sdk.fetchEventByCoordinate(coord, {viewKey})`                                               |
| 229  | `calendar.createCalendarList(title, color, description)`               | `sdk.createCalendar({title, color, description})`                                            |
| 241  | `calendarRsvp.fetchRsvpsForEvent(coord, viewKey)`                      | `sdk.fetchRsvps(coord, {viewKey})`                                                           |
| 261  | `calendar.fetchInvitationsSync()`                                      | `sdk.fetchInvitationsWithEvents()`                                                           |
| 393  | `calendar.deleteCalendarEvent(id, coord)`                              | `sdk.deleteEvent({coordinate, kind})`                                                        |
| 436  | `calendarRsvp.rsvpToEvent(coord, status, isPrivate, payload, viewKey)` | `sdk.rsvp({coordinate, payload, viewKey})`                                                   |
| 510  | `calendar.publishPrivateCalendarEvent(draft, calendarId)`              | `sdk.updatePrivateEvent(draft, {previousParticipants, calendarId})`                          |
| 511  | `calendar.publishPublicCalendarEvent(draft)`                           | `sdk.publishPublicEvent(draft)`                                                              |
| 600  | `calendar.updateCalendarList(list)`                                    | `sdk.updateCalendar(list)`                                                                   |
| 622  | `calendar.deleteCalendarList(coord)`                                   | `sdk.deleteCalendar(list)`                                                                   |
| 650  | `calendar.addEventToCalendarList(list, ref)`                           | `sdk.linkEventToCalendar(list, ref)`                                                         |
| 680  | `calendar.removeEventFromCalendarList(list, coord)`                    | `sdk.unlinkEventFromCalendar(list, coord)`                                                   |

- [ ] **Step 1: Write the failing test for the changed update contract**

`update_calendar_event` is the one tool whose behavior genuinely changes: the SDK refuses to guess who already holds an invitation. Add to `packages/agent/test/calendar.test.ts`:

```ts
it("update_calendar_event does not re-invite existing participants", async () => {
  const updatePrivateEvent = vi.fn().mockResolvedValue({
    event: { id: "d1", kind: 32678, user: "me", participants: ["bob"] },
    invitations: [],
  });
  sdk.fetchEventByCoordinate.mockResolvedValue({
    id: "d1",
    kind: 32678,
    user: "me",
    participants: ["bob"],
    isPrivate: true,
  });
  sdk.updatePrivateEvent = updatePrivateEvent;

  await tool("update_calendar_event").handler({
    coordinate: "32678:me:d1",
    title: "Renamed",
    confirm: true,
  });

  expect(updatePrivateEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ previousParticipants: ["bob"] }),
  );
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `corepack pnpm --filter @formstr/agent test test/calendar.test.ts -t "does not re-invite"`
Expected: FAIL.

- [ ] **Step 3: Rewrite the tool bodies**

Replace the module imports at the top of `packages/agent/src/tools/calendar.ts`:

```ts
import { RSVPStatus, type CalendarEventDraft } from "@formstr/calendar-sdk";
import { signerManager } from "@formstr/core";
import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";
import * as discovery from "../services/calendar/discovery";
import { getCalendarSdk } from "../services/calendar/sdk";
import * as calendarBooking from "../services/calendar/booking";
```

Then work down the call-site map above. Each handler starts with `const sdk = await getCalendarSdk();`.

Three shape conversions apply throughout:

- Drafts take millisecond numbers: `begin: date.getTime()`, not `begin: date`. `parseIsoDate` already returns a `Date`; call `.getTime()` at the boundary.
- `existingId` becomes `id` on the draft.
- `registrationFormRef` / `registrationFormViewKey` become `forms: [{ naddr, viewKey }]`; an empty `registrationFormRef` means `forms: []` (detach).

For `update_calendar_event`, fetch the current event first and pass its participants:

```ts
const current = await sdk.fetchEventByCoordinate(coordinate, { viewKey });
if (!current) return fail(`No event at ${coordinate}.`, "NOT_FOUND");
const published = await sdk.updatePrivateEvent(
  { ...draft, id: current.id },
  { previousParticipants: current.participants, calendarId },
);
```

The 4 booking tools (lines 280–371) are untouched.

- [ ] **Step 4: Drop the deleted modules from the services barrel**

In `packages/agent/src/services/index.ts`, remove these three lines:

```ts
export * as calendar from "./calendar/service";
export * as calendarRsvp from "./calendar/rsvp";
export * as calendarBusyList from "./calendar/busyList";
export * from "./calendar/types";
```

and add:

```ts
export * as calendarDiscovery from "./calendar/discovery";
```

`export * as calendarBooking from "./calendar/booking";` stays.

- [ ] **Step 5: Run the agent suite**

Run: `corepack pnpm --filter @formstr/agent test`
Expected: PASS. Tests referencing the deleted service modules will fail here — that is expected and Task 9 deletes them; for now, only `test/calendar.test.ts` and the surviving `booking`/`sdk`/`discovery` tests must pass. If a `src/services/calendar/*.test.ts` file for a module being deleted fails, leave it — Task 9 removes the file.

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter @formstr/agent typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/tools/calendar.ts packages/agent/src/services/index.ts packages/agent/test/calendar.test.ts
git commit -m "refactor(agent): serve the calendar tools from the SDK"
```

---

### Task 6: App types and the calendar store

**Files:**

- Create: `packages/app/src/lib/calendar/types.ts`
- Modify: `packages/app/src/stores/calendarStore.ts` (211 lines)
- Modify: `packages/app/src/stores/calendarStore.test.ts` (292 lines)

**Interfaces:**

- Consumes: `getCalendarSdk` (Task 2), `fetchEventsForUser` (Task 3).
- Produces: `AppCalendarEvent`, and a `useCalendarStore` whose public method signatures are unchanged except `deleteCalendar(list: CalendarList)`.

- [ ] **Step 1: Create the app's event type**

Create `packages/app/src/lib/calendar/types.ts`:

```ts
export type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarList,
  EventRef,
  Invitation,
  RSVPResponse,
  BusyRange,
  BusyList,
} from "@formstr/calendar-sdk";
export { RSVPStatus, CALENDAR_KINDS } from "@formstr/calendar-sdk";

import type { CalendarEvent } from "@formstr/calendar-sdk";

/**
 * A calendar event plus the two fields the app derives locally. Neither is on
 * the wire: `calendarId` is the in-session hint set right after a create, before
 * the calendar-list refetch lands, and `isInvitation` marks an event that
 * arrived through the invitation inbox rather than the user's own lists.
 */
export type AppCalendarEvent = CalendarEvent & {
  calendarId?: string;
  isInvitation?: boolean;
};
```

- [ ] **Step 2: Write the failing store tests**

Rewrite the mock block at the top of `packages/app/src/stores/calendarStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sdk = {
  fetchCalendars: vi.fn(),
  publishPrivateEvent: vi.fn(),
  publishPublicEvent: vi.fn(),
  updatePrivateEvent: vi.fn(),
  createCalendar: vi.fn(),
  updateCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  deleteEvent: vi.fn(),
  unlinkEventFromCalendar: vi.fn(),
  addBusyRange: vi.fn().mockResolvedValue([]),
  removeBusyRange: vi.fn().mockResolvedValue([]),
};

vi.mock("../lib/calendar/sdk", () => ({ getCalendarSdk: vi.fn(async () => sdk) }));
vi.mock("@formstr/agent/services/calendar/discovery", () => ({
  fetchEventsForUser: vi.fn(async () => []),
}));

import { fetchEventsForUser } from "@formstr/agent/services/calendar/discovery";

import { useCalendarStore } from "./calendarStore";
```

Update the `evt()` fixture to the SDK's shape: drop `website`, add `allDay: false` and `references: []`, `geohashes: []`.

Add two new tests:

```ts
describe("updateEvent", () => {
  it("passes the event's current participants so nobody is re-invited", async () => {
    const existing = evt({ id: "d1", kind: 32678, isPrivate: true, participants: ["bob"] });
    useCalendarStore.setState({ events: [existing] });
    sdk.updatePrivateEvent.mockResolvedValue({ event: existing });

    await useCalendarStore.getState().updateEvent({ id: "d1", title: "R", begin: 0, end: 0 });

    expect(sdk.updatePrivateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
      expect.objectContaining({ previousParticipants: ["bob"] }),
    );
  });
});

describe("fetchEvents", () => {
  it("passes the loaded calendars to discovery so private refs decrypt", async () => {
    const calendars = [{ id: "c1", eventRefs: [] }];
    useCalendarStore.setState({ calendars: calendars as any });
    await useCalendarStore.getState().fetchEvents({ authors: ["me"] });
    expect(fetchEventsForUser).toHaveBeenCalledWith(
      expect.objectContaining({ calendars, authors: ["me"] }),
    );
  });
});
```

- [ ] **Step 3: Run to confirm they fail**

Run: `corepack pnpm --filter @formstr/app test src/stores/calendarStore.test.ts`
Expected: FAIL — the store still imports the agent service.

- [ ] **Step 4: Rewrite the store**

In `packages/app/src/stores/calendarStore.ts`, replace the imports:

```ts
import { fetchEventsForUser } from "@formstr/agent/services/calendar/discovery";
import { create } from "zustand";

import { getCalendarSdk } from "../lib/calendar/sdk";
import type { AppCalendarEvent, CalendarEventDraft, CalendarList } from "../lib/calendar/types";

import { useSettingsStore } from "./settingsStore";
```

Then, method by method:

- `publishBusyRangeFor` / `retractBusyRangeFor`: `void (await getCalendarSdk()).addBusyRange({start, end})` — make both `async` and keep the `.catch(() => {})`.
- `fetchEvents(opts)`: `const events = await fetchEventsForUser({ calendars: get().calendars, ...opts });`
- `fetchCalendars()`: `await (await getCalendarSdk()).fetchCalendars()`
- `createEvent(draft)`: private events go through `sdk.publishPrivateEvent(draft, { calendarId, calendars: get().calendars })`, public through `sdk.publishPublicEvent(draft)`. `publishPrivateEvent` returns a `PublishedEvent` — read `.event` for the store, and decorate it with `calendarId` before inserting.
- `updateEvent(draft)`: look up `get().events.find(e => e.id === draft.id)` for the previous version, then `sdk.updatePrivateEvent(draft, { previousParticipants: previous?.participants ?? [], calendarId, calendars })` for private, `sdk.publishPublicEvent(draft, { previousCreatedAt: previous?.createdAt })` for public. Keep the busy-range swap when begin/end moved.
- `deleteEvent(id, coordinate)`: `sdk.deleteEvent({ coordinate, kind })` then `sdk.unlinkEventFromCalendar(owning, coordinate)` for the owning list.
- `deleteCalendar(list)`: signature changes from `(coordinate, id)` to `(list: CalendarList)` — the SDK takes the list object. Update the one caller in `CalendarManageDialog.tsx`.
- `createCalendar(title, color, description)`: `sdk.createCalendar({ title, color, description })`.

Change the store's event type from `CalendarEvent` to `AppCalendarEvent` throughout.

- [ ] **Step 5: Run the store tests**

Run: `corepack pnpm --filter @formstr/app test src/stores/calendarStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/calendar/types.ts packages/app/src/stores/calendarStore.ts packages/app/src/stores/calendarStore.test.ts
git commit -m "refactor(app): read the calendar through the SDK"
```

---

### Task 7: Invitation inbox, with the legacy wrap path

**Files:**

- Modify: `packages/app/src/stores/invitationsStore.ts` (120 lines)
- Modify: `packages/app/src/stores/invitationsStore.test.ts` (148 lines)
- Create: `packages/app/src/lib/calendar/legacyInvitations.ts`
- Create: `packages/app/src/lib/calendar/legacyInvitations.test.ts`

**Interfaces:**

- Consumes: `getCalendarSdk` (Task 2).
- Produces: `subscribeToLegacyInvitations(pubkey, relays, onInvitation): SubscriptionHandle`; `useInvitationsStore` with `invitations: InvitationEntry[]` where `InvitationEntry = Invitation & { event?: CalendarEvent; rsvp?: … }`. The entry key is `giftWrapId`, not `wrapId`; `eventCoordinate` becomes `coordinate`.

The SDK queries kind 1059 with `#k=1052` only. Wraps written by the current super-app are bare kind 1052 and would become invisible. Upstream reads both; so do we.

- [ ] **Step 1: Write the failing legacy-path test**

Create `packages/app/src/lib/calendar/legacyInvitations.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const subscribe = vi.fn();
vi.mock("@formstr/core", () => ({
  nostrRuntime: { subscribe },
  signerManager: { getSigner: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

const unwrapEvent = vi.fn();
const parseInvitationRumor = vi.fn();
vi.mock("@formstr/calendar-sdk", async (orig) => ({
  ...(await orig<typeof import("@formstr/calendar-sdk")>()),
  unwrapEvent,
  parseInvitationRumor,
}));

import { subscribeToLegacyInvitations } from "./legacyInvitations";

beforeEach(() => {
  vi.clearAllMocks();
  subscribe.mockReturnValue({ unsub: vi.fn() });
});

describe("subscribeToLegacyInvitations", () => {
  it("subscribes to bare kind-1052 wraps for the user", async () => {
    subscribeToLegacyInvitations("me", ["wss://a.test"], {} as any, vi.fn());
    expect(subscribe).toHaveBeenCalledWith(
      ["wss://a.test"],
      [{ kinds: [1052], "#p": ["me"] }],
      expect.anything(),
    );
  });

  it("emits an invitation parsed from a legacy wrap", async () => {
    const onInvitation = vi.fn();
    unwrapEvent.mockResolvedValue({ kind: 52, pubkey: "alice", tags: [], content: "" });
    parseInvitationRumor.mockReturnValue({ giftWrapId: "w1", coordinate: "32678:alice:d1" });

    subscribeToLegacyInvitations("me", ["wss://a.test"], {} as any, onInvitation);
    const handler = subscribe.mock.calls[0][2].onEvent;
    await handler({ id: "w1", kind: 1052 });

    await vi.waitFor(() =>
      expect(onInvitation).toHaveBeenCalledWith(expect.objectContaining({ giftWrapId: "w1" })),
    );
  });

  it("swallows a wrap that fails NIP-59 verification", async () => {
    const onInvitation = vi.fn();
    unwrapEvent.mockRejectedValue(new Error("seal signature invalid"));
    subscribeToLegacyInvitations("me", ["wss://a.test"], {} as any, onInvitation);
    await subscribe.mock.calls[0][2].onEvent({ id: "bad", kind: 1052 });
    expect(onInvitation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `corepack pnpm --filter @formstr/app test src/lib/calendar/legacyInvitations.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the legacy reader**

Create `packages/app/src/lib/calendar/legacyInvitations.ts`:

```ts
import {
  parseInvitationRumor,
  unwrapEvent,
  type CalendarSigner,
  type Invitation,
} from "@formstr/calendar-sdk";
import { nostrRuntime, type SubscriptionHandle } from "@formstr/core";
import type { Event } from "nostr-tools";

/** The pre-1059 wrap kind this app used to write. */
const LEGACY_WRAP_KIND = 1052;

/**
 * Reads invitations the super-app sent before it moved to kind-1059 wraps.
 *
 * `invitationInboxFilters()` in the SDK queries kind 1059 with `#k=1052` only,
 * so a wrap written by an older build of this app is invisible to it. Upstream
 * reads both kinds; until the SDK does too (follow-up 4), this fills the gap.
 */
export function subscribeToLegacyInvitations(
  pubkey: string,
  relays: string[],
  signer: CalendarSigner,
  onInvitation: (invitation: Invitation) => void,
): SubscriptionHandle {
  return nostrRuntime.subscribe(relays, [{ kinds: [LEGACY_WRAP_KIND], "#p": [pubkey] }], {
    onEvent: (wrap: Event) => {
      void (async () => {
        try {
          const rumor = await unwrapEvent(wrap, signer);
          const invitation = parseInvitationRumor(rumor, wrap.id);
          if (invitation) onInvitation(invitation);
        } catch {
          // Unverifiable or undecryptable wrap — not ours to render.
        }
      })();
    },
  });
}
```

- [ ] **Step 4: Run the legacy tests**

Run: `corepack pnpm --filter @formstr/app test src/lib/calendar/legacyInvitations.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing store test for merge-by-id**

In `packages/app/src/stores/invitationsStore.test.ts`, replace the agent mocks with:

```ts
const sdk = {
  fetchInvitationsWithEvents: vi.fn(async () => []),
  subscribeToInvitations: vi.fn(() => ({ unsub: vi.fn() })),
  dismissInvitation: vi.fn(async () => undefined),
  fetchEventByCoordinate: vi.fn(async () => null),
};
vi.mock("../lib/calendar/sdk", () => ({ getCalendarSdk: vi.fn(async () => sdk) }));
vi.mock("../lib/calendar/legacyInvitations", () => ({
  subscribeToLegacyInvitations: vi.fn(() => ({ unsub: vi.fn() })),
}));
```

and add:

```ts
it("does not list the same invitation twice when both paths deliver it", async () => {
  sdk.fetchInvitationsWithEvents.mockResolvedValue([
    { giftWrapId: "w1", coordinate: "32678:alice:d1", event: null },
  ]);
  await useInvitationsStore.getState().start();

  const onLegacy = (subscribeToLegacyInvitations as any).mock.calls[0][3];
  onLegacy({ giftWrapId: "w1", coordinate: "32678:alice:d1" });

  expect(useInvitationsStore.getState().invitations).toHaveLength(1);
});

it("records a dismissal through the SDK", async () => {
  sdk.fetchInvitationsWithEvents.mockResolvedValue([
    { giftWrapId: "w1", coordinate: "32678:alice:d1", event: null },
  ]);
  await useInvitationsStore.getState().start();
  useInvitationsStore.getState().dismiss("w1");
  expect(sdk.dismissInvitation).toHaveBeenCalledWith(expect.objectContaining({ giftWrapId: "w1" }));
});
```

- [ ] **Step 6: Run to confirm they fail**

Run: `corepack pnpm --filter @formstr/app test src/stores/invitationsStore.test.ts`
Expected: FAIL.

- [ ] **Step 7: Rewrite the store**

`packages/app/src/stores/invitationsStore.ts`:

- `start()`: resolve the SDK, seed `invitations` from `await sdk.fetchInvitationsWithEvents()` (it honours kind-5 dismissals), then open both subscriptions. The legacy reader needs the relay set and a signer, both already at hand:

  ```ts
  const sdk = await getCalendarSdk();
  const rawSigner = await signerManager.getSigner();
  const pubkey = await rawSigner.getPublicKey();

  const current = sdk.subscribeToInvitations(pubkey, onWrap);
  const legacy = subscribeToLegacyInvitations(
    pubkey,
    [...sdk.relays], // the SDK exposes the set it was built with
    toCalendarSigner(rawSigner), // same binding the factory applies
    onInvitation,
  );
  ```

  Hold both handles; `stop()` unsubscribes both.

- Merge rule: keep a `Set<string>` of seen `giftWrapId`; ignore a second delivery.
- On each new invitation, resolve its event with `sdk.fetchEventByCoordinate(invitation.coordinate, { viewKey: invitation.viewKey })` and push it into `useCalendarStore.getState().ingestEvent({ ...event, isInvitation: true })`.
- `dismiss(giftWrapId)`: look the invitation up in state, call `sdk.dismissInvitation(invitation)`, drop it from the list. Best-effort — keep the `.catch(() => {})`.
- Rename the entry fields: `wrapId` → `giftWrapId`, `eventCoordinate` → `coordinate`. `markRsvp(coord, status)` matches on `coordinate`.

- [ ] **Step 8: Run the store tests**

Run: `corepack pnpm --filter @formstr/app test src/stores/invitationsStore.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/lib/calendar/legacyInvitations.ts packages/app/src/lib/calendar/legacyInvitations.test.ts \
        packages/app/src/stores/invitationsStore.ts packages/app/src/stores/invitationsStore.test.ts
git commit -m "refactor(app): move the invitation inbox onto the SDK"
```

---

### Task 8: The remaining app call sites

**Files:**

- Modify: `packages/app/src/lib/ics.ts:1,52-58`
- Create: `packages/app/src/lib/ics.test.ts`
- Modify: `packages/app/src/lib/rrule.ts:1`
- Modify: `packages/app/src/lib/calendarMembership.ts:1,45-50` and its test
- Modify: `packages/app/src/components/calendar/` — `EventDialog.tsx`, `EventDetailsDialog.tsx`, `InvitationsView.tsx`, `AvailabilityView.tsx`, `CalendarSidebar.tsx`, `CalendarListView.tsx`, `CalendarMonthView.tsx`, `CalendarManageDialog.tsx`, `EventCard.tsx`, `BookingsView.tsx` (+ their tests)
- Modify: `packages/app/src/components/MentionPicker.tsx:1`
- Modify: `packages/app/src/pages/CalendarPage.tsx:1`
- Modify: `packages/app/src/stores/bookingStore.ts:9`

**Interfaces:**

- Consumes: `AppCalendarEvent` and re-exported SDK types from Task 6; `getCalendarSdk` from Task 2.
- Produces: no new exports. After this task nothing in `packages/app` imports `@formstr/agent/services/calendar/{service,rsvp,busyList,types,index}`.

Import map for the mechanical flips:

| Old import                                                                                     | New import                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type { CalendarEvent } from "@formstr/agent/services/calendar"`                               | `type { AppCalendarEvent as CalendarEvent } from "../../lib/calendar/types"`                                                                                                                           |
| `type { CalendarList } from "@formstr/agent/services/calendar"`                                | `type { CalendarList } from "../../lib/calendar/types"`                                                                                                                                                |
| `{ CALENDAR_KINDS } from "@formstr/agent/services/calendar/types"`                             | `{ CALENDAR_KINDS } from "../lib/calendar/types"`                                                                                                                                                      |
| `{ rsvpToEvent } from "…/rsvp"`                                                                | `(await getCalendarSdk()).rsvp({ coordinate, payload, viewKey })`                                                                                                                                      |
| `{ fetchRsvpsForEvent } from "…/rsvp"`                                                         | `(await getCalendarSdk()).fetchRsvps(coordinate, { viewKey })`                                                                                                                                         |
| `{ addBusyRange, removeBusyRange, fetchBusyListsForUser, busyListMonthKey } from "…/busyList"` | `sdk.addBusyRange` / `sdk.removeBusyRange` / `sdk.fetchBusyLists(pubkey, monthKeys)`, and `busyListMonthKey` / `busyListMonthKeysForRange` / `collectBusyRanges` straight from `@formstr/calendar-sdk` |
| `type { SchedulingPage, BookingRequest } from "…/booking"`                                     | unchanged — booking stays in the agent                                                                                                                                                                 |

- [ ] **Step 1: Write the failing ICS timezone test**

Create `packages/app/src/lib/ics.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { buildIcs } from "./ics";

function event(over: Partial<any> = {}) {
  return {
    id: "d1",
    eventId: "e1",
    kind: 31923,
    title: "Standup",
    description: "",
    begin: Date.UTC(2026, 7, 18, 9, 0, 0),
    end: Date.UTC(2026, 7, 18, 9, 30, 0),
    allDay: false,
    location: [],
    participants: [],
    categories: [],
    references: [],
    geohashes: [],
    user: "alice",
    isPrivate: false,
    repeat: { rrule: null },
    createdAt: 0,
    ...over,
  };
}

describe("buildIcs", () => {
  it("keeps the timezone of an older event whose raw tags carry start_tzid", () => {
    const ics = buildIcs([
      event({
        event: {
          tags: [
            ["d", "d1"],
            ["start_tzid", "Europe/Berlin"],
          ],
        },
      }),
    ]);
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:");
  });

  it("falls back to UTC when the event carries no tzid", () => {
    const ics = buildIcs([event()]);
    expect(ics).toContain("DTSTART:20260818T090000Z");
  });
});
```

- [ ] **Step 2: Run to confirm the first case fails**

Run: `corepack pnpm --filter @formstr/app test src/lib/ics.test.ts`
Expected: FAIL on the TZID case — `startTzid` no longer exists on the type.

- [ ] **Step 3: Read tzid off the raw event**

In `packages/app/src/lib/ics.ts`, replace the import and add a helper:

```ts
import type { AppCalendarEvent as CalendarEvent } from "./calendar/types";

/**
 * The SDK neither writes nor parses `start_tzid`/`end_tzid`, matching
 * calendar.formstr.app. Events published by older super-app builds still carry
 * the rows, and `CalendarEvent.event` keeps the raw wire event, so an export of
 * one of those stays timezone-correct. New events export as UTC.
 * See docs/sdk/calendar-sdk-followups.md item 5.
 */
function tzid(event: CalendarEvent, row: "start_tzid" | "end_tzid"): string | undefined {
  return event.event?.tags.find((t) => t[0] === row)?.[1];
}
```

Then in `serializeEvent`, replace `event.startTzid` with `tzid(event, "start_tzid")` and `event.endTzid` with `tzid(event, "end_tzid")`, hoisting both into locals so each is read once.

- [ ] **Step 4: Run the ICS tests**

Run: `corepack pnpm --filter @formstr/app test src/lib/ics.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Flip the type-only imports**

Apply the import map to `rrule.ts`, `calendarMembership.ts`, `MentionPicker.tsx`, `CalendarPage.tsx`, `EventCard.tsx`, `CalendarListView.tsx`, `CalendarMonthView.tsx`, `CalendarSidebar.tsx`, `CalendarManageDialog.tsx`, `BookingsView.tsx`, `bookingStore.ts` and every matching `.test.tsx`. These are import-line-only edits; no logic changes.

In `calendarMembership.ts`, the `event.calendarId` read at line 45 still works — `AppCalendarEvent` carries it.

- [ ] **Step 6: Convert the RSVP call sites**

`EventDetailsDialog.tsx:94,115,116` and `InvitationsView.tsx:68,78,88`:

```ts
const sdk = await getCalendarSdk();
await sdk.rsvp({
  coordinate,
  payload: { status, comment, suggestedStart, suggestedEnd },
  viewKey: event.viewKey,
});
const refreshed = await sdk.fetchRsvps(coordinate, { viewKey: event.viewKey });
```

The SDK picks the public (31925) or private (32069) path from the coordinate's kind, so the `isPrivate` argument disappears. `RSVPResponse.eventCoordinate` is now `eventCoord` — update any read of it.

- [ ] **Step 7: Convert the busy-list call sites**

`AvailabilityView.tsx`: `fetchBusyListsForUser(pubkey)` becomes

```ts
const sdk = await getCalendarSdk();
const lists = await sdk.fetchBusyLists(pubkey, busyListMonthKeysForRange(rangeStart, rangeEnd));
const ranges = collectBusyRanges(lists, rangeStart, rangeEnd);
```

with `busyListMonthKeysForRange` and `collectBusyRanges` imported from `@formstr/calendar-sdk`. `addBusyRange` / `removeBusyRange` become `sdk.addBusyRange` / `sdk.removeBusyRange`.

- [ ] **Step 8: Convert the event dialog's form attachment**

`EventDialog.tsx:85,87,131,136` — the single `registrationFormRef` string becomes the SDK's `forms` array:

```ts
setFormRef(event.forms?.[0]?.naddr ?? "");
// …
forms: formRef ? [{ naddr: formRef, viewKey: formViewKey || undefined }] : [],
```

An empty `formRef` publishes `forms: []`, which detaches. Draft dates convert at the boundary: `begin: beginDate.getTime()`, `end: endDate.getTime()`, and `existingId` becomes `id`.

- [ ] **Step 9: Verify no app file imports the agent calendar service**

Run:

```bash
grep -rn "@formstr/agent/services/calendar/\(service\|rsvp\|busyList\|types\)" packages/app/src || echo CLEAN
```

Expected: `CLEAN`. Imports of `@formstr/agent/services/calendar/booking` and `/discovery` are expected to remain.

- [ ] **Step 10: Run the full app suite and typecheck**

Run: `corepack pnpm --filter @formstr/app test && corepack pnpm --filter @formstr/app typecheck`
Expected: PASS, ≥ 391 tests. Typecheck exit 0.

- [ ] **Step 11: Commit**

```bash
git add packages/app/src
git commit -m "refactor(app): flip the remaining calendar call sites to the SDK"
```

---

### Task 9: Delete the duplicated service

**Files:**

- Delete: `packages/agent/src/services/calendar/{service,rsvp,busyList,viewKey,calendarListCodec,types}.ts` and their `.test.ts` siblings
- Modify: `packages/agent/src/services/calendar/index.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `packages/agent/src/services/calendar/` containing only `sdk.ts`, `discovery.ts`, `booking.ts`, `index.ts` and their tests.

- [ ] **Step 1: Confirm nothing imports the doomed modules**

Run:

```bash
grep -rn "calendar/\(service\|rsvp\|busyList\|viewKey\|calendarListCodec\|types\)" \
  packages/app/src packages/agent/src packages/mcp/src || echo CLEAN
```

Expected: `CLEAN`. Any hit is a Task 5–8 leftover — fix it before deleting.

- [ ] **Step 2: Delete**

```bash
git rm packages/agent/src/services/calendar/{service,rsvp,busyList,viewKey,calendarListCodec,types}.ts \
       packages/agent/src/services/calendar/{service,rsvp,busyList,viewKey,calendarListCodec}.test.ts
```

- [ ] **Step 3: Rewrite the barrel**

`packages/agent/src/services/calendar/index.ts`:

```ts
export * from "./sdk";
export * from "./discovery";
export * from "./booking";
```

- [ ] **Step 4: Run both suites, both typechecks, and the build**

Run:

```bash
corepack pnpm --filter @formstr/agent test && corepack pnpm --filter @formstr/agent typecheck && \
corepack pnpm --filter @formstr/app test && corepack pnpm --filter @formstr/app typecheck && \
corepack pnpm --filter @formstr/app build && corepack pnpm -r typecheck
```

Expected: all green. Agent test count drops — the deleted service's ~150 tests go with it, replaced by the SDK's own 89 upstream. Record the new numbers.

- [ ] **Step 5: Commit**

```bash
git add packages/agent
git commit -m "refactor(agent): delete the calendar service the SDK replaces"
```

---

### Task 10: Documentation

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/sdk/calendar.md`
- Modify: `docs/sdk/calendar-sdk-followups.md`
- Modify: `CLAUDE.md` (gitignored working notes — update in place)

- [ ] **Step 1: Update the architecture doc**

In `docs/ARCHITECTURE.md`, wherever the calendar module is described as living in `packages/agent/src/services/calendar`, say instead that the calendar protocol comes from `@formstr/calendar-sdk`, that the agent keeps only booking and the discovery composer, and that both the app and the agent build their SDK instance from `signerManager` / `nostrRuntime` / `relayManager`.

- [ ] **Step 2: Mark the reference doc as describing the SDK**

`docs/sdk/calendar.md` documents the protocol as the agent implemented it. Add a note at the top pointing at the SDK's own README as the authority, and correct the wrap kinds — 1059 with `["k","1052"]`, rumor kind 14, kind-5 dismissals — since the in-repo implementation is gone.

- [ ] **Step 3: Close out what shipped in the follow-ups tracker**

In `docs/sdk/calendar-sdk-followups.md`, item 1's "Blocks deleting" line now points at `packages/agent/src/services/calendar/discovery.ts`, not the app path. Add to item 1 that the SDK's `isDeleted` has no `created_at` comparison, so an event re-published after a deletion stays hidden — the agent's index tracked deletion times and did not.

- [ ] **Step 4: Update the working notes**

In `CLAUDE.md`, replace the "Calendar SDK" section's "Next steps" item 1 ("Rewire agent's calendar service as a thin wrapper over the SDK") with what actually happened, record the branch and PR, and note the new test baselines.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record the calendar SDK integration"
```

---

### Task 11: Live verification

No commit. This is the gate before opening the PR.

- [ ] **Step 1: Start the dev server**

Run: `corepack pnpm dev`
Expected: Vite on localhost:5173, zero console errors on the calendar route.

- [ ] **Step 2: Round-trip a private event across two keys**

With two throwaway nsecs (generate them; never reuse a real key):

1. Key A: create a calendar, create a private event in it, invite key B.
2. Reload. The event is still there and still decrypts.
3. Key B: the invitation appears in the inbox; accept it; the event renders.
4. Key B: RSVP accepted. Key A sees the RSVP on the event.
5. Key A: edit the event's title. **Key B must not receive a second invitation wrap** — this is the `previousParticipants` contract.
6. Key A: dismiss an invitation, reload, confirm it stays gone.

- [ ] **Step 3: Confirm the wire format**

In the browser devtools network tab, confirm the invitation publish is **kind 1059** carrying `["k","1052"]`, not a bare 1052.

- [ ] **Step 4: Cross-check interop**

Log into calendar.formstr.app with key A's nsec. The calendar and the private event must render there. This is the claim the whole change rests on.

- [ ] **Step 5: Confirm the deletion sweep**

Delete an event in the app, hard-reload. It must not come back.

- [ ] **Step 6: Export an ICS**

Export a pre-migration event that carries `start_tzid` and confirm the `DTSTART;TZID=` line survives; export a newly created one and confirm it is UTC.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin calendar-sdk-integration
gh pr create --base dev --title "Integrate @formstr/calendar-sdk" --body "…"
```

The body must state the wire-format change (1052 → 1059 + `k`, kind 84 → kind 5), the accepted regressions from the spec, and link both docs. No AI attribution.
