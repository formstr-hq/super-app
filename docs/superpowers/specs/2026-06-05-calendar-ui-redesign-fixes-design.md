# Calendar UI Redesign — Faithful Build + Fixes (Design)

> **Date:** 2026-06-05 · **Branch:** `upstream-week5&6-pr3` · **Status:** approved (visual mockup signed off on localhost:63971)
> Supersedes the visual portion of `2026-06-04-calendar-interop-parity-design.md` Phase 4. Interop / RSVP / MCP work already shipped; this spec covers only the **UI redesign correctness** the user rejected on review.

## Problem

The Phase-4 UI shipped but drifted from the approved monochrome **Option A** mockups (`.superpowers/brainstorm/1534517-1780595462/content/{calendar-aesthetic,calendar-dialogs}.html`). On review the user rejected it for three concrete reasons, plus one new constraint:

1. **Not full-bleed / wasted space.** The calendar renders inside `AppShell`'s centered, capped wrapper (`mx:auto; maxWidth:1280px; px; py:3` in `layout/AppShell.tsx:92`), so on wide screens it floats in the middle with a large empty band on the right and the month grid never fills the viewport height.
2. **Sidebar doesn't read as a sidebar.** `CalendarSidebar` has no panel surface and isn't full-height, so "My Calendars" looks like floating text rather than a flush-left rail.
3. **Invitations dump inline.** `InvitationInbox` is rendered at the top of the main column (`pages/CalendarPage.tsx`) and expands to list every pending invite (17 in the user's account), shoving the actual calendar off-screen. Invitations should be reachable **from the rail on demand**, not shown by default.
4. **(New) AI panel coexistence.** When the right-docked **AI Chat panel** is opened (`AppShell` sets `mr: aiPanelOpen ? 380px`), the full-bleed calendar must **reflow into the remaining width** — never get covered or overflow. This is the explicit acceptance criterion the user added at approval.

The three dialogs also need to match the signed-off mockups (Event details + RSVP is the one with real drift; Create/Edit and Manage are close).

## Approved design (what we're building)

Monochrome **Option A** applied faithfully to the calendar.formstr.app layout, as shown and approved at `localhost:63971` (`.superpowers/brainstorm/2006474-1780617058/content/calendar-final-ui.html`):

- **Full-bleed calendar surface** that fills the main content column (which already accounts for the AI panel via `mr`).
- **Left rail** = flush-left, full-height panel (`bgcolor` panel tone + right border): an **Invitations** entry with a pending-count badge at the top, a divider, the **My Calendars** list (square-rounded color dot · name · visibility toggle · edit gear on hover · "+ New"), a divider, and **Show all public**.
- **Invitations open as a main-panel view** (locked decision): default view is the calendar; clicking **Invitations** swaps the main panel to the invitation list with full Accept / Maybe / Decline per row and a "← Back to calendar" affordance. Not a drawer, not a popup.
- **Month grid fills height**: CSS grid with `gridAutoRows: 1fr`, bordered cells, dimmed adjacent-month cells, weekday header row, today = filled circle, chips = grey fill + 3px colored left bar + muted time prefix.
- **Three dialogs** matched to the mockups. Manage-calendar **omits the static mockup's "Notifications" dropdown** (notifications are out of scope — locked decision).

## Architecture & components

### 1. Full-bleed route shell (`layout/AppShell.tsx`)

The centered wrapper is right for Forms/Pages/Drive/Polls but wrong for Calendar. Make the content container **opt-out per route**:

- Detect the calendar route (e.g. `useLocation().pathname.startsWith("/calendar")`) → render `<Outlet/>` **without** the `maxWidth/px/py` wrapper, inside a full-height flex box (`display:flex; flexDirection:column; flex:1; minHeight:0`).
- All other routes keep the existing centered container unchanged.
- The existing `<main sx={{ flex:1, overflow:auto }}>` and the parent column's `mr: aiPanelOpen ? 380px` are **kept as-is** — that margin is exactly what makes the calendar reflow when the AI panel opens. The calendar must therefore size to **100% of its container**, never `100vw` or `position:fixed`, so it inherits the shrink for free.

### 2. `CalendarSidebar` → real rail (`components/calendar/CalendarSidebar.tsx`)

- Full-height panel: `bgcolor` = panel tone (theme `action.hover`/`background.default` per mode), `borderRight`, flush-left, `display:{xs:none, sm:flex}; flexDirection:column`.
- New top section: an **Invitations** nav row — envelope icon · "Invitations" · count badge (pending count from `useInvitationsStore`). `active` styling (filled) when the invitations view is open. New props: `pendingInvitations: number`, `view: "calendar" | "invitations"`, `onOpenInvitations()`, `onShowCalendar()`.
- Existing My-Calendars rows keep dot/name/toggle/edit-gear; dots become **rounded-square** (`borderRadius: "3px"`) per the mockup.
- Keep divider + "Show all public".

### 3. Invitations as a view (`components/calendar/InvitationInbox.tsx` → split)

- Extract the row list + RSVP logic into an exported **`InvitationsView`** (the `InvitationRow` map, Accept/Maybe/Decline wired to `rsvpToEvent` + `useInvitationsStore.markRsvp`), rendered as a full-panel list with an `Invitations · N` header and a "← Back to calendar" button (calls `onBack`). Empty state: "No pending invitations."
- The pending **count** is read by `CalendarPage`/`CalendarSidebar` from `useInvitationsStore` for the badge.
- Delete the inline `<InvitationInbox/>` usage at the top of the calendar main column.

### 4. `CalendarPage` orchestrator (`pages/CalendarPage.tsx`)

- Add `view: "calendar" | "invitations"` state (default `"calendar"`).
- Render full-height: root `Box sx={{ display:flex; height:"100%"; minHeight:0 }}` → rail + main; main is `flex:1; minWidth:0; display:flex; flexDirection:column; minHeight:0`.
- When `view==="invitations"` render `<InvitationsView onBack={() => setView("calendar")} />` in the main panel; else render `CalendarHeader` + month/list.
- Wire sidebar `pendingInvitations`, `onOpenInvitations`, `onShowCalendar`. Keep < 200 LOC (extract if needed).

### 5. Month grid fills height (`components/calendar/CalendarMonthView.tsx`)

- Container `flex:1; minHeight:0; display:flex; flexDirection:column`; grid `flex:1; display:grid; gridTemplateColumns:repeat(7,1fr); gridAutoRows:1fr`. Cells size to the row; keep the existing weekday header, dim adjacent-month cells, today filled circle, and the (already shipped) grey-chip + colored-left-bar + time styling.

### 6. `EventDetailsDialog` restyle (`components/calendar/EventDetailsDialog.tsx`)

- Replace separate Start/End rows with a single **When** row (`Thu, Jun 4 · 9:00–9:30 AM`), keep **Where**, add a **Calendar** row with the calendar's color dot + name (lookup via `calendars` prop, new).
- Attendees: avatar bubble (initial) + name/npub + status **pill** (filled black for accepted), with comment + suggested-time beneath — replacing the monospace + MUI `Chip` rows. Keep author Delete/Edit; everyone keeps the `RSVPBar`.

### 7. Minor: `EventDialog` (`components/calendar/EventDialog.tsx`)

- Drop the "Schedule an event on the Nostr network." subtitle; render a color dot beside each calendar option in the Calendar select. Structure otherwise already matches (Title · Start/End · Location · Description · Calendar · Private+lock · Advanced).

## Data flow

`useInvitationsStore` (already started in `AppShell` on login) → pending count + list → `CalendarSidebar` badge / `InvitationsView`. RSVP actions reuse `rsvpToEvent` + `markRsvp` (unchanged). Calendar membership/visibility filtering (`lib/calendarMembership.ts`) is unchanged. No service, store-shape, or wire-format changes — this is presentation-only.

## Testing

- `CalendarSidebar`: renders Invitations row with badge count; `onOpenInvitations` fires on click; gear/toggle/new still fire.
- `InvitationsView`: renders pending rows; Accept calls `rsvpToEvent(coord,"accepted",…)` + `markRsvp`; `onBack` fires; empty state shows.
- `CalendarPage`: default shows the grid (no invitation list); opening invitations swaps the panel; back returns. (jsdom can't assert full-bleed pixels — those are verified live.)
- `EventDetailsDialog`: shows When/Where/Calendar rows + a colored calendar dot; attendee pill + comment + suggested time.
- Existing month/list/EventCard/manage/RSVP tests stay green.
- **Live (manual) acceptance:** on desktop, opening the AI panel shrinks the calendar to the remaining width with the grid intact and nothing clipped; closing restores full width.

## Out of scope (unchanged from parity spec)

Notifications, Week/Day views, scheduling/booking, ICS/device sync, busy lists. Month + List only.

## Locked decisions

- Invitations = **main-panel view** (not drawer/popup).
- Manage-calendar dialog **omits** the Notifications dropdown.
- Aesthetic = **Option A monochrome**, faithful to the approved mockups.
- AI-panel coexistence via container-relative sizing (no `100vw`/`fixed`); the existing `mr:380px` does the reflow.
