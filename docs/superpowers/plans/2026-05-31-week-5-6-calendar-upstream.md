# Calendar Module (Week 5-6 Upstream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Calendar service/stores (unstub invitations, add missing methods, tests) and split the 833-LOC `CalendarPage` monolith into focused components, so a user can create events, view them as month/list, invite attendees via NIP-59, and receive + respond to invitations from an inbox.

**Architecture:** Two sequential PRs. PR 1 = service/store/invitations hardening + tests (no UI). PR 2 = `CalendarPage` split into presentational components + coverage gate. Zustand stores call the `@formstr/core`-backed calendar service; invitations arrive via a NIP-59 gift-wrap subscription bridged into `AppShell` on auth.

**Tech Stack:** React 19, MUI v6, Zustand 5, nostr-tools, `@formstr/core` (signer/runtime/relay/crypto + `wrapEvent`/`unwrapEvent`), Vitest + Testing Library.

**Spec:** [../specs/2026-05-31-week-5-6-calendar-upstream-design.md](../specs/2026-05-31-week-5-6-calendar-upstream-design.md)

**Branches/PRs:** `upstream-week5&6-pr1` (this branch, off `main`) → PR to `formstr-hq/super-app:main`. Then `upstream-week5&6-pr2` off pr1.

**Conventions:**

- Run a single test file: `pnpm --filter @formstr/app exec vitest run <path>` (do NOT use `pnpm test -- <path>` — it runs the whole suite).
- Typecheck: `pnpm --filter @formstr/app run typecheck`. Build: `pnpm --filter @formstr/app run build`.
- Commits are GPG-signed (`commit.gpgsign=true`) — the user keeps the gpg-agent warm; if a commit fails with a gpg timeout, pause and ask them to re-warm it (do **not** silently `--no-gpg-sign`).
- Calendar relays come from `relayManager.getRelaysForModule("calendar")`.
- Each calendar service/store test mirrors `src/services/forms/service.test.ts`: `vi.mock("@formstr/core", …)` with all external imports at the TOP (vitest hoists `vi.mock`), then the module under test.

---

## File Structure

| File                                                                   | Responsibility                                                                                             | PR / Tasks     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| `packages/app/src/services/calendar/service.ts`                        | add `fetchCalendarEventByCoordinate`; honor `draft.existingId` in publish fns; export `parseCalendarEvent` | PR1 T1, T2     |
| `packages/app/src/services/calendar/service.test.ts`                   | service tests                                                                                              | PR1 T1, T2, T6 |
| `packages/app/src/services/calendar/rsvp.test.ts`                      | rsvp tests                                                                                                 | PR1 T6         |
| `packages/app/src/stores/calendarStore.ts`                             | add `ingestEvent`, `updateEvent`                                                                           | PR1 T3         |
| `packages/app/src/stores/calendarStore.test.ts`                        | store tests                                                                                                | PR1 T3         |
| `packages/app/src/stores/invitationsStore.ts`                          | restore full impl, add `subscription`, drop `@ts-nocheck`                                                  | PR1 T4         |
| `packages/app/src/stores/invitationsStore.test.ts`                     | invitations tests                                                                                          | PR1 T4         |
| `packages/app/tsconfig.json`                                           | remove `invitationsStore.ts` from `exclude`                                                                | PR1 T4         |
| `packages/app/src/layout/AppShell.tsx`                                 | start/stop invitations on auth                                                                             | PR1 T5         |
| `packages/app/src/components/calendar/EventCard.tsx` (+ test)          | NEW: single event chip/row                                                                                 | PR2 T8         |
| `packages/app/src/components/calendar/CalendarMonthView.tsx` (+ test)  | NEW: month grid                                                                                            | PR2 T9         |
| `packages/app/src/components/calendar/CalendarListView.tsx` (+ test)   | NEW: upcoming list                                                                                         | PR2 T10        |
| `packages/app/src/components/calendar/CreateEventDialog.tsx` (+ test)  | NEW: create/edit dialog                                                                                    | PR2 T11        |
| `packages/app/src/components/calendar/EventDetailsDialog.tsx` (+ test) | NEW: details + RSVP/edit/delete                                                                            | PR2 T12        |
| `packages/app/src/pages/CalendarPage.tsx`                              | slim orchestrator (<200 LOC)                                                                               | PR2 T13        |
| `packages/app/vitest.config.ts`                                        | add `src/services/calendar/**` 80% gate                                                                    | PR2 T14        |

---

# PR 1 — `fix(calendar): unstub invitations + service hardening + tests`

## Task 1: `fetchCalendarEventByCoordinate` (service)

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Create: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Export the existing `parseCalendarEvent` helper**

In `service.ts`, change the helper declaration (currently `async function parseCalendarEvent`) to be exported so tests + the coordinate fetch can reuse it:

```ts
export async function parseCalendarEvent(event: Event): Promise<CalendarEvent | null> {
```

