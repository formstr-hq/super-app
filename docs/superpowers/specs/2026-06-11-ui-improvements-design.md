# UI Improvement Pass — Design

**Date:** 2026-06-11 · **Branch:** `upstream-parity-fixes` · **Status:** approved by user
(visual-companion session; all six proposals ticked).

## Goal & non-goals

Fix the two user-named pain points — "generic / unpolished" and "poor
discoverability" — **without** changing the design language or restructuring any
page. The current monochrome system stays exactly as is: Inter, black-on-white
(`#111` primary), `#F5F5F5` paper, `#EBEBEB` dividers, 6px radius, outlined
lucide icons, MUI v6 via `theme.ts`.

Non-goals: new theme/palette, navigation changes, new pages, stack changes,
mobile restructuring (rail drawers from `e405cfd` stay as-is).

Workflow constraints (standing): store/service changes TDD'd; **no new frontend
component tests**; commit per feature-set; no push/PR.

## 1 · Real identity in the chrome

Kind-0 profiles are fetched by `@formstr/agent` `services/profile` (used in
Settings since `b85f61c`) but the app chrome shows a blank gray `<Avatar />`.

- **authStore** gains `profile: UserProfile | null` + internal load on
  login/restore (and clear on logout), calling `fetchProfile(pubkey)`
  best-effort. TDD in `authStore.test.ts` (mock the profile service).
- New `components/AccountMenu.tsx`: avatar button (picture, else initial of
  display name, else gradient initial from npub) + display name (desktop only)
  - chevron. Menu: header block (name, truncated npub with copy via
    `lib/clipboard`), "Profile & settings" → `/settings`, "Switch account" →
    login dialog, "Log out" (error color).
- `Header.tsx` (both desktop and mobile slots) and `Sidebar.tsx` bottom block
  render `AccountMenu` instead of bare `<Avatar />` + raw pubkey.

## 2 · Labeled actions instead of icon strips

- **FormCard**: the icon-button strip becomes three compact text buttons —
  `Fill`, `Responses`, `Share` — plus a `⋯` overflow menu (Edit, Copy link,
  Delete). Small `size="small"` outlined buttons, 11.5–12px, current borders.
- **FormListView** rows: the same three labeled actions, always visible at the
  row end on `sm`+; on `xs` they collapse into the overflow menu.
- **Drive `FileList`** rows: `Download` becomes a labeled button, always
  visible (no hover-reveal); Rename/Move/Delete stay in the existing menu.
- Pages/Polls sidebars unchanged (rows are pure navigation).

## 3 · Shared empty states

New `components/EmptyState.tsx`:

```tsx
<EmptyState
  icon={BarChart3}          // LucideIcon
  title="No polls yet"
  description="Ask a question, share it on Nostr, watch live results roll in."
  actionLabel="+ New poll"  onAction={...}      // optional
  aiHint="or ask the AI to draft one"           // optional; opens AI panel
/>
```

Centered block: 38px icon tile on `#F5F5F5`, 13px semibold title, 12px gray
description (max ~360px), contained primary action, AI hint as underlined
text-button that calls `settingsStore.setAIPanelOpen(true)`.

Applied to: Forms (my-forms empty + `CategoryEmpty`), Polls (no polls / no
selection), Pages (empty mode), Drive (drop-zone empty, merged with existing
copy), Calendar list view (no events), InvitationsView, BookingsView,
AvailabilityView (no ranges), ResponsesDialog (no responses),
PageCommentsPanel (no comments). Copy per surface written during
implementation, one line each, no marketing fluff.

## 4 · Skeleton loading

Match Drive's existing skeleton pattern everywhere a relay fetch currently
shows a spinner or blank pane:

- Forms grid: 6 card-shaped skeletons (title line, meta line, action bar
  block). Forms list view: 6 row skeletons.
- Polls sidebar lists + poll detail header.
- Pages sidebar list.
- Calendar list view rows (month grid keeps its instant render).
- Implemented with MUI `<Skeleton variant="text|rounded">` inline per surface
  (no shared abstraction needed beyond consistent sizing).

Spinners remain for in-flight _actions_ (submitting, publishing) — only
_initial loads_ become skeletons.

## 5 · Self-describing page headers

New `components/PageHeader.tsx`: `title`, `description` (one line, 12.5px
gray, hidden on xs), optional `action` node pinned right. Rendered at the top
of each module's main pane:

| Page     | Description line                                                                                     | Action      |
| -------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| Forms    | Encrypted surveys on Nostr — share a link, collect answers only you can read.                        | + New form  |
| Calendar | Private events, invitations, and booking pages — busy times publish automatically for booking links. | + New event |
| Pages    | Encrypted Markdown docs with shareable view/edit links and inline comments.                          | + New page  |
| Drive    | End-to-end-encrypted files on Blossom servers, indexed on relays.                                    | Upload      |
| Polls    | Public Nostr polls with live tallies and optional proof-of-work gates.                               | + New poll  |

Existing per-page toolbars stay; the header sits above them (Forms' current
title row is replaced by it). Sub-views (Invitations, Bookings, Availability,
editor surfaces) keep their own back-button headers.

## 6 · Shortcut & AI discoverability

- New `components/ShortcutsDialog.tsx` listing: ⌘K command palette, ⌘S save
  page, `/keyword` saved AI prompts, `?` this dialog. Static two-column rows,
  monospace kbd chips on `#F5F5F5`.
- `AppShell` keydown listener: `?` opens it (ignored while focus is in an
  input/textarea/contenteditable, mirroring the ⌘K hook's guard).
- AI panel input placeholder → “Ask anything — type / for saved prompts”.
- Command palette gets a "Keyboard shortcuts" entry; the mobile header keeps
  its palette icon (verified present) — no change needed there beyond the
  dialog entry.

## Testing & gating

- TDD: authStore profile loading; any store logic added for empty-state AI
  hints (none expected beyond existing `setAIPanelOpen`).
- No new component tests (standing directive). Existing suites must stay
  green: full gate `pnpm -r test && pnpm -r typecheck && pnpm -r build`.
- Commit boundaries: (1) identity, (2) labeled actions, (3) empty states +
  skeletons, (4) page headers + shortcuts. Adjust if natural.

## Risks

- `AccountMenu` touches login/logout flows — keep authStore API additive.
- FormCard/FileList action changes must not drop any existing capability
  (everything currently reachable stays reachable, some behind `⋯`).
