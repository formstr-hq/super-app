# Week 5 & 6 — Calendar Module (Upstream) Design

**Date:** 2026-05-31
**Branch convention:** `upstream-week5&6-pr1` (service), `upstream-week5&6-pr2` (UI) → PRs to `formstr-hq/super-app:main`
**Scope:** Calendar only. Pages (the other half of the original week 5-6 spec) is deferred to its own cycle.

> Derived from the approved fork spec `2026-05-29-week-5-6-calendar-pages-design.md`, **scoped to Calendar** and **reconciled** to the post-week-3&4 reality: `formsKeyStore` was deleted and forms moved to the kind-14083 list, so the original spec's "mirror `useFormsKeyStore.start()`" guidance no longer applies. Calendar's NIP-59 invitation gift-wraps are a separate, still-valid mechanism.

---

## Goal

Take the Calendar module from "working skeleton" to production-grade, hitting the week 5-6 deliverable:

> Create events (title/location/dates/RSVP), view as list or month grid, send NIP-59 invitations to attendees, receive + respond to invitations from an inbox.

Two sequential PRs, mirroring the forms week 3-4 cadence: **service/store hardening first (no UI changes), then the UI split**.

---

## Current state (validated against code)

- `services/calendar/service.ts` — has `publishPublicCalendarEvent`, `publishPrivateCalendarEvent`, `subscribeToCalendarEvents`, `fetchCalendarEventsSync`, `createCalendarList`, `updateCalendarList`, `fetchCalendarLists`, `deleteCalendarEvent`. **Missing:** `fetchCalendarEventByCoordinate`. **No local hex helpers** (the spec's "Gap 3 hex dedup" is moot for calendar — verified).
- `services/calendar/rsvp.ts` — already has `rsvpToEvent`, `fetchRsvpsForEvent`, `extractInvitationFromWrap`.
- `stores/calendarStore.ts` — has `fetchEvents`, `fetchCalendars`, `createEvent`, `createCalendar`, `deleteEvent`. **Missing:** `ingestEvent`, `updateEvent`.
- `stores/invitationsStore.ts` — `@ts-nocheck`, **excluded from tsconfig**. Exports a no-op `start()` stub; the full subscription implementation is preserved in a trailing comment block. It depends on `fetchCalendarEventByCoordinate` (service) + `calendarStore.ingestEvent` (store) — both missing.
- `layout/AppShell.tsx` — has an auth effect keyed on `pubkey` (`fetchUserRelays`). No store `.start()` wiring yet.
- `pages/CalendarPage.tsx` — **833 LOC** monolith (month grid + list + event card + create dialog + details dialog).
- `services/calendar/types.ts` — `CALENDAR_KINDS` (incl. `giftWrap: 1052`, `rsvpGiftWrap: 1055`), `CalendarEvent` (has `isInvitation?`), `CalendarEventDraft` (has `existingId?`), `CalendarList`, `RSVPResponse`.

---

## PR 1 — `fix(calendar): unstub invitations + service hardening + tests`

**No UI changes, no new routes.**

### Changes

1. **`service.ts` → add `fetchCalendarEventByCoordinate(coord: string): Promise<CalendarEvent | null>`**
   Parse an `a`-tag coordinate (`kind:pubkey:dTag`), fetch the referenced event from the calendar relays, parse via the existing event parser, return `null` on miss. Reuse the existing parse logic that `fetchCalendarEventsSync` uses (extract a shared `parseCalendarEvent(event)` helper if it's currently inline).

2. **`calendarStore.ts` → add `ingestEvent(event: CalendarEvent)`**
   Insert a single event into `events`, deduped by `id` (used by the inbox to surface invitation events into the grid). No relay round-trip.

3. **`calendarStore.ts` → add `updateEvent(draft: CalendarEventDraft)`**
   Re-publish via the existing `createEvent` path with `draft.existingId` set (standard replaceable-event update), then update local state in place.

4. **`invitationsStore.ts` → restore the full implementation**
   - Add `subscription: SubscriptionHandle | null` to the `InvitationsStore` interface and initial state.
   - Replace the no-op `start()`/`stop()` with the commented implementation: subscribe to `CALENDAR_KINDS.giftWrap` + `rsvpGiftWrap` filtered by `#p: [userPubkey]`; on each wrap → `extractInvitationFromWrap` → `fetchCalendarEventByCoordinate` → `calendarStore.ingestEvent({ ...event, isInvitation: true })` → prepend to `invitations` (dedup by `wrapId`).
   - Remove `// @ts-nocheck` and the trailing comment block.
   - Remove `invitationsStore.ts` from the tsconfig `exclude` list.

5. **`AppShell.tsx` → bridge invitations on auth** (reconciled Gap 4)
   In the existing `pubkey` effect, call `useInvitationsStore.getState().start()` when `pubkey` is set; return a cleanup that calls `stop()`. (No `formsKeyStore` — it no longer exists.)

### Tests (`services/calendar/**`, `stores/**`; vitest jsdom, mocked `@formstr/core`)

| File                       | What                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service.test.ts`          | `publishPublicCalendarEvent` (tags correct, recurring rrule honored); `publishPrivateCalendarEvent` (encrypted content + per-participant gift-wraps published); `fetchCalendarEventsSync` parses; `fetchCalendarEventByCoordinate` (null on miss, event on hit); `deleteCalendarEvent` (kind-5 with correct `a`-tag) |
| `rsvp.test.ts`             | `rsvpToEvent` (correct status + coordinate); `extractInvitationFromWrap` (unwraps NIP-59 → invitation rumor)                                                                                                                                                                                                         |
| `calendarStore.test.ts`    | `fetchEvents` sets events; `createEvent` public + private; `updateEvent` re-publishes with `existingId`; `ingestEvent` adds without duplicating; `deleteEvent` removes                                                                                                                                               |
| `invitationsStore.test.ts` | `start()` subscribes to gift-wrap + rsvp-wrap kinds; on event → `extractInvitationFromWrap` → fetch referenced event → `ingestEvent` + prepend; `markRsvp` updates; `dismiss` removes; dedup on `wrapId`; `stop()` unsubscribes                                                                                      |

Coverage on `services/calendar/**` reported (≥80% target); **gate enabled in PR 2**.

---

## PR 2 — `refactor(calendar): split CalendarPage + plug invitation flow`

Split the 833-LOC `CalendarPage` into focused, presentational components; slim the page to an orchestrator (<200 LOC).

### File structure

```
pages/CalendarPage.tsx              ← orchestrator: view mode (month/list), selected date,
                                       active dialog, mounts InvitationInbox
components/calendar/
  CalendarMonthView.tsx   ← NEW: 6×7 day grid + event chips
  CalendarListView.tsx    ← NEW: upcoming events grouped by day
  EventCard.tsx           ← NEW: single event chip/row (compact? prop)
  CreateEventDialog.tsx   ← NEW: new/edit event (title, dates, location, participants,
                                  recurring via RRuleBuilder, calendar, private toggle)
  EventDetailsDialog.tsx  ← NEW: details + author Edit/Delete or invitee RSVP buttons
  InvitationInbox.tsx     ← EXISTING: consume restored invitationsStore
  RRuleBuilder.tsx        ← EXISTING: unchanged
  TimezonePicker.tsx      ← EXISTING: unchanged
```

### Component contracts (pure/presentational unless noted)

- **`CalendarMonthView`** — `events`, `selectedDate`, `onDateSelect(date)`, `onEventClick(event)`. Renders 6-week grid with event chips.
- **`CalendarListView`** — `events`, `onEventClick(event)`. Upcoming, grouped by day, empty state.
- **`EventCard`** — `event`, `compact?`, `onClick()`. Title + time; lock icon for private; compact hides description.
- **`CreateEventDialog`** — `open`, `onClose`, `onSubmit(draft)`, `defaultDate?`, `event?` (prefill for edit). Local draft state; private toggle; recurring selector renders `RRuleBuilder`.
- **`EventDetailsDialog`** — `open`, `event`, `currentUserPubkey`, `onClose`, `onEdit`, `onDelete`, `onRsvp(status)`. Author → Edit/Delete; invitee → Accept/Decline/Tentative.
- **`CalendarPage`** — orchestrator; holds view mode + selected date + dialog state; mounts `InvitationInbox` (banner/side panel showing pending count via `invitationsStore.hasPending()`).

### Tests (`components/calendar/**`; jsdom, @testing-library/react)

| File                          | What                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `CalendarMonthView.test.tsx`  | renders 6-week grid; event chips on correct day cells; day click → `onDateSelect`                      |
| `CalendarListView.test.tsx`   | empty state; groups by day; event click → `onEventClick`                                               |
| `EventCard.test.tsx`          | title + time; private → lock; compact hides description                                                |
| `CreateEventDialog.test.tsx`  | renders fields; submit → `onSubmit` with correct draft; private toggle; recurring renders RRuleBuilder |
| `EventDetailsDialog.test.tsx` | author (event.user === currentUserPubkey) → Edit/Delete; otherwise RSVP buttons                        |
| `InvitationInbox.test.tsx`    | empty state; lists invitations; RSVP click → `markRsvp`                                                |

**Enable the 80% line-coverage gate** for `services/calendar/**` in `vitest.config.ts` (same pattern as forms).

---

## Out of scope (this cycle)

- All of Pages (separate cycle — needs an edit-key-distribution decision: NIP-59 `pagesKeyStore` vs kind-14083-style list).
- Drive / Polls / AI modules.
- Standalone public RSVP page (RSVP happens via the NIP-59 inbox).
- External NIP-52 calendar-client interop validation (the in-house end-to-end flow is the deliverable; events remain NIP-52-shaped).

## Definition of done

1. CI green (typecheck, lint, test, build) on Node 20 + 22.
2. `services/calendar/**` ≥ 80% line coverage, gate enforced (PR 2).
3. `invitationsStore.ts` has no `@ts-nocheck`, no commented-out blocks, and is in tsconfig.
4. End-to-end: create a public event → appears in month grid + list → another user receives an invitation in their inbox → RSVPs → RSVP shows on the event details.
5. No file in `pages/` exceeds 200 LOC (orchestrators only).