- [ ] **Step 2: Write the failing test**

Create `packages/app/src/services/calendar/service.test.ts`:

```ts
import {
  signerManager,
  nostrRuntime,
  relayManager,
  nip44SelfEncrypt,
  nip44SelfDecrypt,
  wrapEvent,
} from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), fetchOne: vi.fn(), querySync: vi.fn(), subscribe: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  nip44SelfEncrypt: vi.fn(),
  nip44SelfDecrypt: vi.fn(),
  wrapEvent: vi.fn(),
  unwrapEvent: vi.fn(),
}));

import {
  publishPublicCalendarEvent,
  publishPrivateCalendarEvent,
  fetchCalendarEventsSync,
  fetchCalendarEventByCoordinate,
  deleteCalendarEvent,
} from "./service";
import { CALENDAR_KINDS } from "./types";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbccdd"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbccdd" }),
    ),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
  (nip44SelfEncrypt as any).mockResolvedValue("enc");
});

describe("fetchCalendarEventByCoordinate", () => {
  it("returns null when no event matches", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([]);
    const result = await fetchCalendarEventByCoordinate("31923:formpub:abc12345");
    expect(result).toBeNull();
  });

  it("returns the parsed event on a hit", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "eid",
        pubkey: "formpub",
        kind: CALENDAR_KINDS.publicEvent,
        created_at: 1000,
        sig: "sig",
        content: "",
        tags: [
          ["d", "abc12345"],
          ["title", "Launch Party"],
          ["start", "1700000000"],
          ["end", "1700003600"],
        ],
      } satisfies Event,
    ]);
    const result = await fetchCalendarEventByCoordinate("31923:formpub:abc12345");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Launch Party");
    expect(result!.id).toBe("abc12345");
  });

  it("returns null on a malformed coordinate", async () => {
    expect(await fetchCalendarEventByCoordinate("garbage")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it — expect failure**

Run: `pnpm --filter @formstr/app exec vitest run src/services/calendar/service.test.ts`
Expected: FAIL — `fetchCalendarEventByCoordinate` is not exported.

- [ ] **Step 4: Implement `fetchCalendarEventByCoordinate`**

Add to `service.ts` (after `fetchCalendarEventsSync`):

```ts
/**
 * Fetch + parse a single calendar event referenced by an addressable
 * coordinate `kind:pubkey:dTag`. Returns null on a malformed coordinate or miss.
 */
export async function fetchCalendarEventByCoordinate(
  coordinate: string,
): Promise<CalendarEvent | null> {
  const [kindStr, pubkey, dTag] = coordinate.split(":");
  const kind = Number(kindStr);
  if (!kind || !pubkey || !dTag) return null;

  const relays = relayManager.getRelaysForModule("calendar");
  const events = await nostrRuntime.querySync(relays, {
    kinds: [kind],
    authors: [pubkey],
    "#d": [dTag],
  } as Filter);
  if (events.length === 0) return null;

  // Newest-wins (addressable events can diverge across relays).
  const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  return parseCalendarEvent(newest);
}
```

- [ ] **Step 5: Run — expect pass.** `pnpm --filter @formstr/app exec vitest run src/services/calendar/service.test.ts` → PASS.

- [ ] **Step 6: Typecheck.** `pnpm --filter @formstr/app run typecheck` → 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/services/calendar/service.ts packages/app/src/services/calendar/service.test.ts
git commit -m "feat(calendar): fetchCalendarEventByCoordinate + export parseCalendarEvent"
```

---

## Task 2: Honor `existingId` in publish functions (enables update)

The publish functions currently always generate a fresh `eventId`, so re-publishing (update) would create a new event instead of replacing. Make them honor `draft.existingId`.

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Modify: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Write the failing test** (append to `service.test.ts`)

```ts
describe("publishPublicCalendarEvent — update", () => {
  it("reuses draft.existingId as the d-tag when provided", async () => {
    await publishPublicCalendarEvent({
      title: "Edited",
      description: "",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
      existingId: "keepme00",
    });
    const published = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(published.tags).toContainEqual(["d", "keepme00"]);
  });

  it("generates a fresh d-tag when existingId is absent", async () => {
    await publishPublicCalendarEvent({
      title: "New",
      description: "",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
    });
    const published = (nostrRuntime.publish as any).mock.calls[0][1];
    const dTag = published.tags.find((t: string[]) => t[0] === "d")?.[1];
    expect(dTag).toBeTruthy();
    expect(dTag).not.toBe("keepme00");
  });
});
```

- [ ] **Step 2: Run — expect failure** (the first test fails: d-tag is random, not `keepme00`).
      Run: `pnpm --filter @formstr/app exec vitest run src/services/calendar/service.test.ts`

- [ ] **Step 3: Implement**

In `publishPublicCalendarEvent` and `publishPrivateCalendarEvent`, replace:

```ts
const eventId = crypto.randomUUID().slice(0, 8);
```

