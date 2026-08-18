# Calendar SDK integration — design

Date: 2026-08-18
Branch: `calendar-sdk-integration` (based on `dev`)
Status: approved, awaiting implementation plan

## Goal

Make `@formstr/calendar-sdk` the single implementation of the calendar
protocol in the super-app. Today the protocol exists twice: once in
`packages/agent/src/services/calendar/` (~5,200 lines, the code the SDK was
extracted from) and once in the published package. The two have already
drifted, and the copy in this repo is the stale one.

## Why now — the drift is real

`@formstr/calendar-sdk` 0.1.0 is on npm, published from the tree that merged
into `formstr-hq/common-packages` as PR #16. The published source and
`upstream/main` are byte-identical.

The SDK tracks calendar.formstr.app v2.1.0. The agent's copy does not:

| Concern                   | agent (super-app today)                   | SDK 0.1.0 / calendar.formstr.app v2.1.0                   |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| Invitation wrap           | kind 1052, rumor kind 52                  | kind 1059 with `["k","1052"]`, rumor kind 14 (NIP-17)     |
| Invitation dismissal      | kind 84 participant removal               | kind 5 NIP-09 deletion + self-signed deletion of the wrap |
| Private RSVP              | kind 32069 plus a kind-1055 wrap fallback | kind 32069 only                                           |
| `start_tzid` / `end_tzid` | written and parsed                        | neither written nor parsed                                |

Upstream reads legacy 1052 wraps but writes 1059. Super-app writes only the
legacy shape. This integration is therefore not just deduplication — it moves
the app onto the wire format the rest of the ecosystem is on.

## Scope

In scope:

- App stores, components and lib helpers consume the SDK directly.
- Agent's calendar tools (all 20, including the 4 booking tools) are rebuilt
  on the SDK.
- `packages/agent/src/services/calendar/` is deleted except two files.

Out of scope, tracked as follow-ups:

- Porting booking / scheduling pages into the SDK.
- Upgrading booking's own wire format from kinds 1057/1058 to
  `1059 + ["k", …]`.
- Adding `start_tzid` round-tripping to the SDK.

## Decisions

1. **Depth** — full rewire. No adapter layer that preserves the old
   vocabulary; the SDK's types become the app's types.
2. **Booking stays in the agent.** The SDK has no booking support at all
   (kinds 31927, 32680, 1057, 1058 are absent). Booking cannot move to the app
   because the layering is `mcp → agent → core` and agent cannot import app
   code — moving it would kill `list_scheduling_pages`,
   `list_booking_requests`, `approve_booking` and `decline_booking` in the
   published `@formstr/mcp`.
3. **Legacy invitations stay readable.** The SDK's inbox filter is kind 1059
   with `#k=1052` only. The app adds a second filter for legacy kind-1052
   wraps and decodes them with the SDK's exported `unwrapEvent` +
   `parseInvitationRumor`. This mirrors upstream.
4. **tzid is read, not written.** `CalendarEvent.event` carries the raw wire
   event, so `lib/ics.ts` reads `start_tzid` off its tags when an older event
   has one. New events publish without tzid rows, matching upstream.
5. **Base branch is `dev`**, where the kanban work lives. Calendar and kanban
   files do not overlap.

## Accepted regressions

- **kind-84 dismissals are not read.** An invitation dismissed by the old
  super-app can resurface once. Dismissing it again records a kind-5 deletion
  and it stays gone. Not worth a compatibility shim.
- **New events carry no tzid rows.** ICS export falls back to UTC for them.
  Events published before this change keep their tzid, because the export
  reads the raw event.
- **Editing a private event no longer silently re-invites everyone.**
  `updatePrivateEvent` requires `previousParticipants`; the store passes the
  participants of the event being edited, so only genuinely new participants
  get a wrap.

## Architecture

### Wiring

`packages/app/src/lib/calendar/sdk.ts`

```ts
export async function getCalendarSdk(): Promise<CalendarSDK>;
```

`CalendarSDKOptions.signer` takes a signer instance, not a resolver callback,
so the factory is async: it awaits `signerManager.getSigner()`, wraps it with
the SDK's `toCalendarSigner` (which binds methods — a class signer loses `this`
otherwise), and constructs

