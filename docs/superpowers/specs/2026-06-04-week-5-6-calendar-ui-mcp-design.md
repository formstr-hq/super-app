# Week 5 & 6 — Calendar UI + MCP Parity Design

**Date:** 2026-06-04
**Branch:** `upstream-week5&6-pr2` → PR to `formstr-hq/super-app:main`
**Scope:** Calendar only. Completes the deferred "PR 2" of the calendar cycle (UI split + invitation/RSVP flow), fixes outstanding calendar bugs, and brings the MCP server to full parity with the calendar service.

> Continues `2026-05-31-week-5-6-calendar-upstream-design.md`. PR 1 (service/store hardening) is merged to `main` (PR #10); the standalone MCP server is merged (PR #11) with a **minimal** calendar surface. This cycle finishes the UI and the MCP surface.

---

## Goal

Take the Calendar module from "service layer complete, skeleton UI" to a usable product:

> Create/edit events (public or private, with participants, recurrence, timezone), view them as a month grid or list, send NIP-59 invitations to attendees, receive + respond to invitations from an inbox, and see who has RSVP'd — all from the super-app UI **and** from the MCP server.

---

## Decisions (locked with the user)

- **Cycle depth:** MVP parity + full MCP. Excludes the heavy upstream `nostr-calendar` features (Calendly-style scheduling/booking pages, device/ICS sync, local notifications, availability/busy, week/day views).
- **In-app AI dispatcher:** out of scope this cycle. `ai/actionDispatcher.ts` stays stubbed; we do **not** touch `packages/app/src/ai/**`. Calendar AI access is via the standalone MCP server only.
- **Event form architecture:** one unified `EventDialog` handling create + edit (prefill via optional `event` prop) with a collapsed "Advanced" section. (Alternatives considered: separate Create/Edit dialogs — duplicates logic; full-page editor route — overkill for MVP.)

---

## Current state (validated against code)

- **Service** (`services/calendar/service.ts`, `rsvp.ts`): complete for events (public/private), RSVP (public + private NIP-59), calendar-list CRUD, `fetchCalendarEventByCoordinate`, `parseCalendarEvent`. `fetchRsvpsForEvent` reads **public** RSVPs only.
- **Stores** (`stores/calendarStore.ts`, `invitationsStore.ts`): `fetchEvents/Calendars`, `createEvent`, `createCalendar`, `deleteEvent`, `ingestEvent`, `updateEvent`; invitations subscription wired in `AppShell` on auth.
- **UI** (`pages/CalendarPage.tsx`, **833 LOC**): month grid + upcoming list + create-event dialog + create-calendar dialog + read-only details dialog + calendar-visibility sidebar. Routed at `/calendar/*`, present in the sidebar nav.
- **Built but unused:** `InvitationInbox.tsx` (never mounted), `RRuleBuilder.tsx`, `TimezonePicker.tsx`.
- **MCP** (`packages/mcp/src/tools/calendar.ts`): `list_calendar_events`, `create_calendar_event` (public-only), `delete_calendar_event`, `rsvp_event`.

---

## Bugs to fix

1. **Delete does not persist on relays.** `EventDetailDialog`/chip call `deleteEvent(event.eventId)` (the nostr event id). For addressable kind-31923/32678 events, NIP-09 deletion must reference the `a` coordinate `kind:pubkey:d`. Fix:
   - UI passes the coordinate: `deleteEvent(event.id, \`${event.kind}:${event.user}:${event.id}\`)`.
   - `service.deleteCalendarEvent` emits `["k", String(kind)]` from the **actual** event kind (currently hardcodes `publicEvent`) and relies on the `["a", coordinate]` tag.
   - `calendarStore.deleteEvent` filters local state by the `d`-tag `id` (consistent with the coordinate), not by `eventId`.
2. **`InvitationInbox` is never mounted** → received invitations are invisible. Mount as a banner at the top of the calendar main column.
3. **`RRuleBuilder` + `TimezonePicker` are unreachable** → recurring events and per-event timezones cannot be set from the UI. Wire both into `EventDialog`'s Advanced section.
4. **No participants field on create** → the UI can never populate `draft.participants`, so NIP-59 invitations are never sent. Add a participants (npub/hex) input.
5. **End time is mandatory** in the current create dialog; upstream allows omitting it. Make end optional, defaulting to start + 1h.

---

## UI architecture

`CalendarPage.tsx` becomes a thin orchestrator (target < 200 LOC) holding: view mode (`month | list`), selected date, the active dialog, and the selected/detail event. It mounts `CalendarSidebar` and `InvitationInbox`.

```
pages/CalendarPage.tsx          orchestrator (< 200 LOC)
components/calendar/
  CalendarSidebar.tsx     NEW   My Calendars list + visibility checkboxes + "New Calendar"
                                + "Show All Public" toggle (extracted from current <aside>)
  CalendarMonthView.tsx   NEW   6×7 day grid + event chips; props: events, year, month,
                                selectedDate, calendars, onDateSelect, onEventClick
  CalendarListView.tsx    NEW   upcoming events grouped by day; props: events, onEventClick
  EventCard.tsx           NEW   single event chip/row; props: event, compact?, color?, onClick,
                                onDelete?; lock icon for private
  EventDialog.tsx         NEW   create + edit (prefill via event?); fields: title, start, end,
                                location, description, calendar, private toggle; Advanced:
                                participants, recurring (RRuleBuilder), timezone (TimezonePicker),
                                attach registration form (registrationFormRef)
  EventDetailsDialog.tsx  NEW   details + attendee list (fetchRsvpsForEvent on open);
                                author (event.user === currentUserPubkey) → Edit/Delete;
                                otherwise → Accept/Decline/Tentative (rsvpToEvent)
  CreateCalendarDialog.tsx NEW  extracted from current page
  InvitationInbox.tsx     WIRE  mount as banner (already implemented)
  RRuleBuilder.tsx        WIRE  consumed by EventDialog (unchanged)
  TimezonePicker.tsx      WIRE  consumed by EventDialog (unchanged)
```

A **month/list view toggle** mirrors the forms grid/list precedent. Components are presentational (props in, callbacks out); the orchestrator owns store interaction.

### Attendee list note

`EventDetailsDialog` shows attendees via `fetchRsvpsForEvent(coordinate)`, which returns **public** RSVPs only. Private (gift-wrapped) RSVPs are decryptable solely by the event author and are out of scope for the shared attendee view this cycle — documented as a known limitation.

---

## MCP parity — `packages/mcp/src/tools/calendar.ts`

Wrap the full calendar service surface, preserving the existing safety model: read tools and constructive creates are always available; destructive/outward actions are gated behind `--allow-writes` and require `confirm:true`.

| Tool                    | Type   | Status     | Notes                                                                          |
| ----------------------- | ------ | ---------- | ------------------------------------------------------------------------------ |
| `list_calendar_events`  | read   | exists     | optional ISO since/until window                                                |
| `get_calendar_event`    | read   | **new**    | by `coordinate` (kind:pubkey:d)                                                |
| `create_calendar_event` | create | **extend** | add `isPrivate`, `participants[]`, `rrule`, `startTzid`, `registrationFormRef` |
| `update_calendar_event` | write  | **new**    | by `coordinate`/`eventId`; changed fields only                                 |
| `delete_calendar_event` | write  | exists     | uses the fixed coordinate-delete path                                          |
| `list_calendars`        | read   | **new**    | the user's calendar lists                                                      |
| `create_calendar`       | create | **new**    | title + color                                                                  |
| `fetch_event_rsvps`     | read   | **new**    | public RSVPs by coordinate                                                     |
| `list_invitations`      | read   | **new**    | via new `fetchInvitationsSync()` service helper                                |
| `rsvp_event`            | write  | exists     | accepted/declined/tentative, public or private                                 |
| `attach_form_to_event`  | write  | **new**    | set `registrationFormRef` on an event                                          |

### Service addition

`fetchInvitationsSync(): Promise<Array<InvitationRumor & { event?: CalendarEvent }>>` in `services/calendar` — `querySync` gift-wrap + rsvp-wrap kinds filtered `#p:self`, run each through `extractInvitationFromWrap`, resolve the referenced event via `fetchCalendarEventByCoordinate`, dedupe by `wrapId`. Returns a **service-level** shape (no dependency on the store's `InvitationEntry`); the in-app `invitationsStore` keeps its own live-subscription path. Reuses existing helpers; gives MCP a stateless way to list invitations.

---

## Testing

- **Service** (`services/calendar/**`, vitest jsdom, mocked `@formstr/core`): `fetchInvitationsSync` (unwrap + resolve + dedupe); `deleteCalendarEvent` emits correct `["k", kind]` + `["a", coordinate]`.
- **Stores:** `deleteEvent` filters by `id` and forwards coordinate; `updateEvent` re-publishes with `existingId`.
- **Components** (`components/calendar/**`, @testing-library/react): `CalendarMonthView` (grid + chips on correct days + day click), `CalendarListView` (empty state + grouping + click), `EventCard` (title/time, private lock, compact), `EventDialog` (submit → onSubmit draft; private toggle; recurring renders RRuleBuilder), `EventDetailsDialog` (author → Edit/Delete; invitee → RSVP buttons), `InvitationInbox` (lists pending; RSVP → markRsvp).
- **MCP** (`packages/mcp/test/calendar.test.ts`): one case per new/extended tool, including the write-gate (`--allow-writes` off → tool absent; `confirm` required).
- **Coverage gate:** enable the ≥ 80% line-coverage gate for `services/calendar/**` in `vitest.config.ts` (same pattern as forms).

---

## Out of scope (this cycle)

- In-app AI dispatcher (`packages/app/src/ai/**`) and the `ai/tools.ts` calendar catalog.
- Scheduling/booking (Calendly-style) pages, device/ICS calendar sync, local notifications, availability/busy lists, week/day views.
- Private (gift-wrapped) RSVP aggregation in the shared attendee list.
- Pages module (separate future cycle).

---

## Definition of done

1. CI green (typecheck, lint, test, build) on Node 20 + 22.
2. `services/calendar/**` ≥ 80% line coverage, gate enforced.
3. No file in `pages/` exceeds 200 LOC (orchestrators only).
4. Deleting an event **persists across a refetch** (correct `a`-coordinate NIP-09 deletion).
5. The invitation inbox is visible; recurring + timezone + participants are settable from the UI.
6. End-to-end: create event → invite a participant → recipient sees it in their inbox → RSVPs → RSVP shows in the event's attendee list.
7. MCP exposes the full calendar surface in the table above; new/extended tools are tested.