with:

```ts
const eventId = draft.existingId ?? crypto.randomUUID().slice(0, 8);
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/services/calendar/service.ts packages/app/src/services/calendar/service.test.ts
git commit -m "feat(calendar): honor draft.existingId for replaceable-event updates"
```

---

## Task 3: `calendarStore.ingestEvent` + `updateEvent`

**Files:**

- Modify: `packages/app/src/stores/calendarStore.ts`
- Create: `packages/app/src/stores/calendarStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/stores/calendarStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/calendar/service", () => ({
  fetchCalendarEventsSync: vi.fn(),
  fetchCalendarLists: vi.fn(),
  publishPublicCalendarEvent: vi.fn(),
  publishPrivateCalendarEvent: vi.fn(),
  createCalendarList: vi.fn(),
  updateCalendarList: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

import * as calendarService from "../services/calendar/service";
import { useCalendarStore } from "./calendarStore";

function evt(over: Partial<any> = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "E",
    description: "",
    kind: 31923,
    begin: 0,
    end: 0,
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "pub",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCalendarStore.setState({ events: [], calendars: [], error: null });
});

describe("ingestEvent", () => {
  it("adds an event and does not duplicate by id", () => {
    useCalendarStore.getState().ingestEvent(evt({ id: "a" }));
    useCalendarStore.getState().ingestEvent(evt({ id: "a" }));
    expect(useCalendarStore.getState().events).toHaveLength(1);
  });
});

describe("updateEvent", () => {
  it("re-publishes with existingId and replaces the event in place", async () => {
    useCalendarStore.setState({ events: [evt({ id: "x", title: "Old" })] });
    (calendarService.publishPublicCalendarEvent as any).mockResolvedValue(
      evt({ id: "x", title: "New" }),
    );
    await useCalendarStore.getState().updateEvent({
      title: "New",
      description: "",
      begin: new Date(0),
      end: new Date(0),
      existingId: "x",
    });
    expect(calendarService.publishPublicCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({ existingId: "x" }),
    );
    const events = useCalendarStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("New");
  });
});
```

- [ ] **Step 2: Run — expect failure** (`ingestEvent`/`updateEvent` not on the store).
      Run: `pnpm --filter @formstr/app exec vitest run src/stores/calendarStore.test.ts`

- [ ] **Step 3: Implement**

In `calendarStore.ts`, add to the `CalendarStore` interface:

```ts
  ingestEvent(event: CalendarEvent): void;
  updateEvent(draft: CalendarEventDraft): Promise<CalendarEvent>;
```

Add to the store body (after `createEvent`):

```ts
  ingestEvent(event) {
    set((state) =>
      state.events.some((e) => e.id === event.id)
        ? state
        : { events: [...state.events, event] },
    );
  },

  async updateEvent(draft) {
    set({ error: null });
    try {
      const event = draft.isPrivate
        ? await calendarService.publishPrivateCalendarEvent(draft, draft.calendarId ?? "default")
        : await calendarService.publishPublicCalendarEvent(draft);
      set((state) => ({
        events: state.events.map((e) => (e.id === event.id ? event : e)),
      }));
      return event;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to update event" });
      throw e;
    }
  },
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/app run typecheck
git add packages/app/src/stores/calendarStore.ts packages/app/src/stores/calendarStore.test.ts
git commit -m "feat(calendar): calendarStore ingestEvent + updateEvent"
```

---

## Task 4: Restore `invitationsStore`

**Files:**

- Modify: `packages/app/src/stores/invitationsStore.ts`
- Modify: `packages/app/tsconfig.json`
- Create: `packages/app/src/stores/invitationsStore.test.ts`

- [ ] **Step 1: Restore the implementation**

Rewrite `invitationsStore.ts` to the working version (remove `@ts-nocheck`, add `subscription`, inline the previously-commented logic, drop the trailing comment block):

