# Calendar Interop & Parity — Design

**Date:** 2026-06-04
**Module:** Calendar (super-app) + MCP + standalone-repo context doc
**Continues:** `2026-06-04-week-5-6-calendar-ui-mcp-design.md` (PR #12, merged). That cycle delivered the service layer, stores, skeleton UI (month/list), invitation inbox, and a partial MCP surface. This cycle makes the super-app calendar **wire-compatible with the standalone `nostr-calendar`**, completes RSVP, adds delete-calendar, restructures navigation, redesigns the UI, and brings the MCP to full parity.

---

## Goal

> A super-app-authored calendar event / calendar-list / RSVP opens cleanly in **calendar.formstr.app**, and vice-versa. The calendar module looks and behaves like the standalone (in the super-app's own minimalist theme), supports the full RSVP flow, lets users manage (incl. delete) calendars, switches modules from the navbar, and exposes every calendar capability over MCP.

**Guiding principle — bidirectional wire compatibility.** Every format the super-app writes (kinds 31923 / 32678 / 32123 / 31925 / 32069 and the NIP-59 gift-wrap rumors) must match what the standalone reads, and the super-app must read what the standalone writes.

---

## Decisions (locked with the user)

1. **Scope:** _Parity + polish._ Excludes the heavy upstream subsystems (Calendly-style scheduling/booking pages, ICS/device-calendar sync, local notifications, availability/busy lists, Week/Day time-grid views). Views stay **Month + List**.
2. **Navigation:** Module switching (Forms / Calendar / Pages / Drive / Polls) moves from the left rail into the **top navbar**, globally for all modules; the left rail is removed and the width reclaimed. Calendar gets its own left **"My Calendars"** panel in the reclaimed space.
3. **RSVP:** _Full parity_ — Yes/Maybe/No bar, "suggest a new time", "add a note", organiser can respond, attendee list shows status + suggested time + note.
4. **Private events:** _Adopt the viewKey model_ (full interop). The super-app abandons self-encryption for private events in favour of a generated per-event **viewKey** (nsec), exactly as the standalone does.
5. **UI direction (finalised against mockups):** _Native super-app minimalist (monochrome)_ — black-on-white, Inter, 6px radius (consistent with Forms/Pages/Drive/Polls) — applied to the **calendar.formstr.app layout** (navbar tabs · left My Calendars panel · clean header · month grid with colored-left-bar event chips). Approved dialogs: Event details + RSVP, Create/Edit event (with Advanced), Manage calendar (with Delete). Mockups: `.superpowers/brainstorm/.../calendar-aesthetic.html` + `calendar-dialogs.html`.

---

## Root-cause analysis (the reported bug)

A super-app-created event made calendar.formstr.app throw two errors on load.

### Error 1 — `Calendar list payload is not a tags array (got object)` ✅ confirmed

The super-app encrypts the kind-32123 calendar list as a **JSON object**:

```ts
// service.ts createCalendarList / updateCalendarList
const content = await nip44SelfEncrypt(signer, JSON.stringify(calendarData)); // {id,title,color,eventRefs,...}
```

The standalone decrypts and **requires a NIP-style tags array** (`calendarList.ts:104-109`):

```ts
const parsed = JSON.parse(decryptedContent);
if (!Array.isArray(parsed))
  throw new Error(`Calendar list payload is not a tags array (got ${typeof parsed})`);
```

Object ≠ array → throw. **Fix: super-app side** (rewrite encode/decode to the tags-array shape).

### Error 2 — `Unknown letter: ':'` (bech32) — same class, deeper root

The super-app's private-event model is fundamentally incompatible with the standalone's:

|                                      | super-app (current)                            | standalone                                                                               |
| ------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Private event content                | `nip44SelfEncrypt` (only author can read)      | encrypted with a generated **viewKey** (nsec) so invitees can read                       |
| Invitation gift-wrap rumor (kind 52) | `content = {eventId, calendarId}`, `tags = []` | `content = ""`, `tags = [["a", "{kind}:{pubkey}:{dTag}", relayHint], ["viewKey", nsec]]` |
| Reader expectation                   | `{eventId, authorPubkey, kind}` (rsvp.ts:116)  | `getDetailsFromGiftWrap` reads the `a` tag + `viewKey`; throws if missing                |

The standalone's `nip19.decode` receiving a value containing `:` (a raw coordinate where an nsec/naddr is expected) yields `Unknown letter: ':'`. The standalone also throws **uncaught** on a foreign/malformed gift-wrap instead of skipping it.

> **Exact triggering line** will be pinned by reproduction during implementation (Task group A) and recorded in the context doc. The fix is twofold: super-app writes standalone-shaped private events + rumors (this repo), and the standalone gains defensive guards (documented for the calendar repo).

---

## Workstream A — Interop fixes (super-app)

**A1. Calendar list = tags array.** New `services/calendar/calendarListCodec.ts` with `encodeCalendarList(list): string[][]` and `decodeCalendarList(tags): CalendarList`, matching `calendarList.ts` exactly:

```
[["title", t], ["content", description], ["color", c],
 ["notifications", "disabled"?],
 ["a", "{kind}:{pubkey}:{dTag}", relayHint, viewKey], ...]   // one per event ref
```

`createCalendarList` / `updateCalendarList` encrypt `JSON.stringify(encodeCalendarList(list))`; `fetchCalendarLists` decrypts → `JSON.parse` → guard `Array.isArray` → `decodeCalendarList`. Round-trip test against a fixture produced from the standalone's encoder.

**A2. Event ↔ calendar membership via `eventRefs`.** Adopt the standalone model: an event belongs to a calendar because its `a`-coordinate is in that calendar list's `eventRefs` — not the ad-hoc `event.calendarId` field. Assigning/changing a calendar adds/moves the `a` ref (`addEventToCalendarList` / `moveEventBetweenCalendarLists` equivalents); month/list filtering reads membership from `eventRefs`. `calendarId` on `CalendarEvent` becomes a derived convenience (looked up from lists), not the source of truth.

**A3. Private events → viewKey model.** Rewrite `publishPrivateCalendarEvent`:

- Generate `viewSecretKey = generateSecretKey()`; derive its pubkey; build a `LocalSigner` from it (core exports `LocalSigner`).
- Encrypt event content tags-array with the viewKey signer (`nip44` to the viewKey's own pubkey) — readable by anyone holding the nsec.
- Publish kind-32678 with `tags:[["d", dTag]]`, capture the accepting `relayHint`.
- Gift-wrap to each participant (kind 1052) a rumor: `content:""`, `tags:[["a", coordinate, relayHint], ["viewKey", nsecEncode(viewSecretKey)]]` (matches `nostr.ts:457-475`).
- Store the `a` ref **with viewKey** in the owning calendar list's `eventRefs`.
- `parseCalendarEvent` / read path: when an event came from an invitation/eventRef, decrypt with the supplied viewKey (decode nsec → LocalSigner → nip44 self-decrypt). Keep a fallback for legacy self-encrypted events the author still owns.

**A4. Invitation rumor reader.** Update `extractInvitationFromWrap` to read the standalone shape (`a` tag → coordinate, `viewKey` tag), keeping tolerance for the legacy `{eventId,…}` JSON so old super-app invitations still resolve.

**A5. RSVP wire format.** Match the standalone (`nostr.ts:283-310`): public kind-31925 / private kind-32069 with `tags: [["d", id], ["a", coordinate], ["status", s], ["p", author], ["start", suggSec]?, ["end", suggSec]?]` and **comment in `content`**. `fetchRsvpsForEvent` parses status + suggested start/end + comment.

---

## Workstream B — RSVP UI (full parity)

Port `RSVPBar` (from `upstream/.../RSVPBar.tsx`) into `components/calendar/RSVPBar.tsx`, restyled monochrome:

- Yes / Maybe / No segmented control (selected = solid `text.primary`).
- Collapsible **"Suggest a new time"** (start/end datetime inputs → `start`/`end` tags only when changed from event times).
- Collapsible **"Add a note"** (→ `content`).
- Organiser can RSVP (no author-only gate).

`EventDetailsDialog` rework:

- Replace the Accept/Maybe/Decline buttons with `RSVPBar`.
- Attendee list (`fetchRsvpsForEvent`) shows each pubkey's **status pill** + suggested time + note.
- Author still sees Edit / Delete; everyone sees the RSVP bar.
- Known limitation (unchanged): private (gift-wrapped) RSVPs are author-decryptable only; the shared attendee view shows public RSVPs.

---

## Workstream C — Delete & manage calendar

**C1. Service:** `deleteCalendarList(coordinate)` — NIP-09 kind-5 with `["k","32123"]` + `["a","32123:pubkey:d"]` (mirror `deleteCalendarEvent`). Store removes the list locally.

**C2. UI:** replace `CreateCalendarDialog` with **`CalendarManageDialog`** (create / edit / delete + name + description + color presets + notifications), mirroring the standalone's dialog. Wired from the left My Calendars panel (each row → edit; dialog → delete with confirm).

---

## Workstream D — Navigation restructure (global)

- **Header.tsx:** add a module tab strip (Forms / Calendar / Pages / Drive / Polls) using `react-router` `NavLink`, active = `text.primary` + subtle `tab-active-bg`. Keep search · theme · AI · avatar on the right.
- **AppShell.tsx:** remove the desktop module rail and its width offset; main content spans full width (still capped at the existing max-width). Mobile: tabs collapse into the existing drawer/menu.
- **Sidebar.tsx:** delete (or reduce to the mobile drawer menu only). `SIDEBAR_WIDTH` references cleaned up.
- This touches every module's chrome only — no module internals.

---

## Workstream E — Calendar UI redesign

`CalendarPage.tsx` stays a thin orchestrator (< 200 LOC). New/!reworked presentational components:

```
components/calendar/
  CalendarSidebar.tsx      REWORK  left "My Calendars" panel: color dots, visibility toggle,
                                   per-row edit (gear), "+ New", "Show all public"
  CalendarHeader (inline)  NEW     ‹ Month YYYY › · Today · [Month|List] · + New Event
  CalendarMonthView.tsx    RESTYLE 6×7 grid, today = filled circle, chips = grey fill +
                                   colored left bar (calendar color), lock icon if private
  CalendarListView.tsx     RESTYLE upcoming grouped by day, same chip language
  EventCard.tsx            RESTYLE chip/row used by both views
  EventDialog.tsx          KEEP    create/edit + Advanced (participants/rrule/tz/form); end optional
  EventDetailsDialog.tsx   REWORK  see Workstream B
  CalendarManageDialog.tsx NEW     see Workstream C
  RSVPBar.tsx              NEW     see Workstream B
  InvitationInbox.tsx      KEEP    banner at top of main column
```

Drop the negative-margin hack in `CalendarPage`. All components presentational (props in, callbacks out); orchestrator owns store interaction. Theme tokens only (no hard-coded hex except calendar colors).

---

## Workstream F — MCP full parity

`packages/mcp/src/tools/calendar.ts`. Read tools + constructive creates ungated; destructive/outward gated behind `--allow-writes` + `confirm:true`.

| Tool                         | Status  | Notes                                             |
| ---------------------------- | ------- | ------------------------------------------------- |
| `list_calendar_events`       | exists  | —                                                 |
| `get_calendar_event`         | exists  | —                                                 |
| `create_calendar_event`      | extend  | full field set incl. viewKey private path         |
| `update_calendar_event`      | exists  | —                                                 |
| `delete_calendar_event`      | exists  | —                                                 |
| `list_calendars`             | exists  | —                                                 |
| `create_calendar`            | exists  | —                                                 |
| `update_calendar`            | **new** | title/color/description/notifications by id       |
| `delete_calendar`            | **new** | gated + confirm; uses `deleteCalendarList`        |
| `add_event_to_calendar`      | **new** | gated; adds `a` ref (incl. viewKey for private)   |
| `remove_event_from_calendar` | **new** | gated; removes `a` ref                            |
| `fetch_event_rsvps`          | extend  | include suggestedStart/End + comment              |
| `list_invitations`           | exists  | —                                                 |
| `rsvp_event`                 | extend  | add `suggestedStart` / `suggestedEnd` / `comment` |
| `attach_form_to_event`       | exists  | —                                                 |

Service helpers added in Workstream A/C back these directly.

---

## Workstream G — Context doc for the calendar repo

`docs/superpowers/specs/2026-06-04-calendar-interop-issues.md` (deliverable, not code in this repo). Contents:

1. Both errors with stack traces + the **reproduction** (super-app event → standalone load).
2. The exact super-app fixes shipped here (A1–A5) and why each belongs to the super-app.
3. **Recommended defensive guards for the standalone** (the "fix later in the main repo" half):
   - `decryptCalendarList`: tolerate / skip non-array payloads without throwing (already caught, but log-only — confirm).
   - `getDetailsFromGiftWrap` & the gift-wrap ingest `onEvent`: wrap in try/catch so a foreign/malformed wrap is skipped, never uncaught.
   - Guard `nip19.decode` callers against values containing `:` (treat as coordinate, not bech32).
4. A wire-format appendix (tag-by-tag) for kinds 32123 / 31923 / 32678 / 31925 / 32069 / 1052 / 1055 so both apps share one reference.

---

## Testing

- **Service** (vitest jsdom, mocked `@formstr/core`): calendar-list codec round-trip vs standalone fixture; viewKey encrypt→gift-wrap→unwrap→decrypt round-trip; `deleteCalendarList` emits `k`+`a`; RSVP encode (status + suggested times + comment) and parse; `extractInvitationFromWrap` reads new + legacy shapes.
- **Components** (@testing-library/react): `RSVPBar` (status submit; suggest-time only when changed; note); `EventDetailsDialog` (author → Edit/Delete; invitee → RSVP; attendee list renders status/note); `CalendarManageDialog` (create/edit/delete callbacks); `CalendarSidebar` (toggle/edit/new); month/list restyle smoke tests.
- **Navigation:** `Header` renders tabs + active state; `AppShell` no longer renders the desktop rail.
- **MCP** (`packages/mcp/test/calendar.test.ts`): one case per new/extended tool incl. the write-gate (`--allow-writes` off → absent; `confirm` required).
- **Coverage gate:** keep `services/calendar/**` ≥ 80% line coverage enforced.

---

## PR decomposition (one spec, ~4 PRs)

1. **Navigation** — navbar tabs + remove rail (global chrome; smallest, unblocks UI).
2. **Interop + private viewKey** — A1–A5 + context doc + tests.
3. **RSVP + delete/manage calendar** — Workstreams B, C.
4. **UI redesign + MCP parity** — Workstreams E, F (UI depends on 1–3 landing).

---

## Out of scope (this cycle)

- Heavy upstream subsystems (scheduling/booking, ICS/device sync, notifications, availability/busy, Week/Day views).
- In-app AI dispatcher (`packages/app/src/ai/**`).
- Private (gift-wrapped) RSVP aggregation in the shared attendee list.

---

## Definition of done

1. CI green (typecheck · lint · test · build) on Node 20 + 22.
2. A super-app-authored event, calendar list, and RSVP all load in calendar.formstr.app **without error**; a standalone-authored private event opens in the super-app (viewKey decrypt).
3. `services/calendar/**` ≥ 80% line coverage, gate enforced.
4. RSVP: Yes/Maybe/No + suggest-time + note + organiser response; attendee list shows status/time/note.
5. Calendars can be created, edited, and **deleted** from the UI and MCP.
6. Module switching is in the navbar; the left module rail is gone; Calendar shows its My Calendars panel.
7. MCP exposes every tool in Workstream F; new/extended tools tested incl. the write-gate.
8. Context doc committed with reproduction + standalone-repo recommendations + wire-format appendix.
