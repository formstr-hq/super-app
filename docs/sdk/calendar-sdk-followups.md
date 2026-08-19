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
**Confirmed during integration.**

`fetchEventsFromCalendars()` returns only events referenced by a calendar
list's `eventRefs`, and `fetchEvents()` is just that over the caller's own
lists. Two things the super-app needs are missing:

- **Direct-by-author public events.** `fetchPublicEvents` covers these, but nothing
  unions them with the calendar-list results or resolves newest-per-coordinate
  across both. (A direct query for _private_ events turns out to be pointless:
  the view key lives only in a list ref, so an unlinked private event is
  undecryptable by anyone, SDK or not. The composer does not attempt it.)
- **NIP-09 deletion filtering.** No read path consults kind-5 events, so a
  deleted event is re-fetched and re-rendered on every refresh — relays keep
  serving it. `fetchDeletions` and `isDeleted` are exported but never wired
  into a fetch, and their index is too lossy to use as-is (below), so
  `discovery.ts` indexes the kind-5 events itself.

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

**`DeletionIndex` needs three properties it does not have.** `fetchDeletions`
is scoped to one author and returns bare `Set`s, so a caller collecting several
authors' events has no safe way to use it:

1. **Same-author binding.** Merging per-author indexes and testing every event
   against all of them lets any author tombstone any other author's event with
   a forged `a` row. An index that carried its author, or an `isDeleted` that
   took one, would close this. The agent's pre-SDK index checked
   `coordinate.split(":")[1] === deletion.pubkey` and keyed `e` rows as
   `${author}:${id}`.
2. **Republish survival.** The old index mapped each coordinate to the newest
   deletion's `created_at` and hid the event only when its own `created_at` was
   at or below it, so a legitimate republish after a delete survived. The SDK's
   `Set` hides it forever.
3. **Multi-author fetch.** `fetchDeletions` takes a single pubkey, so a caller
   with N authors issues N concurrent REQs per relay — hundreds of them in the
   app's "show all public" view. It needs a list overload.

Until then `discovery.ts` keeps its own ~40-line index and does not import
`fetchDeletions`/`isDeleted`.

One more shape note for whoever ports this: the composer must default `authors`
to the signed-in user **only when no `since`/`until` window was given**. With a
window and no explicit authors it has to browse public events broadly — that is
what the app's "show all public" toggle relies on.

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

That recovery reaches **public** pre-migration events only. On a private event
the rows went inside the encrypted payload, and `CalendarEvent` exposes the
decrypted rows nowhere — only the fields the codec lifted out — so the raw-tag
read finds nothing and the export falls back to UTC. Private is the default, so
that is most of them. A `ParseEventOptions` that returned the decrypted tag
rows, or explicit `startTzid`/`endTzid` fields on `CalendarEvent`, would close
it without changing anything on the wire.

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

---

## 7. `toCalendarSigner` has an unusable parameter type

**Status:** open. **Blocks deleting:** the local `toCalendarSigner` in both
`packages/agent/src/services/calendar/sdk.ts` and
`packages/app/src/lib/calendar/sdk.ts`.

The published adapter declares its parameter as:

```ts
declare function toCalendarSigner(signer: {
  getPublicKey(): Promise<string> | string;
  signEvent(event: never): Promise<never> | never;   // ← unusable
  …
}): CalendarSigner;
```

No real signer satisfies it. The blocker is the **return** type, not the
parameter: a `signEvent(e: EventTemplate): Promise<VerifiedEvent>` is not
assignable to one returning `Promise<never>`, and return-type covariance is
always enforced regardless of strictness settings. Every consumer therefore has
to either cast or hand-roll the adapter. The super-app hand-rolls it — a bound
object literal typed against `CalendarSigner`, which is correctly typed — so no
`as` cast is needed anywhere.

**Proposed fix:** type the parameter as the structural signer it actually
accepts, e.g. `signEvent(event: EventTemplate): Promise<Event> | Event`.

Worth noting alongside it: `CalendarSigner` requires `nip44Encrypt`/`nip44Decrypt`
while `@formstr/core`'s `NostrSigner` declares them optional, so any adapter has
to narrow that gap. The super-app throws a named error when they are absent.

---

## 8. No booking, no busy-list, no tzid — the shape of what is left

A summary of what the super-app still owns after the integration, for whoever
picks up items 1-5:

| Concern                              | Where it lives now                                     | Item |
| ------------------------------------ | ------------------------------------------------------ | ---- |
| Event discovery union + NIP-09 sweep | `packages/agent/src/services/calendar/discovery.ts`    | 1    |
| Booking / scheduling pages           | `packages/agent/src/services/calendar/booking.ts`      | 2, 3 |
| Legacy kind-1052 invitation reads    | `packages/app/src/lib/calendar/legacyInvitations.ts`   | 4    |
| `start_tzid` on export               | `packages/app/src/lib/ics.ts` (reads raw tags)         | 5    |
| Signer adaptation                    | `sdk.ts` in both packages                              | 7    |
| Invitation inbox relays + dismissals | `lib/calendar/{sdk,dismissals}.ts`, `invitationsStore` | 9    |

Everything else — events, calendar lists, invitations, RSVPs, busy lists,
deletions, view keys, recurrence — is the SDK's.

---

## 9. The invitation inbox cannot be pointed at a relay set

**Status:** open. **Blocks deleting:** the second SDK instance in
`packages/app/src/lib/calendar/sdk.ts` and `packages/app/src/lib/calendar/dismissals.ts`.
**Confirmed during integration.**

Two gaps, both in the inbox:

- **Relay set.** Senders publish each gift wrap to the recipient's own NIP-65
  relays (`outboxRelaysFor`), so the inbox has to read the module relays
  unioned with the user's read relays. `subscribeToInvitations` uses
  `ctx.relays`, and `FetchInvitationsOptions` has no `relays` field, so the
  only way to widen it is a second `CalendarSDK` built on the union —
  `getInvitationInboxSdk()`. A `relays` option on both calls, or a
  `resolveInboxRelays` the SDK applies itself, removes it.
- **Dismissals on the live path.** `fetchInvitations` honours the user's kind-5
  dismissals; `subscribeToInvitations` hands over raw wraps and knows nothing
  about them, and relays replay their backlog on subscribe, so every dismissed
  invitation returns as soon as the inbox opens. The app re-queries the
  deletions itself (`dismissals.ts`) and filters both paths. A subscription
  that emitted parsed, dismissal-filtered `Invitation`s — the shape
  `fetchInvitations` already returns — would delete that file and the
  hand-rolled decode in `invitationsStore`.