```ts
import { signerManager, nostrRuntime, relayManager, type SubscriptionHandle } from "@formstr/core";
import type { Filter } from "nostr-tools";
import { create } from "zustand";

import { extractInvitationFromWrap, type InvitationRumor } from "../services/calendar/rsvp";
import { fetchCalendarEventByCoordinate } from "../services/calendar/service";
import { CALENDAR_KINDS, type CalendarEvent } from "../services/calendar/types";

import { useCalendarStore } from "./calendarStore";

export interface InvitationEntry extends InvitationRumor {
  event?: CalendarEvent;
  rsvp?: "accepted" | "declined" | "tentative";
}

interface InvitationsStore {
  invitations: InvitationEntry[];
  isSubscribing: boolean;
  subscription: SubscriptionHandle | null;
  start(): Promise<void>;
  stop(): void;
  markRsvp(coord: string, status: "accepted" | "declined" | "tentative"): void;
  dismiss(wrapId: string): void;
  hasPending(): boolean;
}

export const useInvitationsStore = create<InvitationsStore>((set, get) => ({
  invitations: [],
  isSubscribing: false,
  subscription: null,

  async start() {
    if (get().subscription || get().isSubscribing) return;
    set({ isSubscribing: true });
    try {
      const signer = await signerManager.getSigner();
      const pubkey = await signer.getPublicKey();
      const relays = relayManager.getRelaysForModule("calendar");
      const filters: Filter[] = [
        { kinds: [CALENDAR_KINDS.giftWrap, CALENDAR_KINDS.rsvpGiftWrap], "#p": [pubkey] },
      ];
      const handle = nostrRuntime.subscribe(relays, filters, {
        onEvent: (wrap) => {
          void (async () => {
            const invitation = await extractInvitationFromWrap(wrap);
            if (!invitation) return;
            const event = await fetchCalendarEventByCoordinate(invitation.eventCoordinate);
            if (event) {
              useCalendarStore.getState().ingestEvent({ ...event, isInvitation: true });
            }
            set((state) => {
              if (state.invitations.some((i) => i.wrapId === invitation.wrapId)) return state;
              return {
                invitations: [{ ...invitation, event: event ?? undefined }, ...state.invitations],
              };
            });
          })();
        },
      });
      set({ subscription: handle, isSubscribing: false });
    } catch {
      set({ isSubscribing: false });
    }
  },

  stop() {
    get().subscription?.unsub();
    set({ subscription: null, invitations: [] });
  },

  markRsvp(coord, status) {
    set((state) => ({
      invitations: state.invitations.map((i) =>
        i.eventCoordinate === coord ? { ...i, rsvp: status } : i,
      ),
    }));
  },

  dismiss(wrapId) {
    set((state) => ({ invitations: state.invitations.filter((i) => i.wrapId !== wrapId) }));
  },

  hasPending() {
    return get().invitations.some((i) => !i.rsvp);
  },
}));
```

- [ ] **Step 2: Remove from tsconfig exclude**

In `packages/app/tsconfig.json`, change:

```json
"exclude": ["src/ai/actionDispatcher.ts", "src/stores/invitationsStore.ts"],
```

to:

```json
"exclude": ["src/ai/actionDispatcher.ts"],
```

- [ ] **Step 3: Write the test**

Create `packages/app/src/stores/invitationsStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { subscribe: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
}));
vi.mock("../services/calendar/rsvp", () => ({ extractInvitationFromWrap: vi.fn() }));
vi.mock("../services/calendar/service", () => ({ fetchCalendarEventByCoordinate: vi.fn() }));

import { signerManager, nostrRuntime } from "@formstr/core";
import { extractInvitationFromWrap } from "../services/calendar/rsvp";
import { fetchCalendarEventByCoordinate } from "../services/calendar/service";
import { useCalendarStore } from "./calendarStore";
import { useInvitationsStore } from "./invitationsStore";

const handle = { unsub: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  useInvitationsStore.setState({ invitations: [], isSubscribing: false, subscription: null });
  (signerManager.getSigner as any).mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue("me"),
  });
});

describe("invitationsStore.start", () => {
  it("subscribes to gift-wrap kinds and ingests resolved invitation events (deduped)", async () => {
    let onEvent: ((w: any) => void) | undefined;
    (nostrRuntime.subscribe as any).mockImplementation((_r: any, _f: any, opts: any) => {
      onEvent = opts.onEvent;
      return handle;
    });
    (extractInvitationFromWrap as any).mockResolvedValue({
      eventCoordinate: "31923:author:abc12345",
      authorPubkey: "author",
      kind: 31923,
      wrapId: "w1",
      receivedAt: 1,
    });
    (fetchCalendarEventByCoordinate as any).mockResolvedValue({ id: "abc12345", title: "Party" });
    const ingestSpy = vi
      .spyOn(useCalendarStore.getState(), "ingestEvent")
      .mockImplementation(() => {});

    await useInvitationsStore.getState().start();
    expect(nostrRuntime.subscribe).toHaveBeenCalled();

    await onEvent!({ id: "w1" });
    await onEvent!({ id: "w1" }); // duplicate wrap
    await new Promise((r) => setTimeout(r, 0));

    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc12345", isInvitation: true }),
    );
    expect(useInvitationsStore.getState().invitations).toHaveLength(1);
  });
});

describe("invitationsStore mutations", () => {
  it("markRsvp sets status; dismiss removes; stop unsubscribes", () => {
    useInvitationsStore.setState({
      invitations: [
        { eventCoordinate: "c", authorPubkey: "a", kind: 31923, wrapId: "w1", receivedAt: 0 },
      ],
      subscription: handle as any,
    });
    useInvitationsStore.getState().markRsvp("c", "accepted");
    expect(useInvitationsStore.getState().invitations[0].rsvp).toBe("accepted");
    expect(useInvitationsStore.getState().hasPending()).toBe(false);

    useInvitationsStore.getState().stop();
    expect(handle.unsub).toHaveBeenCalled();
    expect(useInvitationsStore.getState().invitations).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run — expect pass.**
      Run: `pnpm --filter @formstr/app exec vitest run src/stores/invitationsStore.test.ts`

- [ ] **Step 5: Typecheck (invitationsStore now type-checked) + commit**

```bash
pnpm --filter @formstr/app run typecheck
git add packages/app/src/stores/invitationsStore.ts packages/app/tsconfig.json packages/app/src/stores/invitationsStore.test.ts
git commit -m "fix(calendar): restore invitationsStore subscription + drop @ts-nocheck"
```

---

## Task 5: Bridge invitations into `AppShell` on auth

**Files:**

- Modify: `packages/app/src/layout/AppShell.tsx`

- [ ] **Step 1: Wire start/stop**

Add the import:

```tsx
import { useAuthStore, useSettingsStore, useInvitationsStore } from "../stores";
```

Replace the existing `pubkey` effect (lines ~24-28):

```tsx
const pubkey = useAuthStore((s) => s.pubkey);
useEffect(() => {
  if (!pubkey) return;
  void relayManager.fetchUserRelays(pubkey);
  void useInvitationsStore.getState().start();
  return () => useInvitationsStore.getState().stop();
}, [pubkey]);
```

- [ ] **Step 2: Confirm `useInvitationsStore` is exported from the stores barrel**

Run: `grep -n "invitationsStore\|useInvitationsStore" packages/app/src/stores/index.ts`
If not exported, add `export { useInvitationsStore } from "./invitationsStore";` to `packages/app/src/stores/index.ts`.

- [ ] **Step 3: Typecheck.** `pnpm --filter @formstr/app run typecheck` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/layout/AppShell.tsx packages/app/src/stores/index.ts
git commit -m "feat(calendar): start invitations subscription on auth in AppShell"
```