```ts
new CalendarSDK({
  signer,
  runtime: nostrRuntime, // @formstr/core
  relays: relayManager.getRelaysForModule("calendar"),
  appBaseUrl: window.location.origin,
});
```

Core's `NostrRuntime` already satisfies the SDK's `NostrRuntime` structurally
(`querySync`, `subscribe`, `publish`); the SDK's own contract doc names the
super-app's runtime as an intended injection. Because the runtime is injected,
`dispose()` leaves core's pool alone — core owns those sockets.

The instance is memoized on `(pubkey, relay set)` and invalidated on logout,
account switch and relay-set change, so a stale signer is never reused.

`packages/agent/src/services/calendar/sdk.ts` is the mirror of this for the
agent, built from the same three core singletons, minus `appBaseUrl`.

### App data layer

`packages/app/src/lib/calendar/types.ts` re-exports the SDK's types and adds
the one decoration the app needs:

```ts
export type AppCalendarEvent = CalendarEvent & {
  calendarId?: string; // derived with the SDK's findCalendarForCoordinate
  isInvitation?: boolean;
};
```

Neither field is on the wire, so this is app state rather than a translation
shim. Stores decorate on ingest.

`calendarStore` maps onto the SDK as:

| store method                                           | today                                                 | after                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `fetchEvents`                                          | `fetchCalendarEventsForUser`                          | `fetchEventsForUser(sdk, …)` — see Event discovery                                            |
| `fetchCalendars`                                       | `fetchCalendarLists`                                  | `sdk.fetchCalendars()`                                                                        |
| `createEvent`                                          | `createCalendarEvent` (publish + link)                | `sdk.publishPrivateEvent(draft, { calendarId, calendars })` / `sdk.publishPublicEvent(draft)` |
| `updateEvent`                                          | `publishPrivateCalendarEvent`                         | `sdk.updatePrivateEvent(draft, { previousParticipants, calendarId, calendars })`              |
| `deleteEvent`                                          | `deleteCalendarEvent` + `removeEventFromCalendarList` | `sdk.deleteEvent(...)` + `sdk.unlinkEventFromCalendar(...)`                                   |
| `createCalendar` / `updateCalendar` / `deleteCalendar` | `*CalendarList`                                       | `sdk.createCalendar` / `updateCalendar` / `deleteCalendar`                                    |
| busy-list upkeep                                       | `addBusyRange` / `removeBusyRange`                    | `sdk.addBusyRange` / `sdk.removeBusyRange`                                                    |

Shape deltas at the call sites, all small:

- `CalendarEventDraft.begin`/`end` are milliseconds, not `Date` — `EventDialog`
  converts at the boundary.
- `CalendarEventDraft.existingId` → `id`.
- `registrationFormRef` / `registrationFormViewKey` → `forms: [{ naddr, viewKey }]`
  — 4 lines in `EventDialog`.
- `RSVPResponse.eventCoordinate` → `eventCoord`.
- `CalendarEvent.website` → `references: string[]` — no calendar call site uses
  it today.
- New `CalendarEvent.allDay`, previously derived ad hoc.

### Event discovery

The one place where a single SDK call is not enough. `fetchCalendarEventsForUser`
does four things; the SDK's `fetchEvents()` does only the second:

1. a direct query by author, including the private kinds, so an event the user
   authored but never linked into a calendar list still shows up;
2. a query for the events the calendar lists reference, decrypted with the
   view keys carried in those refs;
3. a NIP-09 deletion sweep over every author whose events were collected —
   without it a deleted event reappears on every refresh, because relays keep
   serving it and step 1 keeps re-fetching it;
4. newest-per-coordinate resolution across both sources.

`sdk.fetchEventsFromCalendars()` covers 2 and 4. `sdk.fetchPublicEvents()`
covers the public half of 1 and the "show all public" browse mode. Neither
filters deletions.

