# `@formstr/calendar-sdk` — follow-ups from the super-app integration

Living checklist. Each entry is something the super-app had to keep or build
locally because `@formstr/calendar-sdk` 0.1.0 does not cover it. Every one ends
with app or agent code being deleted once it lands in the SDK.

Source repo: `formstr-hq/common-packages`, `packages/calendar-sdk`.
Consumer: this repo, branch `calendar-sdk-integration`.
Design doc: [../plans/2026-08-18-calendar-sdk-integration.md](../plans/2026-08-18-calendar-sdk-integration.md).

---

## 1. Event discovery beyond calendar-list refs

**Status:** open. **Blocks deleting:** `packages/agent/src/services/calendar/discovery.ts`.

`fetchEventsFromCalendars()` returns only events referenced by a calendar
list's `eventRefs`, and `fetchEvents()` is just that over the caller's own
lists. Two things the super-app needs are missing:

- **Direct-by-author events.** `publishPrivateEvent`'s `calendarId` is
  optional, so an event published without it exists on relays but is
  unreachable through any SDK read path. The app queries
  `{kinds: [32678], authors: [self]}` directly and resolves the view key with
  `lookupViewKey(lists, coordinate)`.
- **NIP-09 deletion filtering.** No read path consults kind-5 events, so a
  deleted event is re-fetched and re-rendered on every refresh — relays keep
  serving it. `fetchDeletions` and `isDeleted` are exported but never wired
  into a fetch.

**Proposed API**

```ts
sdk.fetchEventsForUser(options?: {
  calendars?: readonly CalendarList[];   // pre-fetched, to skip a round trip
  authors?: string[];                    // defaults to the signer's pubkey
  since?: number;
  until?: number;
  includeDeleted?: boolean;              // default false
}): Promise<CalendarEvent[]>
```

Union of the direct-by-author query, the calendar-list refs and
`newestByCoordinate` resolution, with a deletion sweep across every collected
author. `fetchDeletions` currently takes a single pubkey; it needs an overload
taking a list, or the method fans out internally.

`isDeleted` also drops a nuance the agent's index had: the agent mapped each
deleted coordinate to the deletion's `created_at` and hid the event only when
its own `created_at` was older, so a legitimate re-publish after a delete
survived. The SDK's index is a bare `Set`, so a re-published event stays
hidden.

---

## 2. Booking / scheduling pages

**Status:** open. **Blocks deleting:** `packages/agent/src/services/calendar/booking.ts`
(318 lines) and the agent's last calendar directory.

Absent from the SDK entirely: kinds 31927 (scheduling page), 32680 (scheduling
pages list), 1057 (booking request), 1058 (booking response). The super-app
implements Calendly-style booking links on top of them, and four published
`@formstr/mcp` tools depend on it — `list_scheduling_pages`,
`list_booking_requests`, `approve_booking`, `decline_booking`.

Port target: a `booking` service on `CalendarSDK` with
`fetchSchedulingPages`, `bookingLinkUrl`, `fetchBookingRequests`,
`approveBookingRequest`, `declineBookingRequest`. Approval publishes a private
event, so it composes with `publishPrivateEvent({ dTag })` — the pre-agreed
d-tag option already exists for exactly this.

Reference implementation to port from: `packages/agent/src/services/calendar/booking.ts`
in this repo, and `src/nostr/booking.ts` in `formstr-hq/nostr-calendar`.

---

## 3. Booking wire-format upgrade to kind 1059

**Status:** open, depends on 2. **Blocks:** interop with calendar.formstr.app v2.1.0.

Same drift the invitation path already fixed. calendar.formstr.app writes
booking requests and responses as kind 1059 gift wraps discriminated by
`["k","1057"]` / `["k","1058"]`, and reads the legacy bare 1057/1058 kinds for
compatibility (`src/nostr/booking.ts`, `src/nostr/kinds.ts`). The super-app
still writes the legacy shape only.

Whatever lands for item 2 should write 1059 + `k` and read both.

---

## 4. Legacy kind-1052 invitation wraps

**Status:** open. **Blocks deleting:** the legacy filter and unwrap branch in
`packages/app/src/stores/invitationsStore.ts`.

`invitationInboxFilters()` emits one filter: kind 1059 with `#k=1052`. Wraps
written by the pre-1059 super-app are kind 1052 with no `k` row and are never
queried, so a pending invitation sent by the current super-app becomes
invisible to a client on the SDK. Upstream reads both.

**Proposed change:** `invitationInboxFilters` returns a second filter
`{kinds: [1052], "#p": pubkeys}`, and the unwrap path tolerates a rumor of
kind 52 as well as 14. The SDK's own code comment already anticipates this —
"the invitation inbox needs two — current and legacy wraps".

---

## 5. `start_tzid` / `end_tzid` round-tripping

**Status:** open, needs upstream coordination. **Blocks deleting:** the raw-tag
read in `packages/app/src/lib/ics.ts`.

The SDK neither writes nor parses `start_tzid` / `end_tzid`, matching
calendar.formstr.app, which writes none. The super-app used to write them and
uses them for timezone-correct ICS export. Post-integration the app recovers
them by reading `CalendarEvent.event`'s raw tags, and new events carry none.

Restoring this means changing what both clients publish, so it is an upstream
conversation before it is an SDK change. The SDK's own README already lists
tzid/DST recurrence drift as a known parity limitation.

---

## 6. kind-84 dismissal history

**Status:** won't fix unless it bites.

The pre-SDK super-app recorded invitation dismissals as kind-84 participant
removals; the SDK and upstream use kind-5 NIP-09 deletions. The SDK does not
read kind 84, so an invitation dismissed by an older super-app build can
resurface once. Dismissing it again records a kind-5 deletion and it stays
gone.

Listed for the record. A one-shot kind-84 read in the SDK is possible but the
blast radius is one extra dismissal per stale invitation, per user, ever.