---

## Task 6: Fill service + rsvp coverage

**Files:**

- Modify: `packages/app/src/services/calendar/service.test.ts`
- Create: `packages/app/src/services/calendar/rsvp.test.ts`

- [ ] **Step 1: Add service tests** (append to `service.test.ts`)

```ts
describe("publishPublicCalendarEvent — tags", () => {
  it("publishes kind-31923 with title/start/end/participant tags", async () => {
    await publishPublicCalendarEvent({
      title: "Standup",
      description: "daily",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
      location: "Zoom",
      participants: ["pubA"],
      categories: ["work"],
    });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(CALENDAR_KINDS.publicEvent);
    expect(e.tags).toContainEqual(["title", "Standup"]);
    expect(e.tags).toContainEqual(["start", "1700000000"]);
    expect(e.tags).toContainEqual(["p", "pubA"]);
    expect(e.tags).toContainEqual(["location", "Zoom"]);
  });
});

describe("publishPrivateCalendarEvent — gift wraps", () => {
  it("encrypts content and publishes a gift-wrap per participant", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap", kind: CALENDAR_KINDS.giftWrap });
    await publishPrivateCalendarEvent(
      {
        title: "Secret",
        description: "",
        begin: new Date(1700000000000),
        end: new Date(1700003600000),
        participants: ["pubA", "pubB"],
        isPrivate: true,
      },
      "default",
    );
    // 1 private event + 2 gift-wraps = 3 publishes
    expect((nostrRuntime.publish as any).mock.calls.length).toBe(3);
    expect(wrapEvent).toHaveBeenCalledTimes(2);
    const privateEvt = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(privateEvt.kind).toBe(CALENDAR_KINDS.privateEvent);
    expect(privateEvt.content).toBe("enc");
  });
});

describe("fetchCalendarEventsSync", () => {
  it("parses returned events", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "e1",
        pubkey: "p",
        kind: CALENDAR_KINDS.publicEvent,
        created_at: 1,
        sig: "s",
        content: "",
        tags: [
          ["d", "d1"],
          ["title", "T"],
          ["start", "1700000000"],
          ["end", "1700003600"],
        ],
      } satisfies Event,
    ]);
    const events = await fetchCalendarEventsSync({});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("T");
  });
});

describe("deleteCalendarEvent", () => {
  it("publishes kind-5 with the a-tag coordinate", async () => {
    await deleteCalendarEvent("e1", "31923:p:d1");
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(5);
    expect(e.tags).toContainEqual(["a", "31923:p:d1"]);
  });
});
```

- [ ] **Step 2: Create `rsvp.test.ts`**