So the app keeps a thin `fetchEventsForUser(sdk, calendars, opts)` in
`packages/app/src/lib/calendar/discovery.ts`, assembled entirely from exported
SDK pieces — `fetchEventsFromCalendars`, `fetchPublicEvents`, `parseCalendarEvent`,
`lookupViewKey`, `fetchDeletions`, `isDeleted`, `newestByCoordinate` — plus one
raw `nostrRuntime.querySync` for the user's own private kinds. This is
discovery policy, not protocol: no wire format is re-implemented, and every
codec call goes through the SDK.

Note that `fetchDeletions` takes a single author, where the agent swept a list.
The app fans it out across the collected authors in parallel.

This helper is a candidate to move into the SDK later (follow-up 5).

### Invitation inbox

`invitationsStore` becomes:

- start: `sdk.fetchInvitationsWithEvents()` — honours kind-5 dismissals
  internally.
- live: `sdk.subscribeToInvitations(pubkey, onWrap)`, plus the app's own legacy
  filter `{ kinds: [1052], "#p": [pubkey] }` decoded with `unwrapEvent` +
  `parseInvitationRumor`. Results merge by `giftWrapId`.
- dismiss: `sdk.dismissInvitation(invitation)`.

Deleted with it: `getInvitationInboxRelays`, `extractInvitationFromWrap`,
`fetchParticipantRemovals`, `publishParticipantRemovalEvent`.

### Agent

Survivors in `packages/agent/src/services/calendar/`:

- `sdk.ts` — the factory described above.
- `booking.ts` — re-typed onto SDK types, using the SDK's `wrapEvent`,
  `unwrapEvent`, `coordinate` and `nextCreatedAt` in place of its own copies.
  Its wire format is unchanged on this branch.

Deleted: `service.ts`, `rsvp.ts`, `busyList.ts`, `viewKey.ts`,
`calendarListCodec.ts`, `types.ts` and their tests — roughly 4,500 lines.

`tools/calendar.ts` keeps all 20 tools and calls the SDK instance instead of
the service modules. `services/index.ts` drops the calendar service re-exports;
consumers import types from `@formstr/calendar-sdk`.

## Testing

App tests currently `vi.mock("@formstr/agent/services/calendar/*")`. They
instead mock `getCalendarSdk()` to return a stubbed `CalendarSDK`, which is a
smaller mock surface — one object rather than three modules.

New tests to add:

- The SDK factory memoizes per pubkey and rebuilds after logout.
- The legacy 1052 wrap path yields an invitation, and a wrap arriving on both
  filters is not duplicated.
- Discovery returns an event that exists only as a direct authored event with
  no calendar-list ref, and drops an event whose author published a kind-5
  deletion for it.
- ICS export keeps the timezone of an event whose raw tags carry `start_tzid`,
  and falls back to UTC when they do not.
- `updateEvent` passes the previous participant list, so an unchanged
  participant gets no second wrap.

Agent tool tests mock the same factory. `booking.test.ts` survives, re-typed.

## Verification

Per commit: `pnpm --filter @formstr/app test` and `typecheck`, plus
`pnpm --filter @formstr/agent test` and `typecheck` for the commits that touch
agent. Baseline test counts recorded on `dev` before the first commit.

Final commit: `pnpm --filter @formstr/app build` (`tsc -b && vite build`) and a
full-workspace typecheck.

Closing step, before the PR: live smoke against real relays with two throwaway
keys — create a private event, invite the second key, accept from it, RSVP,
then edit the event and confirm the already-invited key gets no second wrap.
Cross-check that calendar.formstr.app renders an event the super-app published,
which is the interop claim this whole change rests on.

## Follow-ups

1. Port booking / scheduling pages into `@formstr/calendar-sdk` 0.2.0, then
   rebuild the agent's 4 booking tools on it and delete the last agent
   calendar file.
2. Upgrade booking's wire format to `1059 + ["k", …]`, matching what
   calendar.formstr.app v2.1.0 writes.
3. Add `start_tzid` / `end_tzid` round-tripping to the SDK, coordinated with
   upstream, and restore tzid on publish.
4. Teach the SDK to read legacy kind-1052 wraps so the app-side legacy filter
   can be deleted.
5. Move `fetchEventsForUser` into the SDK as a `fetchEventsForUser`-style
   discovery method, including the deletion sweep, so the app-side helper can
   be deleted.
