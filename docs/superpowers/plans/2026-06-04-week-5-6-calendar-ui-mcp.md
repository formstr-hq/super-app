# Calendar UI + MCP Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the super-app Calendar module — finish the UI (split the 833-LOC monolith, add edit/RSVP/attendees/invitations/recurrence/timezone), fix the delete-persistence bug, and bring the MCP server to full parity with the calendar service.

**Architecture:** The calendar service + Zustand stores already exist (merged PR #10). This cycle (1) makes recurrence/timezone/form-attachment round-trip through publish+parse, fixes deletion to use the NIP-09 `a` coordinate, and adds a stateless `fetchInvitationsSync` helper; (2) expands `packages/mcp/src/tools/calendar.ts` to wrap the full service; (3) decomposes `pages/CalendarPage.tsx` into presentational components under `components/calendar/` with a thin orchestrator that mounts the existing `InvitationInbox`.

**Tech Stack:** React 18 + TypeScript, MUI v7, Zustand, `nostr-tools`, `rrule`, Vitest + @testing-library/react (jsdom), `@modelcontextprotocol/sdk` + `zod` (MCP), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-04-week-5-6-calendar-ui-mcp-design.md`

**Branch:** `upstream-week5&6-pr2` (already created).

---

## Conventions for every task

- Run app-package tests with: `pnpm --filter @formstr/app exec vitest run <pattern>`
- Run MCP-package tests with: `pnpm --filter @formstr/mcp exec vitest run <pattern>`
- Commit messages follow the repo style (`feat(calendar):`, `fix(calendar):`, `test(calendar):`, `feat(mcp):`). **Do not** add any AI co-author trailer.
- After each task: the new/changed test passes AND `pnpm --filter @formstr/app typecheck` is clean (run typecheck for tasks touching `packages/app`; `pnpm --filter @formstr/mcp typecheck` for MCP tasks).

---

## File Structure

**Modify (service/store):**

- `packages/app/src/services/calendar/service.ts` — round-trip rrule/tzid/form; fix delete kind; add `fetchInvitationsSync`
- `packages/app/src/services/calendar/service.test.ts` — new cases
- `packages/app/src/stores/calendarStore.ts` — `deleteEvent` filters by `id`
- `packages/app/src/stores/calendarStore.test.ts` — delete case
- `packages/app/vitest.config.ts` — enable `services/calendar/**` coverage gate

**Modify (MCP):**

- `packages/mcp/src/tools/calendar.ts` — full tool surface
- `packages/mcp/src/safety.ts` — gate new write tools
- `packages/mcp/test/calendar.test.ts` — new cases

**Create (UI components, all under `packages/app/src/components/calendar/`):**

- `EventCard.tsx` + `EventCard.test.tsx`
- `CalendarMonthView.tsx` + `CalendarMonthView.test.tsx`
- `CalendarListView.tsx` + `CalendarListView.test.tsx`
- `CalendarSidebar.tsx`
- `CreateCalendarDialog.tsx`
- `EventDialog.tsx` + `EventDialog.test.tsx`
- `EventDetailsDialog.tsx` + `EventDetailsDialog.test.tsx`
- `InvitationInbox.test.tsx` (component already exists)

**Rewrite:**

- `packages/app/src/pages/CalendarPage.tsx` — thin orchestrator (< 200 LOC)

---

## Phase 1 — Service & store

### Task 1: Round-trip rrule / start_tzid / registration form on public events

Today `publishPublicCalendarEvent` ignores `draft.rrule`/`startTzid`/`registrationFormRef`, and `parseCalendarEvent` hardcodes `repeat: { rrule: null }`. Make them persist (upstream-compatible tags: rrule as a NIP-32 label pair `["L","rrule"]` + `["l", body, "rrule"]`; `["start_tzid", tz]`; `["form", ref]`).

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `service.test.ts` (after the existing `publishPublicCalendarEvent — tags` block):

```ts
describe("publishPublicCalendarEvent — recurrence/tz/form round-trip", () => {
  it("emits rrule label-pair, start_tzid and form tags", async () => {
    await publishPublicCalendarEvent({
      title: "Repeat",
      description: "",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      startTzid: "America/New_York",
      registrationFormRef: "naddr1abc",
    });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags).toContainEqual(["L", "rrule"]);
    expect(e.tags).toContainEqual(["l", "FREQ=WEEKLY;BYDAY=MO", "rrule"]);
    expect(e.tags).toContainEqual(["start_tzid", "America/New_York"]);
    expect(e.tags).toContainEqual(["form", "naddr1abc"]);
  });
});

describe("parseCalendarEvent (via fetchCalendarEventByCoordinate) — reads recurrence/tz/form", () => {
  it("recovers rrule, startTzid and registrationFormRef from tags", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "eid",
        pubkey: "p",
        kind: CALENDAR_KINDS.publicEvent,
        created_at: 1000,
        sig: "sig",
        content: "",
        tags: [
          ["d", "abc12345"],
          ["title", "R"],
          ["start", "1700000000"],
          ["end", "1700003600"],
          ["L", "rrule"],
          ["l", "FREQ=DAILY", "rrule"],
          ["start_tzid", "Europe/Paris"],
          ["form", "naddr1xyz"],
        ],
      } satisfies Event,
    ]);
    const ev = await fetchCalendarEventByCoordinate("31923:p:abc12345");
    expect(ev!.repeat.rrule).toBe("FREQ=DAILY");
    expect(ev!.startTzid).toBe("Europe/Paris");
    expect(ev!.registrationFormRef).toBe("naddr1xyz");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: FAIL — the new tags are not emitted/parsed.

- [ ] **Step 3: Emit the tags in `publishPublicCalendarEvent`**

In `service.ts`, inside `publishPublicCalendarEvent`, after the existing `for (const p of draft.participants ?? []) tags.push(["p", p]);` line, add:

```ts
if (draft.startTzid) tags.push(["start_tzid", draft.startTzid]);
if (draft.endTzid) tags.push(["end_tzid", draft.endTzid]);
if (draft.rrule) {
  tags.push(["L", "rrule"]);
  tags.push(["l", draft.rrule, "rrule"]);
}
if (draft.registrationFormRef) tags.push(["form", draft.registrationFormRef]);
```

And update the returned object's `repeat`/tz/form fields (replace the existing `repeat: { rrule: null },` line in the public-event return):

```ts
    repeat: { rrule: draft.rrule ?? null },
    startTzid: draft.startTzid,
    endTzid: draft.endTzid,
    registrationFormRef: draft.registrationFormRef,
```

- [ ] **Step 4: Read the tags in `parseCalendarEvent`**

In `parseCalendarEvent`, after the existing `const website = ...` line, add:

```ts
const rrule =
  tags.find((t) => t[0] === "l" && t[2] === "rrule")?.[1] ??
  tags.find((t) => t[0] === "rrule")?.[1] ??
  null;
const startTzid = tags.find((t) => t[0] === "start_tzid")?.[1];
const endTzid = tags.find((t) => t[0] === "end_tzid")?.[1];
const registrationFormRef = tags.find((t) => t[0] === "form")?.[1];
```

Then in the returned object, replace `repeat: { rrule: null },` with:

```ts
    repeat: { rrule },
    startTzid,
    endTzid,
    registrationFormRef,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/services/calendar/service.ts packages/app/src/services/calendar/service.test.ts
git commit -m "feat(calendar): round-trip rrule/start_tzid/registration form on public events"
```

---

### Task 2: Round-trip recurrence/tz/form on private events

`publishPrivateCalendarEvent` builds an encrypted `eventData` tag array; add the same fields there so private events keep recurrence/tz/form after decryption (`parseCalendarEvent` already merges decrypted tags).

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `service.test.ts`:

```ts
describe("publishPrivateCalendarEvent — recurrence/tz/form in encrypted payload", () => {
  it("includes rrule/tzid/form rows in the data passed to nip44SelfEncrypt", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap", kind: CALENDAR_KINDS.giftWrap });
    await publishPrivateCalendarEvent(
      {
        title: "SecretRepeat",
        description: "",
        begin: new Date(1700000000000),
        end: new Date(1700003600000),
        isPrivate: true,
        rrule: "FREQ=WEEKLY",
        startTzid: "Asia/Tokyo",
        registrationFormRef: "naddr1priv",
      },
      "default",
    );
    const encryptedArg = (nip44SelfEncrypt as any).mock.calls[0][1];
    const rows = JSON.parse(encryptedArg) as string[][];
    expect(rows).toContainEqual(["L", "rrule"]);
    expect(rows).toContainEqual(["l", "FREQ=WEEKLY", "rrule"]);
    expect(rows).toContainEqual(["start_tzid", "Asia/Tokyo"]);
    expect(rows).toContainEqual(["form", "naddr1priv"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: FAIL — rows missing.

- [ ] **Step 3: Add the rows in `publishPrivateCalendarEvent`**

In `service.ts`, inside `publishPrivateCalendarEvent`, after `for (const p of draft.participants ?? []) eventData.push(["p", p]);`, add:

```ts
if (draft.startTzid) eventData.push(["start_tzid", draft.startTzid]);
if (draft.endTzid) eventData.push(["end_tzid", draft.endTzid]);
if (draft.rrule) {
  eventData.push(["L", "rrule"]);
  eventData.push(["l", draft.rrule, "rrule"]);
}
if (draft.registrationFormRef) eventData.push(["form", draft.registrationFormRef]);
```

And update the private-event return object: replace `repeat: { rrule: null },` with:

```ts
    repeat: { rrule: draft.rrule ?? null },
    startTzid: draft.startTzid,
    endTzid: draft.endTzid,
    registrationFormRef: draft.registrationFormRef,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/services/calendar/service.ts packages/app/src/services/calendar/service.test.ts
git commit -m "feat(calendar): round-trip rrule/tzid/form on private events"
```

---

### Task 3: Fix `deleteCalendarEvent` to derive the kind from the coordinate

The delete event hardcodes `["k", String(CALENDAR_KINDS.publicEvent)]`, so private events (kind 32678) are never deleted, and an 8-char d-tag must never be emitted as an `["e", …]` tag.

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Update the existing delete test + add a private case**

Replace the existing `describe("deleteCalendarEvent", …)` block in `service.test.ts` with:

```ts
describe("deleteCalendarEvent", () => {
  it("publishes kind-5 with the a-tag coordinate and matching k-tag", async () => {
    await deleteCalendarEvent("e1", "31923:p:d1");
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(5);
    expect(e.tags).toContainEqual(["a", "31923:p:d1"]);
    expect(e.tags).toContainEqual(["k", "31923"]);
  });

  it("derives the k-tag for private events from the coordinate kind", async () => {
    await deleteCalendarEvent("d2", "32678:p:d2");
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags).toContainEqual(["k", "32678"]);
    expect(e.tags).toContainEqual(["a", "32678:p:d2"]);
    // d-tag id "d2" is not a 64-hex nostr id → no e-tag
    expect(e.tags.find((t: string[]) => t[0] === "e")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: FAIL — `k` is `31923` for the private case.

- [ ] **Step 3: Rewrite `deleteCalendarEvent`**

Replace the whole `deleteCalendarEvent` function in `service.ts` with:

```ts
export async function deleteCalendarEvent(eventId: string, coordinate?: string): Promise<void> {
  const signer = await signerManager.getSigner();

  const kindFromCoord = coordinate ? Number(coordinate.split(":")[0]) : NaN;
  const kind =
    Number.isFinite(kindFromCoord) && kindFromCoord ? kindFromCoord : CALENDAR_KINDS.publicEvent;

  const tags: string[][] = [["k", String(kind)]];
  if (coordinate) tags.push(["a", coordinate]);
  if (eventId && /^[0-9a-f]{64}$/i.test(eventId)) tags.push(["e", eventId]);

  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "Deleted via Formstr",
  };

  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/services/calendar/service.ts packages/app/src/services/calendar/service.test.ts
git commit -m "fix(calendar): delete uses coordinate-derived kind + a-tag (NIP-09 addressable)"
```

---

### Task 4: `calendarStore.deleteEvent` filters local state by `id`

The UI will call `deleteEvent(event.id, coordinate)` (the d-tag). Local removal must match by `id`, not `eventId`.

**Files:**

- Modify: `packages/app/src/stores/calendarStore.ts`
- Test: `packages/app/src/stores/calendarStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `calendarStore.test.ts`:

```ts
describe("deleteEvent", () => {
  it("removes the event by id and forwards the coordinate to the service", async () => {
    useCalendarStore.setState({ events: [evt({ id: "d1" }), evt({ id: "d2", eventId: "e2" })] });
    await useCalendarStore.getState().deleteEvent("d1", "31923:pub:d1");
    expect(calendarService.deleteCalendarEvent).toHaveBeenCalledWith("d1", "31923:pub:d1");
    const ids = useCalendarStore.getState().events.map((e) => e.id);
    expect(ids).toEqual(["d2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run stores/calendarStore`
Expected: FAIL — current filter is by `eventId`, so `d1` is not removed.

- [ ] **Step 3: Update the store**

In `calendarStore.ts`, replace the `deleteEvent` implementation with:

```ts
  async deleteEvent(id, coordinate) {
    try {
      await calendarService.deleteCalendarEvent(id, coordinate);
      set((state) => ({ events: state.events.filter((e) => e.id !== id) }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete event" });
    }
  },
```

And update the interface line `deleteEvent(eventId: string, coordinate?: string): Promise<void>;` to:

```ts
  deleteEvent(id: string, coordinate?: string): Promise<void>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run stores/calendarStore`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/stores/calendarStore.ts packages/app/src/stores/calendarStore.test.ts
git commit -m "fix(calendar): store deleteEvent removes by d-tag id"
```

> Note: `pages/CalendarPage.tsx` still calls `deleteEvent(evt.eventId)` and will not typecheck-fail (string arg) but is semantically wrong; it is fully rewritten in Task 18.

---

### Task 5: Add `fetchInvitationsSync` service helper

A stateless query of received gift-wraps, for the MCP `list_invitations` tool.

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `service.test.ts` (note: `unwrapEvent` is already in the `@formstr/core` mock):

```ts
import { unwrapEvent } from "@formstr/core";
import { fetchInvitationsSync } from "./service";

describe("fetchInvitationsSync", () => {
  it("unwraps gift-wraps, resolves the referenced event, and dedupes by wrapId", async () => {
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([
        {
          id: "w1",
          pubkey: "sender",
          kind: CALENDAR_KINDS.giftWrap,
          created_at: 5,
          sig: "s",
          content: "x",
          tags: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "eid",
          pubkey: "author",
          kind: CALENDAR_KINDS.privateEvent,
          created_at: 5,
          sig: "s",
          content: "",
          tags: [
            ["d", "abc12345"],
            ["title", "Invited Event"],
            ["start", "1700000000"],
            ["end", "1700003600"],
          ],
        },
      ]);
    (unwrapEvent as any).mockResolvedValue({
      kind: CALENDAR_KINDS.rumor,
      pubkey: "author",
      content: JSON.stringify({ eventId: "abc12345" }),
    });

    const invites = await fetchInvitationsSync();
    expect(invites).toHaveLength(1);
    expect(invites[0].eventCoordinate).toBe("32678:author:abc12345");
    expect(invites[0].event?.title).toBe("Invited Event");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: FAIL — `fetchInvitationsSync` is not exported.

- [ ] **Step 3: Implement the helper**

At the top of `service.ts`, extend the import from `./types` is unchanged; add a new import from `./rsvp`:

```ts
import { extractInvitationFromWrap, type InvitationRumor } from "./rsvp";
```

Then add near the end of `service.ts` (after `fetchCalendarEventByCoordinate`):

```ts
export interface InvitationWithEvent extends InvitationRumor {
  event?: CalendarEvent;
}

/**
 * Stateless fetch of NIP-59 calendar invitations addressed to the current user.
 * Mirrors the live `invitationsStore` subscription but as a one-shot query so
 * non-UI callers (e.g. the MCP server) can list invitations.
 */
export async function fetchInvitationsSync(): Promise<InvitationWithEvent[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("calendar");

  const wraps = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.giftWrap, CALENDAR_KINDS.rsvpGiftWrap],
    "#p": [pubkey],
  } as Filter);

  const seen = new Set<string>();
  const out: InvitationWithEvent[] = [];
  for (const wrap of wraps) {
    if (seen.has(wrap.id)) continue;
    seen.add(wrap.id);
    const invitation = await extractInvitationFromWrap(wrap);
    if (!invitation) continue;
    const event = await fetchCalendarEventByCoordinate(invitation.eventCoordinate);
    out.push({ ...invitation, event: event ?? undefined });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run services/calendar/service`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/services/calendar/service.ts packages/app/src/services/calendar/service.test.ts
git commit -m "feat(calendar): fetchInvitationsSync — stateless invitation query"
```

---

## Phase 2 — MCP parity

> All MCP tasks edit `packages/mcp/src/tools/calendar.ts`. First extend the test mock so the new service functions exist. At the top of `packages/mcp/test/calendar.test.ts`, replace the `vi.mock("@formstr/app/services", …)` block with:
>
> ```ts
> vi.mock("@formstr/app/services", () => ({
>   calendar: {
>     fetchCalendarEventsSync: vi.fn(),
>     fetchCalendarEventByCoordinate: vi.fn(),
>     publishPublicCalendarEvent: vi.fn(),
>     publishPrivateCalendarEvent: vi.fn(),
>     deleteCalendarEvent: vi.fn(),
>     fetchCalendarLists: vi.fn(),
>     createCalendarList: vi.fn(),
>     fetchInvitationsSync: vi.fn(),
>   },
>   calendarRsvp: {
>     rsvpToEvent: vi.fn(),
>     fetchRsvpsForEvent: vi.fn(),
>   },
> }));
> ```
>
> Do this as part of Task 6, Step 1.

### Task 6: Extend `create_calendar_event` + add `get_calendar_event`

**Files:**

- Modify: `packages/mcp/src/tools/calendar.ts`
- Test: `packages/mcp/test/calendar.test.ts`

- [ ] **Step 1: Update the mock (above) and write failing tests**

Apply the mock replacement above, then add:

```ts
it("create_calendar_event routes to private publish when isPrivate", async () => {
  (calendar.publishPrivateCalendarEvent as any).mockResolvedValue({
    id: "d9",
    eventId: "ev9",
    kind: 32678,
    user: "pk",
  });
  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: false });
  await tools.get("create_calendar_event")!.handler({
    title: "Secret",
    start: "2026-06-10T10:00:00Z",
    isPrivate: true,
    participants: ["pubA"],
  });
  expect(calendar.publishPrivateCalendarEvent).toHaveBeenCalledOnce();
});

it("get_calendar_event returns the event or NOT_FOUND", async () => {
  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: false });
  (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValueOnce(null);
  const miss = await tools.get("get_calendar_event")!.handler({ coordinate: "31923:p:d" });
  expect(miss.isError).toBe(true);
  (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValueOnce({
    id: "d",
    title: "Found",
    kind: 31923,
    user: "p",
  });
  const hit = await tools.get("get_calendar_event")!.handler({ coordinate: "31923:p:d" });
  expect(hit.isError).toBeFalsy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: FAIL — `get_calendar_event` missing; private path not wired.

- [ ] **Step 3: Update imports + extend create + add get**

In `calendar.ts`, change the import line `import { ok } from "../result";` to:

```ts
import { ok, fail } from "../result";
```

Replace the entire `create_calendar_event` `server.registerTool(...)` call with:

```ts
server.registerTool(
  "create_calendar_event",
  {
    description:
      "Schedule a calendar event. start/end are ISO 8601. Set isPrivate:true for an encrypted event; participants receive NIP-59 invitations.",
    inputSchema: {
      title: z.string(),
      description: z.string().optional(),
      start: z.string(),
      end: z.string().optional(),
      location: z.string().optional(),
      isPrivate: z.boolean().optional(),
      participants: z.array(z.string()).optional(),
      rrule: z.string().optional(),
      startTzid: z.string().optional(),
      registrationFormRef: z.string().optional(),
    },
  },
  async (args) => {
    const begin = new Date(args.start);
    const end = args.end ? new Date(args.end) : new Date(begin.getTime() + 3_600_000);
    const draft = {
      title: args.title,
      description: args.description ?? "",
      begin,
      end,
      location: args.location,
      participants: args.participants,
      isPrivate: Boolean(args.isPrivate),
      rrule: args.rrule,
      startTzid: args.startTzid,
      registrationFormRef: args.registrationFormRef,
    };
    const event = args.isPrivate
      ? await calendar.publishPrivateCalendarEvent(draft, "default")
      : await calendar.publishPublicCalendarEvent(draft);
    const coordinate = `${event.kind}:${event.user}:${event.id}`;
    return ok(`Created ${args.isPrivate ? "private" : "public"} event "${args.title}".`, {
      id: event.id,
      eventId: event.eventId,
      coordinate,
    });
  },
);

server.registerTool(
  "get_calendar_event",
  {
    description: "Fetch a single calendar event by its addressable coordinate kind:pubkey:d.",
    inputSchema: { coordinate: z.string() },
  },
  async ({ coordinate }) => {
    const event = await calendar.fetchCalendarEventByCoordinate(coordinate);
    if (!event) return fail(`No event found for ${coordinate}.`, "NOT_FOUND");
    return ok(`Event "${event.title}".`, {
      event: {
        id: event.id,
        title: event.title,
        begin: event.begin,
        end: event.end,
        location: event.location,
        isPrivate: event.isPrivate,
        rrule: event.repeat.rrule,
        participants: event.participants,
      },
    });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/mcp typecheck
git add packages/mcp/src/tools/calendar.ts packages/mcp/test/calendar.test.ts
git commit -m "feat(mcp): private/recurring create + get_calendar_event"
```

---

### Task 7: `update_calendar_event` + `attach_form_to_event` (gated writes)

**Files:**

- Modify: `packages/mcp/src/tools/calendar.ts`, `packages/mcp/src/safety.ts`
- Test: `packages/mcp/test/calendar.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `calendar.test.ts`:

```ts
it("update_calendar_event is gated and requires confirm, then republishes", async () => {
  const ro = fakeServer();
  registerCalendar(ro.server, { allowWrites: false });
  expect(ro.tools.has("update_calendar_event")).toBe(false);
  expect(ro.tools.has("attach_form_to_event")).toBe(false);

  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: true });
  (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
    id: "d",
    title: "Old",
    description: "",
    begin: 1700000000000,
    end: 1700003600000,
    kind: 31923,
    user: "pk",
    location: [],
    participants: [],
    isPrivate: false,
    repeat: { rrule: null },
  });
  (calendar.publishPublicCalendarEvent as any).mockResolvedValue({
    id: "d",
    eventId: "ev",
    kind: 31923,
    user: "pk",
    title: "New",
  });

  const blocked = await tools
    .get("update_calendar_event")!
    .handler({ coordinate: "31923:pk:d", title: "New" });
  expect(blocked.isError).toBe(true);
  const okRes = await tools
    .get("update_calendar_event")!
    .handler({ coordinate: "31923:pk:d", title: "New", confirm: true });
  expect(calendar.publishPublicCalendarEvent).toHaveBeenCalledWith(
    expect.objectContaining({ existingId: "d", title: "New" }),
  );
  expect(okRes.isError).toBeFalsy();
});

it("attach_form_to_event republishes with the form ref", async () => {
  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: true });
  (calendar.fetchCalendarEventByCoordinate as any).mockResolvedValue({
    id: "d",
    title: "T",
    description: "",
    begin: 1,
    end: 2,
    kind: 31923,
    user: "pk",
    location: [],
    participants: [],
    isPrivate: false,
    repeat: { rrule: null },
  });
  (calendar.publishPublicCalendarEvent as any).mockResolvedValue({
    id: "d",
    eventId: "ev",
    kind: 31923,
    user: "pk",
    title: "T",
  });
  await tools
    .get("attach_form_to_event")!
    .handler({ coordinate: "31923:pk:d", formRef: "naddr1abc", confirm: true });
  expect(calendar.publishPublicCalendarEvent).toHaveBeenCalledWith(
    expect.objectContaining({ registrationFormRef: "naddr1abc", existingId: "d" }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: FAIL — tools not registered.

- [ ] **Step 3: Add the tools (in the write-gated section)**

In `calendar.ts`, after the existing `rsvp_event` `server.registerTool(...)` (still inside the `if (ctx.allowWrites)` region, i.e. before the closing `}` of `registerCalendar`), add:

```ts
server.registerTool(
  "update_calendar_event",
  {
    description:
      "Update a calendar event by its coordinate kind:pubkey:d. Only changed fields need be sent. Requires confirm:true.",
    inputSchema: {
      coordinate: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      location: z.string().optional(),
      rrule: z.string().optional(),
      startTzid: z.string().optional(),
      confirm: z.boolean().optional(),
    },
  },
  async (args) => {
    const blocked = requireConfirm(
      "update_calendar_event",
      { confirm: args.confirm },
      `updates event ${args.coordinate}`,
    );
    if (blocked) return blocked;
    const existing = await calendar.fetchCalendarEventByCoordinate(args.coordinate);
    if (!existing) return fail(`No event found for ${args.coordinate}.`, "NOT_FOUND");
    const draft = {
      title: args.title ?? existing.title,
      description: args.description ?? existing.description,
      begin: args.start ? new Date(args.start) : new Date(existing.begin),
      end: args.end ? new Date(args.end) : new Date(existing.end),
      location: args.location ?? existing.location[0],
      participants: existing.participants,
      isPrivate: existing.isPrivate,
      rrule: args.rrule ?? existing.repeat.rrule ?? undefined,
      startTzid: args.startTzid ?? existing.startTzid,
      registrationFormRef: existing.registrationFormRef,
      existingId: existing.id,
    };
    const event = existing.isPrivate
      ? await calendar.publishPrivateCalendarEvent(draft, existing.calendarId ?? "default")
      : await calendar.publishPublicCalendarEvent(draft);
    return ok(`Updated event "${event.title}".`, {
      id: event.id,
      coordinate: `${event.kind}:${event.user}:${event.id}`,
    });
  },
);

server.registerTool(
  "attach_form_to_event",
  {
    description:
      "Attach a Formstr form (naddr or coordinate) as an event's registration form. Requires confirm:true.",
    inputSchema: {
      coordinate: z.string(),
      formRef: z.string(),
      confirm: z.boolean().optional(),
    },
  },
  async ({ coordinate, formRef, confirm }) => {
    const blocked = requireConfirm(
      "attach_form_to_event",
      { confirm },
      `attaches a form to ${coordinate}`,
    );
    if (blocked) return blocked;
    const existing = await calendar.fetchCalendarEventByCoordinate(coordinate);
    if (!existing) return fail(`No event found for ${coordinate}.`, "NOT_FOUND");
    const draft = {
      title: existing.title,
      description: existing.description,
      begin: new Date(existing.begin),
      end: new Date(existing.end),
      location: existing.location[0],
      participants: existing.participants,
      isPrivate: existing.isPrivate,
      rrule: existing.repeat.rrule ?? undefined,
      startTzid: existing.startTzid,
      registrationFormRef: formRef,
      existingId: existing.id,
    };
    const event = existing.isPrivate
      ? await calendar.publishPrivateCalendarEvent(draft, existing.calendarId ?? "default")
      : await calendar.publishPublicCalendarEvent(draft);
    return ok(`Attached form to "${event.title}".`, {
      coordinate: `${event.kind}:${event.user}:${event.id}`,
    });
  },
);
```

- [ ] **Step 4: Add to GATED_TOOLS**

In `packages/mcp/src/safety.ts`, extend `GATED_TOOLS`:

```ts
export const GATED_TOOLS = [
  "delete_form",
  "delete_calendar_event",
  "update_calendar_event",
  "attach_form_to_event",
  "submit_form_response",
  "submit_poll_response",
  "rsvp_event",
] as const;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @formstr/mcp typecheck
git add packages/mcp/src/tools/calendar.ts packages/mcp/src/safety.ts packages/mcp/test/calendar.test.ts
git commit -m "feat(mcp): update_calendar_event + attach_form_to_event (gated)"
```

---

### Task 8: `list_calendars` + `create_calendar`

**Files:**

- Modify: `packages/mcp/src/tools/calendar.ts`
- Test: `packages/mcp/test/calendar.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("list_calendars and create_calendar are available without writes", async () => {
  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: false });
  (calendar.fetchCalendarLists as any).mockResolvedValue([
    { id: "c1", title: "Work", color: "#fff" },
  ]);
  const list = await tools.get("list_calendars")!.handler({});
  expect(list.structuredContent.calendars).toHaveLength(1);

  (calendar.createCalendarList as any).mockResolvedValue({ id: "c2" });
  const created = await tools.get("create_calendar")!.handler({ title: "Personal" });
  expect(calendar.createCalendarList).toHaveBeenCalledWith("Personal", "#334155", "");
  expect(created.isError).toBeFalsy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: FAIL — tools missing.

- [ ] **Step 3: Add the tools (read/create section, before `if (!ctx.allowWrites) return;`)**

In `calendar.ts`, immediately after the `get_calendar_event` tool (added in Task 6) and before the `// Read tools and constructive creates …` comment, add:

```ts
server.registerTool(
  "list_calendars",
  { description: "List the user's calendar lists.", inputSchema: {} },
  async () => {
    const lists = await calendar.fetchCalendarLists();
    return ok(`Found ${lists.length} calendar(s).`, {
      calendars: lists.map((c) => ({ id: c.id, title: c.title, color: c.color })),
    });
  },
);

server.registerTool(
  "create_calendar",
  {
    description: "Create a calendar list with a title and optional hex color.",
    inputSchema: {
      title: z.string(),
      color: z.string().optional(),
      description: z.string().optional(),
    },
  },
  async ({ title, color, description }) => {
    const list = await calendar.createCalendarList(title, color ?? "#334155", description ?? "");
    return ok(`Created calendar "${title}".`, { id: list.id });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/mcp typecheck
git add packages/mcp/src/tools/calendar.ts packages/mcp/test/calendar.test.ts
git commit -m "feat(mcp): list_calendars + create_calendar"
```

---

### Task 9: `fetch_event_rsvps` + `list_invitations`

**Files:**

- Modify: `packages/mcp/src/tools/calendar.ts`
- Test: `packages/mcp/test/calendar.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("fetch_event_rsvps returns public RSVPs", async () => {
  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: false });
  (calendarRsvp.fetchRsvpsForEvent as any).mockResolvedValue([
    { pubkey: "p1", status: "accepted" },
  ]);
  const res = await tools.get("fetch_event_rsvps")!.handler({ coordinate: "31923:p:d" });
  expect(res.structuredContent.rsvps).toEqual([{ pubkey: "p1", status: "accepted" }]);
});

it("list_invitations summarizes received invitations", async () => {
  const { server, tools } = fakeServer();
  registerCalendar(server, { allowWrites: false });
  (calendar.fetchInvitationsSync as any).mockResolvedValue([
    {
      wrapId: "w1",
      eventCoordinate: "32678:a:d",
      authorPubkey: "a",
      kind: 32678,
      receivedAt: 0,
      event: { title: "P", begin: 123 },
    },
  ]);
  const res = await tools.get("list_invitations")!.handler({});
  expect(res.structuredContent.invitations[0]).toMatchObject({
    coordinate: "32678:a:d",
    title: "P",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: FAIL — tools missing.

- [ ] **Step 3: Add the tools (read section)**

In `calendar.ts`, after `create_calendar`, add:

```ts
server.registerTool(
  "fetch_event_rsvps",
  {
    description: "List public RSVPs for an event coordinate kind:pubkey:d.",
    inputSchema: { coordinate: z.string() },
  },
  async ({ coordinate }) => {
    const rsvps = await calendarRsvp.fetchRsvpsForEvent(coordinate);
    return ok(`Found ${rsvps.length} RSVP(s).`, {
      rsvps: rsvps.map((r) => ({ pubkey: r.pubkey, status: r.status })),
    });
  },
);

server.registerTool(
  "list_invitations",
  {
    description: "List calendar invitations received via NIP-59 gift-wrap.",
    inputSchema: {},
  },
  async () => {
    const invitations = await calendar.fetchInvitationsSync();
    return ok(`Found ${invitations.length} invitation(s).`, {
      invitations: invitations.map((i) => ({
        coordinate: i.eventCoordinate,
        title: i.event?.title ?? null,
        begin: i.event?.begin ?? null,
      })),
    });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @formstr/mcp exec vitest run calendar`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @formstr/mcp typecheck
git add packages/mcp/src/tools/calendar.ts packages/mcp/test/calendar.test.ts
git commit -m "feat(mcp): fetch_event_rsvps + list_invitations"
```

---

## Phase 3 — UI components

> Shared test fixture used by several component tests below:
>
> ```ts
> function evt(over: Partial<import("../../services/calendar").CalendarEvent> = {}) {
>   return {
>     id: "d1",
>     eventId: "e1",
>     title: "Standup",
>     description: "",
>     kind: 31923,
>     begin: new Date(2026, 5, 10, 9, 0).getTime(),
>     end: new Date(2026, 5, 10, 10, 0).getTime(),
>     createdAt: 0,
>     categories: [],
>     participants: [],
>     location: [],
>     website: "",
>     user: "me",
>     isPrivate: false,
>     repeat: { rrule: null },
>     ...over,
>   } as import("../../services/calendar").CalendarEvent;
> }
> ```

### Task 10: `EventCard` component

A presentational upcoming-event row, reused by the list view.

**Files:**

- Create: `packages/app/src/components/calendar/EventCard.tsx`
- Test: `packages/app/src/components/calendar/EventCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { EventCard } from "./EventCard";

function evt(over = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "Standup",
    description: "",
    kind: 31923,
    begin: new Date(2026, 5, 10, 9, 0).getTime(),
    end: new Date(2026, 5, 10, 10, 0).getTime(),
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as any;
}

afterEach(() => cleanup());

describe("EventCard", () => {
  it("shows the title and fires onClick", () => {
    const onClick = vi.fn();
    render(<EventCard event={evt()} onClick={onClick} />);
    fireEvent.click(screen.getByText("Standup"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows a lock for private events", () => {
    render(<EventCard event={evt({ isPrivate: true })} onClick={vi.fn()} />);
    expect(screen.getByLabelText(/private/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/EventCard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EventCard.tsx`**

```tsx
import { Paper, Typography } from "@mui/material";
import { Lock } from "lucide-react";

import type { CalendarEvent } from "../../services/calendar";

interface EventCardProps {
  event: CalendarEvent;
  onClick: () => void;
}

export function EventCard({ event, onClick }: EventCardProps) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {event.isPrivate && <Lock size={12} aria-label="private" />}
      <Typography variant="body2" fontWeight={500} sx={{ flex: 1, minWidth: 0 }} noWrap>
        {event.title}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {new Date(event.begin).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Typography>
    </Paper>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/EventCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/calendar/EventCard.tsx packages/app/src/components/calendar/EventCard.test.tsx
git commit -m "feat(calendar): EventCard component"
```

---

### Task 11: `CalendarMonthView` component

Extracts the month grid; expands recurring events for the visible month via `expandEvents`.

**Files:**

- Create: `packages/app/src/components/calendar/CalendarMonthView.tsx`
- Test: `packages/app/src/components/calendar/CalendarMonthView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CalendarMonthView } from "./CalendarMonthView";

function evt(over = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "Demo",
    description: "",
    kind: 31923,
    begin: new Date(2026, 5, 10, 9, 0).getTime(),
    end: new Date(2026, 5, 10, 10, 0).getTime(),
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as any;
}

afterEach(() => cleanup());

describe("CalendarMonthView", () => {
  it("renders an event chip and fires onEventClick", () => {
    const onEventClick = vi.fn();
    render(
      <CalendarMonthView
        events={[evt()]}
        year={2026}
        month={5}
        calendars={[]}
        onEventClick={onEventClick}
        onDeleteEvent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Demo"));
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ title: "Demo" }));
  });

  it("renders weekday headers", () => {
    render(
      <CalendarMonthView
        events={[]}
        year={2026}
        month={5}
        calendars={[]}
        onEventClick={vi.fn()}
        onDeleteEvent={vi.fn()}
      />,
    );
    expect(screen.getByText("Wed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/CalendarMonthView`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CalendarMonthView.tsx`**

```tsx
import { Box, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Lock, X } from "lucide-react";

import { expandEvents } from "../../lib/rrule";
import type { CalendarEvent, CalendarList } from "../../services/calendar";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarMonthViewProps {
  events: CalendarEvent[];
  year: number;
  month: number;
  calendars: CalendarList[];
  onEventClick: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
}

export function CalendarMonthView({
  events,
  year,
  month,
  calendars,
  onEventClick,
  onDeleteEvent,
}: CalendarMonthViewProps) {
  const theme = useTheme();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const expanded = expandEvents(
    events,
    new Date(year, month, 1),
    new Date(year, month + 1, 0, 23, 59, 59),
  );

  const eventsForDay = (day: number) => {
    const dayStart = new Date(year, month, day).getTime();
    const dayEnd = dayStart + 86400000;
    return expanded.filter((e) => e.begin >= dayStart && e.begin < dayEnd);
  };
  const colorFor = (e: CalendarEvent) =>
    (e.calendarId ? calendars.find((c) => c.id === e.calendarId)?.color : undefined) ??
    theme.palette.primary.main;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: "action.hover",
        }}
      >
        {DAYS.map((day) => (
          <Box key={day} sx={{ py: 1, textAlign: "center" }}>
            <Typography variant="caption" fontWeight={500} color="text.secondary">
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {day}
              </Box>
              <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                {day[0]}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {Array.from({ length: firstDay }, (_, i) => (
          <Box
            key={`pre-${i}`}
            sx={{
              minHeight: 72,
              borderRight: `1px solid ${theme.palette.divider}`,
              borderBottom: `1px solid ${theme.palette.divider}`,
              bgcolor: "action.disabledBackground",
            }}
          />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dayEvents = eventsForDay(day);
          const isToday =
            day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const cellIndex = firstDay + i;
          const isLastRow =
            Math.floor(cellIndex / 7) === Math.floor((firstDay + daysInMonth - 1) / 7);

          return (
            <Box
              key={day}
              sx={{
                minHeight: 72,
                p: 0.75,
                borderRight:
                  (cellIndex + 1) % 7 === 0 ? "none" : `1px solid ${theme.palette.divider}`,
                borderBottom: isLastRow ? "none" : `1px solid ${theme.palette.divider}`,
              }}
            >
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mb: 0.5,
                  bgcolor: isToday ? "primary.main" : "transparent",
                  color: isToday ? "primary.contrastText" : "text.secondary",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {day}
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                {dayEvents.slice(0, 2).map((evtItem) => {
                  const calColor = colorFor(evtItem);
                  return (
                    <Box
                      key={`${evtItem.eventId}-${evtItem.begin}`}
                      onClick={() => onEventClick(evtItem)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.25,
                        borderRadius: 0.5,
                        px: 0.5,
                        py: 0.25,
                        fontSize: 10,
                        fontWeight: 500,
                        lineHeight: 1.3,
                        cursor: "pointer",
                        bgcolor: calColor + "22",
                        color: calColor,
                        "&:hover .evt-del": { opacity: 1 },
                      }}
                    >
                      {evtItem.isPrivate && <Lock size={8} />}
                      <Box
                        component="span"
                        sx={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {evtItem.title}
                      </Box>
                      <Box
                        className="evt-del"
                        component="button"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          onDeleteEvent(evtItem);
                        }}
                        aria-label="Delete event"
                        sx={{
                          opacity: 0,
                          bgcolor: "transparent",
                          border: "none",
                          cursor: "pointer",
                          p: 0,
                          color: "inherit",
                          display: "flex",
                          flexShrink: 0,
                        }}
                      >
                        <X size={8} />
                      </Box>
                    </Box>
                  );
                })}
                {dayEvents.length > 2 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontSize: 10, pl: 0.5 }}
                  >
                    +{dayEvents.length - 2} more
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/CalendarMonthView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/calendar/CalendarMonthView.tsx packages/app/src/components/calendar/CalendarMonthView.test.tsx
git commit -m "feat(calendar): CalendarMonthView (expands recurring occurrences)"
```

---

### Task 12: `CalendarListView` component

Upcoming events grouped by day (forward 90-day window, recurrence-expanded), using `EventCard`.

**Files:**

- Create: `packages/app/src/components/calendar/CalendarListView.tsx`
- Test: `packages/app/src/components/calendar/CalendarListView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CalendarListView } from "./CalendarListView";

function futureEvt(over = {}) {
  const begin = Date.now() + 1000 * 60 * 60 * 24 * 2;
  return {
    id: "d1",
    eventId: "e1",
    title: "Future Sync",
    description: "",
    kind: 31923,
    begin,
    end: begin + 3600000,
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as any;
}

afterEach(() => cleanup());

describe("CalendarListView", () => {
  it("shows an empty state when there are no upcoming events", () => {
    render(<CalendarListView events={[]} onEventClick={vi.fn()} />);
    expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument();
  });

  it("lists an upcoming event", () => {
    render(<CalendarListView events={[futureEvt()]} onEventClick={vi.fn()} />);
    expect(screen.getByText("Future Sync")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/CalendarListView`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CalendarListView.tsx`**

```tsx
import { Box, Typography } from "@mui/material";

import { expandEvents } from "../../lib/rrule";
import type { CalendarEvent } from "../../services/calendar";

import { EventCard } from "./EventCard";

interface CalendarListViewProps {
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}

export function CalendarListView({ events, onEventClick }: CalendarListViewProps) {
  const now = Date.now();
  const horizon = new Date(now + 1000 * 60 * 60 * 24 * 90);
  const upcoming = expandEvents(events, new Date(now), horizon)
    .filter((e) => e.begin >= now)
    .sort((a, b) => a.begin - b.begin);

  if (upcoming.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
        No upcoming events.
      </Typography>
    );
  }

  const groups = new Map<string, CalendarEvent[]>();
  for (const e of upcoming) {
    const key = new Date(e.begin).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {Array.from(groups.entries()).map(([day, dayEvents]) => (
        <Box key={day}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            {day}
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {dayEvents.map((e) => (
              <EventCard
                key={`${e.eventId}-${e.begin}`}
                event={e}
                onClick={() => onEventClick(e)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/CalendarListView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/calendar/CalendarListView.tsx packages/app/src/components/calendar/CalendarListView.test.tsx
git commit -m "feat(calendar): CalendarListView (upcoming, grouped by day)"
```

---

### Task 13: `CalendarSidebar` component

Extracts the "My Calendars" aside (visibility toggles + new calendar + show-all-public).

**Files:**

- Create: `packages/app/src/components/calendar/CalendarSidebar.tsx`

- [ ] **Step 1: Implement `CalendarSidebar.tsx`**

```tsx
import { Box, Button, Checkbox, Divider, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Plus } from "lucide-react";

import type { CalendarList } from "../../services/calendar";

interface CalendarSidebarProps {
  calendars: CalendarList[];
  visibleCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  onNewCalendar: () => void;
  showAllPublic: boolean;
  onToggleShowAllPublic: (value: boolean) => void;
}

export function CalendarSidebar({
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  onNewCalendar,
  showAllPublic,
  onToggleShowAllPublic,
}: CalendarSidebarProps) {
  const theme = useTheme();
  return (
    <Box
      component="aside"
      sx={{
        width: 208,
        flexShrink: 0,
        borderRight: `1px solid ${theme.palette.divider}`,
        px: 1.5,
        py: 2,
        display: { xs: "none", sm: "block" },
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "text.secondary",
          px: 0.5,
          mb: 1,
          display: "block",
        }}
      >
        My Calendars
      </Typography>

      <Box
        sx={{
          maxHeight: 256,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
          mb: 1,
        }}
      >
        {calendars.map((cal) => (
          <Box
            key={cal.id}
            component="label"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 0.5,
              py: 0.75,
              borderRadius: 1,
              cursor: "pointer",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Checkbox
              size="small"
              checked={visibleCalendarIds.has(cal.id)}
              onChange={() => onToggleCalendar(cal.id)}
              sx={{ p: 0 }}
            />
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                bgcolor: cal.color || "primary.main",
              }}
            />
            <Typography variant="caption" noWrap>
              {cal.title || "Untitled"}
            </Typography>
          </Box>
        ))}
        {calendars.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            No calendars yet
          </Typography>
        )}
      </Box>

      <Button
        size="small"
        variant="text"
        startIcon={<Plus size={12} />}
        onClick={onNewCalendar}
        sx={{
          color: "text.secondary",
          fontSize: 12,
          justifyContent: "flex-start",
          px: 0.5,
          mb: 0.5,
        }}
      >
        New Calendar
      </Button>

      <Divider sx={{ my: 0.75 }} />

      <Box
        component="label"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 0.5,
          py: 0.75,
          borderRadius: 1,
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Checkbox
          size="small"
          checked={showAllPublic}
          onChange={(e) => onToggleShowAllPublic(e.target.checked)}
          sx={{ p: 0 }}
        />
        <Typography variant="caption">Show All Public</Typography>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/components/calendar/CalendarSidebar.tsx
git commit -m "feat(calendar): CalendarSidebar component"
```

---

### Task 14: `CreateCalendarDialog` component

Extracts the new-calendar dialog from the page verbatim.

**Files:**

- Create: `packages/app/src/components/calendar/CreateCalendarDialog.tsx`

- [ ] **Step 1: Implement `CreateCalendarDialog.tsx`**

```tsx
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

interface CreateCalendarDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, color: string) => Promise<unknown>;
}

export function CreateCalendarDialog({ open, onClose, onCreate }: CreateCalendarDialogProps) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#334155");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title) return;
    setIsSubmitting(true);
    try {
      await onCreate(title, color);
      setTitle("");
      setColor("#334155");
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>New Calendar</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 2 }}>
        <TextField
          label="Calendar name"
          size="small"
          fullWidth
          placeholder="My Calendar"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Color
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              component="input"
              type="color"
              value={color}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
              sx={{
                width: 48,
                height: 32,
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "transparent",
                cursor: "pointer",
                p: 0.25,
              }}
            />
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              {color}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={!title || isSubmitting}>
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @formstr/app typecheck
git add packages/app/src/components/calendar/CreateCalendarDialog.tsx
git commit -m "feat(calendar): extract CreateCalendarDialog"
```

---

### Task 15: `EventDialog` component (create + edit + Advanced)

**Files:**

- Create: `packages/app/src/components/calendar/EventDialog.tsx`
- Test: `packages/app/src/components/calendar/EventDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { EventDialog } from "./EventDialog";

function evt(over = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "Standup",
    description: "",
    kind: 31923,
    begin: new Date(2026, 5, 10, 9, 0).getTime(),
    end: new Date(2026, 5, 10, 10, 0).getTime(),
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as any;
}

afterEach(() => cleanup());

describe("EventDialog", () => {
  it("submits a draft with the entered title", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventDialog open onClose={vi.fn()} onSubmit={onSubmit} calendars={[]} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: "Launch" });
  });

  it("prefills the title and uses a Save label in edit mode", () => {
    render(<EventDialog open onClose={vi.fn()} onSubmit={vi.fn()} calendars={[]} event={evt()} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Standup");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("reveals the recurrence builder under Advanced", () => {
    render(<EventDialog open onClose={vi.fn()} onSubmit={vi.fn()} calendars={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByText("Repeats")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/EventDialog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EventDialog.tsx`**

```tsx
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { npubToHex } from "../../lib/npub";
import { buildRRuleString, parseRRuleString, type RRuleParts } from "../../lib/rrule";
import type { CalendarEvent, CalendarEventDraft, CalendarList } from "../../services/calendar";

import { RRuleBuilder } from "./RRuleBuilder";
import { TimezonePicker } from "./TimezonePicker";

/** Format an epoch-ms instant as a `datetime-local` input value in local time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(ms - offsetMs).toISOString().slice(0, 16);
}

interface EventDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: CalendarEventDraft) => Promise<unknown>;
  calendars: CalendarList[];
  /** When provided, the dialog is in edit mode and prefills from this event. */
  event?: CalendarEvent | null;
  defaultDate?: Date;
}

export function EventDialog({
  open,
  onClose,
  onSubmit,
  calendars,
  event,
  defaultDate,
}: EventDialogProps) {
  const editing = !!event;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [calendarId, setCalendarId] = useState("none");
  const [isPrivate, setIsPrivate] = useState(false);
  const [participantsText, setParticipantsText] = useState("");
  const [rruleParts, setRruleParts] = useState<RRuleParts | null>(null);
  const [startTzid, setStartTzid] = useState<string | undefined>(undefined);
  const [formRef, setFormRef] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setDescription(event.description);
      setBegin(toLocalInput(event.begin));
      setEnd(toLocalInput(event.end));
      setLocation(event.location[0] ?? "");
      setCalendarId(event.calendarId ?? "none");
      setIsPrivate(event.isPrivate);
      setParticipantsText(event.participants.join(", "));
      setRruleParts(parseRRuleString(event.repeat.rrule));
      setStartTzid(event.startTzid);
      setFormRef(event.registrationFormRef ?? "");
      setAdvancedOpen(
        !!event.repeat.rrule ||
          !!event.startTzid ||
          !!event.registrationFormRef ||
          event.participants.length > 0,
      );
    } else {
      const base = defaultDate ?? new Date();
      setTitle("");
      setDescription("");
      setLocation("");
      setCalendarId("none");
      setIsPrivate(false);
      setParticipantsText("");
      setRruleParts(null);
      setStartTzid(undefined);
      setFormRef("");
      setAdvancedOpen(false);
      setBegin(toLocalInput(base.getTime()));
      setEnd(toLocalInput(base.getTime() + 3_600_000));
    }
  }, [open, event, defaultDate]);

  const handleSubmit = async () => {
    if (!title || !begin) return;
    setIsSubmitting(true);
    try {
      const beginDate = new Date(begin);
      const endDate = end ? new Date(end) : new Date(beginDate.getTime() + 3_600_000);
      const participants = participantsText
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(npubToHex)
        .filter((p): p is string => !!p);
      await onSubmit({
        title,
        description,
        begin: beginDate,
        end: endDate,
        location: location || undefined,
        calendarId: calendarId === "none" ? undefined : calendarId,
        isPrivate,
        participants: participants.length ? participants : undefined,
        rrule: buildRRuleString(rruleParts),
        startTzid,
        registrationFormRef: formRef || undefined,
        existingId: event?.id,
      });
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? "Edit Event" : "New Event"}</DialogTitle>
      <DialogContentText sx={{ px: 3, pb: 0 }}>
        Schedule an event on the Nostr network.
      </DialogContentText>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 2 }}>
        <TextField
          label="Title"
          size="small"
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <TextField
            label="Start"
            size="small"
            type="datetime-local"
            value={begin}
            onChange={(e) => setBegin(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="End"
            size="small"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
        <TextField
          label="Location (optional)"
          size="small"
          fullWidth
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextField
          label="Description (optional)"
          size="small"
          fullWidth
          multiline
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {calendars.length > 0 && (
          <FormControl size="small" fullWidth>
            <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              <MenuItem value="none">No calendar</MenuItem>
              {calendars.map((cal) => (
                <MenuItem key={cal.id} value={cal.id}>
                  {cal.title || "Untitled"}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
          }
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Lock size={12} />
              <Typography variant="body2">Private (encrypted)</Typography>
            </Box>
          }
        />

        <Button
          size="small"
          variant="text"
          onClick={() => setAdvancedOpen((v) => !v)}
          startIcon={advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          sx={{ alignSelf: "flex-start", color: "text.secondary" }}
        >
          Advanced
        </Button>
        <Collapse in={advancedOpen} unmountOnExit>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              label="Participants (npub or hex, comma-separated)"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={participantsText}
              onChange={(e) => setParticipantsText(e.target.value)}
              helperText="Each participant receives a NIP-59 invitation."
            />
            <RRuleBuilder value={rruleParts} onChange={setRruleParts} />
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                Timezone
              </Typography>
              <TimezonePicker value={startTzid} onChange={setStartTzid} />
            </Box>
            <TextField
              label="Registration form (naddr/coordinate, optional)"
              size="small"
              fullWidth
              value={formRef}
              onChange={(e) => setFormRef(e.target.value)}
            />
          </Box>
        </Collapse>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!title || !begin || isSubmitting}
        >
          {isSubmitting ? "Saving…" : editing ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/EventDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/calendar/EventDialog.tsx packages/app/src/components/calendar/EventDialog.test.tsx
git commit -m "feat(calendar): unified EventDialog (create/edit + recurrence/tz/participants/form)"
```

---

### Task 16: `EventDetailsDialog` component

Details + attendee list + author (Edit/Delete) vs invitee (RSVP) actions.

**Files:**

- Create: `packages/app/src/components/calendar/EventDetailsDialog.tsx`
- Test: `packages/app/src/components/calendar/EventDetailsDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("../../services/calendar/rsvp", () => ({
  fetchRsvpsForEvent: vi.fn().mockResolvedValue([]),
  rsvpToEvent: vi.fn().mockResolvedValue(undefined),
}));

import { EventDetailsDialog } from "./EventDetailsDialog";

function evt(over = {}) {
  return {
    id: "d1",
    eventId: "e1",
    title: "Standup",
    description: "",
    kind: 31923,
    begin: new Date(2026, 5, 10, 9, 0).getTime(),
    end: new Date(2026, 5, 10, 10, 0).getTime(),
    createdAt: 0,
    categories: [],
    participants: [],
    location: [],
    website: "",
    user: "me",
    isPrivate: false,
    repeat: { rrule: null },
    ...over,
  } as any;
}

afterEach(() => cleanup());

describe("EventDetailsDialog", () => {
  it("shows Edit/Delete for the author", () => {
    render(
      <EventDetailsDialog
        event={evt({ user: "me" })}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows RSVP buttons for non-authors", () => {
    render(
      <EventDetailsDialog
        event={evt({ user: "someone-else" })}
        currentUserPubkey="me"
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/EventDetailsDialog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `EventDetailsDialog.tsx`**

```tsx
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";
import { Check, CircleHelp, Lock, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatNpub } from "../../lib/npub";
import type { CalendarEvent, RSVPResponse } from "../../services/calendar";
import { fetchRsvpsForEvent, rsvpToEvent } from "../../services/calendar/rsvp";

interface EventDetailsDialogProps {
  event: CalendarEvent | null;
  currentUserPubkey: string | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}

export function EventDetailsDialog({
  event,
  currentUserPubkey,
  onClose,
  onEdit,
  onDelete,
}: EventDetailsDialogProps) {
  const [rsvps, setRsvps] = useState<RSVPResponse[]>([]);
  const [rsvpBusy, setRsvpBusy] = useState<string | null>(null);

  const coordinate = event ? `${event.kind}:${event.user}:${event.id}` : "";
  const isAuthor = !!event && event.user === currentUserPubkey;

  useEffect(() => {
    if (!event) return;
    let active = true;
    fetchRsvpsForEvent(coordinate)
      .then((r) => {
        if (active) setRsvps(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [event, coordinate]);

  if (!event) return null;

  const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const rows = [
    { label: "Start", value: formatDate(event.begin) },
    { label: "End", value: formatDate(event.end) },
    ...(event.location.length ? [{ label: "Location", value: event.location.join(", ") }] : []),
    ...(event.repeat.rrule ? [{ label: "Repeats", value: event.repeat.rrule }] : []),
  ];

  const sendRsvp = async (status: "accepted" | "declined" | "tentative") => {
    setRsvpBusy(status);
    try {
      await rsvpToEvent(coordinate, status, event.isPrivate);
      const refreshed = await fetchRsvpsForEvent(coordinate);
      setRsvps(refreshed);
    } finally {
      setRsvpBusy(null);
    }
  };

  return (
    <Dialog open={!!event} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {event.isPrivate && <Lock size={16} />}
        {event.title}
      </DialogTitle>
      {event.description && (
        <DialogContentText sx={{ px: 3, pb: 0 }}>{event.description}</DialogContentText>
      )}
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((row) => (
            <Box key={row.label} sx={{ display: "flex", gap: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ width: 64, flexShrink: 0 }}>
                {row.label}
              </Typography>
              <Typography variant="body2">{row.value}</Typography>
            </Box>
          ))}

          <Divider />
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            Attendees ({rsvps.length})
          </Typography>
          {rsvps.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No RSVPs yet.
            </Typography>
          )}
          {rsvps.map((r) => (
            <Box
              key={r.pubkey}
              sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {formatNpub(r.pubkey)}
              </Typography>
              <Chip label={r.status} size="small" />
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        {isAuthor ? (
          <>
            <Button
              color="error"
              variant="outlined"
              startIcon={<Trash2 size={14} />}
              onClick={() => onDelete(event)}
            >
              Delete
            </Button>
            <Button
              variant="outlined"
              startIcon={<Pencil size={14} />}
              onClick={() => onEdit(event)}
            >
              Edit
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={
                rsvpBusy === "accepted" ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <Check size={14} />
                )
              }
              disabled={!!rsvpBusy}
              onClick={() => sendRsvp("accepted")}
            >
              Accept
            </Button>
            <Button
              variant="outlined"
              startIcon={
                rsvpBusy === "tentative" ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <CircleHelp size={14} />
                )
              }
              disabled={!!rsvpBusy}
              onClick={() => sendRsvp("tentative")}
            >
              Maybe
            </Button>
            <Button
              variant="text"
              startIcon={
                rsvpBusy === "declined" ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <X size={14} />
                )
              }
              disabled={!!rsvpBusy}
              onClick={() => sendRsvp("declined")}
            >
              Decline
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/EventDetailsDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/calendar/EventDetailsDialog.tsx packages/app/src/components/calendar/EventDetailsDialog.test.tsx
git commit -m "feat(calendar): EventDetailsDialog (attendees + author/invitee actions)"
```

---

### Task 17: `InvitationInbox` test

The component already exists; add coverage (it will be mounted in Task 18).

**Files:**

- Create: `packages/app/src/components/calendar/InvitationInbox.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { render, screen, cleanup } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("../../services/calendar/rsvp", () => ({
  rsvpToEvent: vi.fn().mockResolvedValue(undefined),
}));

const state = {
  invitations: [
    {
      wrapId: "w1",
      eventCoordinate: "31923:author:d1",
      authorPubkey: "author",
      kind: 31923,
      receivedAt: 0,
      event: { title: "Launch Party", begin: Date.now() + 3600000 },
    },
  ],
  start: vi.fn(),
  markRsvp: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("../../stores/invitationsStore", () => ({
  useInvitationsStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { InvitationInbox } from "./InvitationInbox";

afterEach(() => cleanup());

describe("InvitationInbox", () => {
  it("lists a pending invitation with an Accept action", () => {
    render(
      <SnackbarProvider>
        <InvitationInbox />
      </SnackbarProvider>,
    );
    expect(screen.getByText("Launch Party")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @formstr/app exec vitest run components/calendar/InvitationInbox`
Expected: PASS (component already implemented).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/calendar/InvitationInbox.test.tsx
git commit -m "test(calendar): InvitationInbox renders pending invitations"
```

---

### Task 18: Rewrite `CalendarPage` as a thin orchestrator

Wires every component, mounts `InvitationInbox`, adds a month/list toggle, and deletes via the correct coordinate.

**Files:**

- Rewrite: `packages/app/src/pages/CalendarPage.tsx`

- [ ] **Step 1: Replace the entire file with the orchestrator**

```tsx
import {
  Box,
  Button,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CalendarListView } from "../components/calendar/CalendarListView";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";
import { CalendarSidebar } from "../components/calendar/CalendarSidebar";
import { CreateCalendarDialog } from "../components/calendar/CreateCalendarDialog";
import { EventDetailsDialog } from "../components/calendar/EventDetailsDialog";
import { EventDialog } from "../components/calendar/EventDialog";
import { InvitationInbox } from "../components/calendar/InvitationInbox";
import type { CalendarEvent } from "../services/calendar";
import { useAuthStore, useCalendarStore } from "../stores";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function CalendarPage() {
  const {
    events,
    calendars,
    error,
    selectedDate,
    setSelectedDate,
    fetchEvents,
    fetchCalendars,
    createEvent,
    updateEvent,
    createCalendar,
    deleteEvent,
  } = useCalendarStore();
  const pubkey = useAuthStore((s) => s.pubkey);
  const pubkeyRef = useRef(pubkey);

  const [viewMode, setViewMode] = useState<"month" | "list">("month");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [createCalOpen, setCreateCalOpen] = useState(false);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(new Set());
  const [showAllPublic, setShowAllPublic] = useState(false);

  useEffect(() => {
    pubkeyRef.current = pubkey;
  }, [pubkey]);
  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);
  useEffect(() => {
    if (calendars.length > 0 && visibleCalendarIds.size === 0) {
      setVisibleCalendarIds(new Set(calendars.map((c) => c.id)));
    }
  }, [calendars, visibleCalendarIds.size]);
  useEffect(() => {
    if (!showAllPublic && !pubkeyRef.current) return;
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const params: Parameters<typeof fetchEvents>[0] = {
      since: Math.floor(start.getTime() / 1000),
      until: Math.floor(end.getTime() / 1000),
    };
    if (!showAllPublic && pubkeyRef.current) params.authors = [pubkeyRef.current];
    fetchEvents(params);
  }, [selectedDate, fetchEvents, showAllPublic]);

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const toggleCalendar = (calId: string) =>
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      return next;
    });

  const filteredEvents = events.filter(
    (e) => !e.calendarId || visibleCalendarIds.has(e.calendarId),
  );

  const handleDelete = (event: CalendarEvent) => {
    deleteEvent(event.id, `${event.kind}:${event.user}:${event.id}`);
    setDetailEvent(null);
  };

  const openCreate = () => {
    setEditEvent(null);
    setEventDialogOpen(true);
  };
  const openEdit = (event: CalendarEvent) => {
    setDetailEvent(null);
    setEditEvent(event);
    setEventDialogOpen(true);
  };

  return (
    <Box sx={{ display: "flex", gap: 0, mx: { xs: -2, sm: -3, lg: -4 } }}>
      <CalendarSidebar
        calendars={calendars}
        visibleCalendarIds={visibleCalendarIds}
        onToggleCalendar={toggleCalendar}
        onNewCalendar={() => setCreateCalOpen(true)}
        showAllPublic={showAllPublic}
        onToggleShowAllPublic={setShowAllPublic}
      />

      <Box sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3, lg: 4 } }}>
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}
        >
          <Typography variant="h6" fontWeight={600}>
            Calendar
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewMode}
              onChange={(_, v) => v && setViewMode(v)}
            >
              <ToggleButton value="month">Month</ToggleButton>
              <ToggleButton value="list">List</ToggleButton>
            </ToggleButtonGroup>
            <Button
              variant="contained"
              size="small"
              startIcon={<Plus size={16} />}
              onClick={openCreate}
            >
              New Event
            </Button>
          </Box>
        </Box>

        {error && (
          <Typography variant="body2" color="error" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        <InvitationInbox />

        {viewMode === "month" && (
          <>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1.5,
                mb: 2,
              }}
            >
              <IconButton
                size="small"
                onClick={() => setSelectedDate(new Date(year, month - 1, 1))}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <Typography variant="body1" fontWeight={600} sx={{ width: 144, textAlign: "center" }}>
                {MONTHS[month]} {year}
              </Typography>
              <IconButton
                size="small"
                onClick={() => setSelectedDate(new Date(year, month + 1, 1))}
              >
                <ChevronRight size={18} />
              </IconButton>
            </Box>
            <CalendarMonthView
              events={filteredEvents}
              year={year}
              month={month}
              calendars={calendars}
              onEventClick={setDetailEvent}
              onDeleteEvent={handleDelete}
            />
          </>
        )}

        {viewMode === "list" && (
          <CalendarListView events={filteredEvents} onEventClick={setDetailEvent} />
        )}
      </Box>

      <EventDialog
        open={eventDialogOpen}
        onClose={() => setEventDialogOpen(false)}
        onSubmit={(draft) => (draft.existingId ? updateEvent(draft) : createEvent(draft))}
        calendars={calendars}
        event={editEvent}
      />
      <CreateCalendarDialog
        open={createCalOpen}
        onClose={() => setCreateCalOpen(false)}
        onCreate={createCalendar}
      />
      <EventDetailsDialog
        event={detailEvent}
        currentUserPubkey={pubkey}
        onClose={() => setDetailEvent(null)}
        onEdit={openEdit}
        onDelete={handleDelete}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Verify LOC < 200**

Run: `wc -l packages/app/src/pages/CalendarPage.tsx`
Expected: a number below 200.

- [ ] **Step 3: Typecheck + run all calendar tests**

Run: `pnpm --filter @formstr/app typecheck`
Expected: clean.
Run: `pnpm --filter @formstr/app exec vitest run calendar`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/pages/CalendarPage.tsx
git commit -m "refactor(calendar): CalendarPage orchestrator + month/list toggle + invitation inbox"
```

---

## Phase 4 — Coverage gate & final verification

### Task 19: Enable the calendar coverage gate and verify the whole build

**Files:**

- Modify: `packages/app/vitest.config.ts`

- [ ] **Step 1: Add the calendar threshold**

In `packages/app/vitest.config.ts`, change the `thresholds` block to:

```ts
      thresholds: {
        "src/services/forms/**": {
          lines: 80,
        },
        "src/services/calendar/**": {
          lines: 80,
        },
      },
```

- [ ] **Step 2: Run the calendar coverage to confirm the gate passes**

Run: `pnpm --filter @formstr/app exec vitest run --coverage services/calendar`
Expected: PASS with `services/calendar/**` ≥ 80% lines. If under 80%, add service tests (e.g. cover `subscribeToCalendarEvents`, `createCalendarList` color default) until the gate is green.

- [ ] **Step 3: Full repo verification**

Run each and confirm success:

```bash
pnpm --filter @formstr/app typecheck
pnpm --filter @formstr/mcp typecheck
pnpm -w lint
pnpm --filter @formstr/app exec vitest run
pnpm --filter @formstr/mcp exec vitest run
pnpm --filter @formstr/app build
pnpm --filter @formstr/mcp build
```

Expected: all green. Fix any lint (import order / unused) or type errors before committing.

- [ ] **Step 4: Commit**

```bash
git add packages/app/vitest.config.ts
git commit -m "test(calendar): enable 80% coverage gate for services/calendar"
```

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run `pnpm --filter @formstr/app dev`, sign in, then verify: create an event (with a participant + weekly recurrence) → it appears in the month grid on each occurrence and in the list view → open details → delete → it stays gone after switching months (refetch). If a second identity is available, confirm the invitation appears in their inbox and an RSVP shows in the author's attendee list.

---

## Self-Review

**Spec coverage:**

- Bug 1 (delete coordinate) → Tasks 3, 4, 18. ✅
- Bug 2 (mount InvitationInbox) → Task 18 (+ test Task 17). ✅
- Bug 3 (wire RRuleBuilder/TimezonePicker) → Task 15; round-trip Tasks 1–2. ✅
- Bug 4 (participants on create) → Task 15. ✅
- Bug 5 (optional end time) → Task 15 (`end` defaults to start + 1h). ✅
- UI split (orchestrator + 7 components) → Tasks 10–18. ✅
- MCP parity table (get/update/list_calendars/create_calendar/fetch_event_rsvps/list_invitations/attach_form + extended create) → Tasks 6–9. ✅
- `fetchInvitationsSync` service helper → Task 5. ✅
- Attendee list via `fetchRsvpsForEvent` (public-only limitation) → Task 16. ✅
- Coverage gate → Task 19. ✅
- DoD (typecheck/lint/test/build, page < 200 LOC, delete persists) → Tasks 18–19. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `deleteEvent(id, coordinate)` (Task 4) matches the call site `deleteEvent(event.id, \`${event.kind}:${event.user}:${event.id}\`)`(Task 18).`onSubmit(draft)`with`draft.existingId`(Task 15) matches the orchestrator's`draft.existingId ? updateEvent(draft) : createEvent(draft)`and the store signatures`createEvent(draft)`/`updateEvent(draft)`. MCP tool handlers consume the extended service mock added in Task 6. `InvitationWithEvent`(Task 5) is consumed by`list_invitations` (Task 9). ✅