```ts
import { signerManager, nostrRuntime, relayManager, wrapEvent, unwrapEvent } from "@formstr/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), querySync: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  wrapEvent: vi.fn(),
  unwrapEvent: vi.fn(),
}));

import { rsvpToEvent, extractInvitationFromWrap } from "./rsvp";
import { CALENDAR_KINDS } from "./types";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("me"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) => Promise.resolve({ ...e, id: "eid", sig: "s", pubkey: "me" })),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
});

describe("rsvpToEvent", () => {
  it("publishes a public RSVP with status + coordinate", async () => {
    await rsvpToEvent("31923:author:abc12345", "accepted", false);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(CALENDAR_KINDS.publicRsvp);
    expect(e.tags).toContainEqual(["a", "31923:author:abc12345"]);
    expect(e.tags).toContainEqual(["status", "accepted"]);
  });

  it("throws on a malformed coordinate", async () => {
    await expect(rsvpToEvent("bad", "accepted")).rejects.toThrow();
  });
});

describe("extractInvitationFromWrap", () => {
  it("returns the invitation coordinate from an unwrapped calendar rumor", async () => {
    (unwrapEvent as any).mockResolvedValue({
      kind: CALENDAR_KINDS.rumor,
      pubkey: "author",
      content: JSON.stringify({ eventId: "abc12345" }),
    });
    const inv = await extractInvitationFromWrap({ id: "w1", created_at: 5 } as any);
    expect(inv).not.toBeNull();
    expect(inv!.eventCoordinate).toBe(`${CALENDAR_KINDS.privateEvent}:author:abc12345`);
    expect(inv!.wrapId).toBe("w1");
  });

  it("returns null when the unwrapped rumor is not a calendar kind", async () => {
    (unwrapEvent as any).mockResolvedValue({ kind: 1, pubkey: "x", content: "{}" });
    expect(await extractInvitationFromWrap({ id: "w" } as any)).toBeNull();
  });
});
```

- [ ] **Step 3: Run both files — expect pass.**
      Run: `pnpm --filter @formstr/app exec vitest run src/services/calendar/service.test.ts src/services/calendar/rsvp.test.ts`

- [ ] **Step 4: Coverage check (reported, not gated yet)**
      Run: `pnpm --filter @formstr/app exec vitest run --coverage src/services/calendar/`
      Expected: `services/calendar/**` ≥ 80% lines. If short, add targeted tests for the uncovered branches.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/services/calendar/service.test.ts packages/app/src/services/calendar/rsvp.test.ts
git commit -m "test(calendar): service + rsvp coverage"
```

---

## Task 7: PR 1 verification + PR

- [ ] **Step 1: Full gate.**

```bash
pnpm --filter @formstr/app exec vitest run
pnpm --filter @formstr/app run typecheck
pnpm --filter @formstr/app exec eslint src
pnpm --filter @formstr/app run build
```

All must pass (eslint exit 0). Fix any warnings on touched files.

- [ ] **Step 2: Push + open PR**

```bash
git push -u upstream 'upstream-week5&6-pr1'
gh pr create --repo formstr-hq/super-app --base main --head 'upstream-week5&6-pr1' \
  --title "fix(calendar): unstub invitations + service hardening + tests" \
  --body "Service/store hardening for Calendar — see docs/superpowers/specs/2026-05-31-week-5-6-calendar-upstream-design.md (PR 1). No UI changes."
```

---

# PR 2 — `refactor(calendar): split CalendarPage + plug invitation flow`

> Branch off PR 1: `git checkout -b 'upstream-week5&6-pr2' 'upstream-week5&6-pr1'`. This is a **mechanical extraction** — move existing JSX out of `CalendarPage.tsx` (read it first: 833 LOC) into the components below, wiring the documented props. Each task: create component, move its JSX/logic from `CalendarPage`, write a focused render test, run, commit.

## Task 8: `EventCard`

**Files:** Create `packages/app/src/components/calendar/EventCard.tsx` + `EventCard.test.tsx`.

- [ ] **Step 1:** Extract the per-event chip/row JSX from `CalendarPage` into a presentational component with this contract:

```tsx
interface EventCardProps {
  event: CalendarEvent;
  compact?: boolean;
  onClick?: () => void;
}
export function EventCard({ event, compact, onClick }: EventCardProps) {
  /* moved JSX */
}
```

Show title + start time; render a lock icon (lucide `Lock`) when `event.isPrivate`; when `compact`, omit the description.

- [ ] **Step 2: Test** `EventCard.test.tsx`:

```tsx
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { EventCard } from "./EventCard";

const base = {
  id: "d",
  eventId: "e",
  title: "Launch",
  description: "details here",
  kind: 31923,
  begin: 1700000000000,
  end: 1700003600000,
  createdAt: 0,
  categories: [],
  participants: [],
  location: [],
  website: "",
  user: "p",
  isPrivate: false,
  repeat: { rrule: null },
} as any;

afterEach(() => cleanup());

describe("EventCard", () => {
  it("shows the title", () => {
    render(<EventCard event={base} />);
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });
  it("shows a lock icon for private events", () => {
    const { container } = render(<EventCard event={{ ...base, isPrivate: true }} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("hides description in compact mode", () => {
    render(<EventCard event={base} compact />);
    expect(screen.queryByText("details here")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3:** Run `pnpm --filter @formstr/app exec vitest run src/components/calendar/EventCard.test.tsx` → PASS. Typecheck. Commit `feat(calendar): extract EventCard`.

## Task 9: `CalendarMonthView`

**Files:** Create `CalendarMonthView.tsx` + test.

- [ ] **Step 1:** Extract the month-grid JSX. Contract:

```tsx
interface Props {
  events: CalendarEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}
```

Render a 6×7 grid of day cells for `selectedDate`'s month; place an `EventCard compact` chip on each day matching `event.begin`; clicking a day cell calls `onDateSelect`, clicking a chip calls `onEventClick`.

- [ ] **Step 2: Test** — renders 42 day cells; an event on the 15th appears in that cell; clicking a day calls `onDateSelect`:

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { CalendarMonthView } from "./CalendarMonthView";

afterEach(() => cleanup());
const may2026 = new Date(2026, 4, 15);

describe("CalendarMonthView", () => {
  it("renders a 6-week (42-cell) grid", () => {
    const { container } = render(
      <CalendarMonthView
        events={[]}
        selectedDate={may2026}
        onDateSelect={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-testid="day-cell"]').length).toBe(42);
  });
  it("calls onDateSelect when a day is clicked", () => {
    const onDateSelect = vi.fn();
    const { container } = render(
      <CalendarMonthView
        events={[]}
        selectedDate={may2026}
        onDateSelect={onDateSelect}
        onEventClick={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelectorAll('[data-testid="day-cell"]')[10]);
    expect(onDateSelect).toHaveBeenCalled();
  });
});
```

(Add `data-testid="day-cell"` to each day cell during extraction.)

- [ ] **Step 3:** Run → PASS. Typecheck. Commit `feat(calendar): extract CalendarMonthView`.

## Task 10: `CalendarListView`

**Files:** Create `CalendarListView.tsx` + test.

- [ ] **Step 1:** Extract the list-view JSX. Contract: `{ events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void }`. Sorted upcoming, grouped by day heading; empty-state text "No upcoming events" when `events=[]`.

- [ ] **Step 2: Test** — empty state; renders an event title; click calls `onEventClick`:

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { CalendarListView } from "./CalendarListView";

afterEach(() => cleanup());
const e = {
  id: "d",
  eventId: "e",
  title: "Demo",
  description: "",
  kind: 31923,
  begin: Date.now() + 86400000,
  end: Date.now() + 90000000,
  createdAt: 0,
  categories: [],
  participants: [],
  location: [],
  website: "",
  user: "p",
  isPrivate: false,
  repeat: { rrule: null },
} as any;

describe("CalendarListView", () => {
  it("shows empty state", () => {
    render(<CalendarListView events={[]} onEventClick={vi.fn()} />);
    expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument();
  });
  it("renders events and fires onEventClick", () => {
    const onEventClick = vi.fn();
    render(<CalendarListView events={[e]} onEventClick={onEventClick} />);
    fireEvent.click(screen.getByText("Demo"));
    expect(onEventClick).toHaveBeenCalledWith(e);
  });
});
```

- [ ] **Step 3:** Run → PASS. Typecheck. Commit `feat(calendar): extract CalendarListView`.

## Task 11: `CreateEventDialog`

**Files:** Create `CreateEventDialog.tsx` + test.

- [ ] **Step 1:** Extract the create-event form JSX. Contract:

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: CalendarEventDraft) => void;
  defaultDate?: Date;
  event?: CalendarEvent; // prefill for edit (sets existingId on submit)
}
```

Local state for title/description/begin/end/location/participants/private toggle/recurring (renders `RRuleBuilder`). On submit, build a `CalendarEventDraft` (set `existingId: event?.id` when editing) and call `onSubmit`.

- [ ] **Step 2: Test** — renders fields; submit calls `onSubmit` with a draft whose title matches; private toggle present:

```tsx
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { CreateEventDialog } from "./CreateEventDialog";

afterEach(() => cleanup());

describe("CreateEventDialog", () => {
  it("submits a draft with the typed title", async () => {
    const onSubmit = vi.fn();
    render(<CreateEventDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Sprint Review" } });
    fireEvent.click(screen.getByRole("button", { name: /create|save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Sprint Review" }));
    });
  });
});
```

(If `RRuleBuilder`/`TimezonePicker` reference lucide icons that break jsdom, mock `lucide-react` with a Proxy that guards `then`/`__esModule`/symbols — see the forms `FillPage.test.tsx` pattern.)

- [ ] **Step 3:** Run → PASS. Typecheck. Commit `feat(calendar): extract CreateEventDialog`.

## Task 12: `EventDetailsDialog`

**Files:** Create `EventDetailsDialog.tsx` + test.

- [ ] **Step 1:** Extract the details JSX. Contract:

```tsx
interface Props {
  open: boolean;
  event: CalendarEvent | null;
  currentUserPubkey: string | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  onRsvp: (status: "accepted" | "declined" | "tentative") => void;
}
```

When `event.user === currentUserPubkey`: show Edit + Delete. Otherwise: show Accept/Decline/Tentative buttons (call `onRsvp`).

- [ ] **Step 2: Test** — author sees Edit/Delete; invitee sees RSVP:

```tsx
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { EventDetailsDialog } from "./EventDetailsDialog";

afterEach(() => cleanup());
const e = {
  id: "d",
  eventId: "e",
  title: "Sync",
  description: "",
  kind: 31923,
  begin: 0,
  end: 0,
  createdAt: 0,
  categories: [],
  participants: [],
  location: [],
  website: "",
  user: "me",
  isPrivate: false,
  repeat: { rrule: null },
} as any;
const props = { open: true, onClose: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRsvp: vi.fn() };

describe("EventDetailsDialog", () => {
  it("shows Edit/Delete for the author", () => {
    render(<EventDetailsDialog {...props} event={e} currentUserPubkey="me" />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
  it("shows RSVP buttons for a non-author", () => {
    render(<EventDetailsDialog {...props} event={e} currentUserPubkey="someone-else" />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3:** Run → PASS. Typecheck. Commit `feat(calendar): extract EventDetailsDialog`.

## Task 13: Slim `CalendarPage` orchestrator + InvitationInbox

**Files:** Modify `packages/app/src/pages/CalendarPage.tsx`.

- [ ] **Step 1:** Replace the monolith body with an orchestrator that:
  - holds view mode (`"month" | "list"`), `selectedDate`, active dialog state, and selected event;
  - reads `events` from `useCalendarStore`, calls `fetchEvents` on mount;
  - renders a header (view toggle + "New event"), then `CalendarMonthView` or `CalendarListView`;
  - renders `CreateEventDialog` (onSubmit → `createEvent`/`updateEvent`), `EventDetailsDialog` (onRsvp → `rsvpToEvent` + `useInvitationsStore.markRsvp`, onDelete → `deleteEvent`, onEdit → open CreateEventDialog with `event`);
  - mounts `InvitationInbox` as a banner/side panel; show a pending count via `useInvitationsStore((s) => s.hasPending())`.
  - **Must be < 200 LOC.**

- [ ] **Step 2:** Verify `InvitationInbox.tsx` consumes the restored store (`invitations`, `markRsvp`, `dismiss`); adjust prop/store usage if it referenced the old stub shape.

- [ ] **Step 3:** Typecheck + manual sanity (`pnpm --filter @formstr/app run build`). Confirm `wc -l packages/app/src/pages/CalendarPage.tsx` < 200.

- [ ] **Step 4:** Commit `refactor(calendar): slim CalendarPage orchestrator + invitation banner`.

## Task 14: Enable the coverage gate

**Files:** Modify `packages/app/vitest.config.ts`.

- [ ] **Step 1:** In the `thresholds` object, add alongside the forms entry:

```ts
      thresholds: {
        "src/services/forms/**": { lines: 80 },
        "src/services/calendar/**": { lines: 80 },
      },
```

- [ ] **Step 2:** Run `pnpm --filter @formstr/app exec vitest run --coverage` → calendar gate passes. If under 80%, add targeted service/rsvp tests.

- [ ] **Step 3:** Commit `test(calendar): enforce 80% coverage gate on services/calendar`.

## Task 15: PR 2 verification + PR

- [ ] **Step 1:** `pnpm --filter @formstr/app exec vitest run` (all pass) · `run typecheck` (0) · `exec eslint src` (exit 0) · `run build` (green) · confirm no file in `pages/` > 200 LOC.
- [ ] **Step 2:** Push + PR:

```bash
git push -u upstream 'upstream-week5&6-pr2'
gh pr create --repo formstr-hq/super-app --base main --head 'upstream-week5&6-pr2' \
  --title "refactor(calendar): split CalendarPage + plug invitation flow" \
  --body "Calendar UI split + coverage gate — see docs/superpowers/specs/2026-05-31-week-5-6-calendar-upstream-design.md (PR 2)."
```

---

## Self-Review Notes

- **Spec coverage:** every PR-1 change (fetchByCoordinate T1, ingest/update T3, invitations restore T4, AppShell T5, tests T6) and PR-2 change (5 component extractions T8-12, slim page T13, gate T14) maps to a task. The spec's "Gap 3 hex dedup" is intentionally omitted — verified the calendar service has no local hex helpers.
- **Discovered gap (added):** the publish functions ignore `draft.existingId`; Task 2 patches them so `updateEvent` truly replaces.
- **Type consistency:** `ingestEvent`/`updateEvent` signatures match the store interface; `InvitationEntry`/`InvitationRumor` fields (`eventCoordinate`, `wrapId`) match `rsvp.ts`; `CALENDAR_KINDS` names match `types.ts`.
- **No new deps.** All commits GPG-signed.
