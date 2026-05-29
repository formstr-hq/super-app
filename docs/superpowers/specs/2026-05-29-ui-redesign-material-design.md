# UI Redesign: Material UI + Notion-Inspired Design System

**Date:** 2026-05-29  
**Status:** Approved  
**Branch target:** upstream `main`

---

## Overview

Complete UI overhaul of `@formstr/app`: replace Tailwind CSS + shadcn/ui (Radix UI) with Material UI v6, and adopt a clean Notion-inspired visual language — cool minimal palette, compact sidebar, standard topbar, list/grid toggle for content pages.

This PR ships before Weeks 3 & 4 (forms service implementation) so the design system is stable before new pages are added.

---

## Design Decisions

| Decision          | Choice                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Palette           | Cool Minimal — #F5F5F5 sidebar, #FFFFFF content, #EBEBEB borders     |
| Header            | Standard 48px topbar — breadcrumb + search pill + AI toggle + avatar |
| Dark mode         | Yes — #1E1E1E sidebar, #141414 content, #2A2A2A borders              |
| Content layout    | List view default + list/grid toggle                                 |
| Component library | Material UI v6 only (no Tailwind, no Radix UI)                       |
| Typography        | Inter, `-0.02em` tracking on headings, 14px base                     |
| Icons             | lucide-react (keep — no change)                                      |

---

## What Gets Removed

- `tailwindcss` and `@tailwindcss/vite` — removed from deps and `vite.config.ts`
- `@radix-ui/*` — all 13 Radix UI packages removed from `package.json`
- `class-variance-authority`, `tailwind-merge`, `clsx` — removed
- `cmdk` — replaced by MUI Autocomplete + Dialog for command palette
- `sonner` — replaced by MUI Snackbar + notistack (or MUI's own toast pattern)
- `components/ui/` directory — all 17 shadcn wrapper components deleted
- `components.json` — shadcn config deleted
- `@theme` / `@theme inline` blocks in `index.css` — replaced with MUI theme tokens
- All Tailwind utility classes (`className="flex items-center gap-2 ..."`) removed from every component

---

## What Gets Added

- `@mui/material` v6
- `@mui/icons-material` (optional — lucide-react is already present, MUI icons only if needed)
- `@emotion/react` and `@emotion/styled` (MUI peer deps)
- `notistack` for toast notifications (wraps MUI Snackbar, matches sonner's API surface)

---

## Design Tokens (MUI Theme)

### Light mode

```
background.default:  #FFFFFF
background.paper:    #F5F5F5  (sidebar, cards, dialogs)
text.primary:        #111111
text.secondary:      #888888
divider:             #EBEBEB
primary.main:        #111111
primary.contrastText:#FFFFFF
```

### Dark mode

```
background.default:  #141414
background.paper:    #1E1E1E
text.primary:        #E5E5E5
text.secondary:      #666666
divider:             #2A2A2A
primary.main:        #E5E5E5
primary.contrastText:#111111
```

### Shared

```
shape.borderRadius:  6
typography.fontFamily: 'Inter', system-ui, sans-serif
typography.fontSize:   14
typography.h1–h6:    fontWeight 700, letterSpacing -0.02em
```

The MUI `ThemeProvider` wraps the entire app. `useSettingsStore` already tracks `theme: 'light' | 'dark'`; we derive the MUI `mode` from that.

---

## Architecture

### Theme

**New file: `src/theme.ts`** (replaces current near-empty file)

```ts
createTheme({ palette: { mode }, ... })
```

Exports `getTheme(mode: 'light' | 'dark')`. `main.tsx` wraps `<App>` in `<ThemeProvider theme={getTheme(mode)}>`.

### Layout

**`src/layout/AppShell.tsx`** — replaces className-based flex layout with MUI `Box`. Uses MUI `Drawer` for mobile overlay sidebar (replaces shadcn `Sheet`).

**`src/layout/Sidebar.tsx`** — MUI `List` + `ListItemButton` + `ListItemIcon` + `ListItemText`. Collapse behavior keeps existing `sidebarCollapsed` from `useSettingsStore`. MUI `Tooltip` replaces Radix Tooltip for collapsed icon mode.

**`src/layout/Header.tsx`** — MUI `AppBar` (position `sticky`, elevation `0`, custom border-bottom) + `Toolbar`. Search becomes a styled MUI `InputBase` inside a pill container. User menu uses MUI `Menu` + `MenuItem`. Theme toggle and AI sparkle stay as MUI `IconButton`.

### Global styles (`src/index.css`)

Remove all Tailwind imports and `@theme` blocks. Keep:

- Google Fonts import (Inter)
- Scrollbar styles
- TipTap / ProseMirror prose styles (unchanged — MUI doesn't affect these)
- `box-sizing: border-box` reset

MUI's `CssBaseline` handles body background, font, antialiasing.

### Components

All files under `src/components/ui/` are **deleted**. Imports throughout the codebase are updated to MUI equivalents:

| shadcn component                         | MUI replacement                                           |
| ---------------------------------------- | --------------------------------------------------------- |
| `Button`                                 | `Button` from `@mui/material`                             |
| `Input`                                  | `TextField` (outlined, size small) or `InputBase`         |
| `Dialog / DialogContent / DialogHeader`  | `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` |
| `Card / CardContent`                     | `Paper` (elevation 0, outlined variant)                   |
| `Badge`                                  | `Chip` (size small)                                       |
| `Select / SelectTrigger / SelectContent` | `Select` + `MenuItem` from MUI                            |
| `Checkbox`                               | `Checkbox` from MUI                                       |
| `RadioGroup / RadioGroupItem`            | `RadioGroup` + `Radio` from MUI                           |
| `Label`                                  | `FormLabel` or `Typography variant="caption"`             |
| `Separator`                              | `Divider` from MUI                                        |
| `Skeleton`                               | `Skeleton` from MUI                                       |
| `Tooltip`                                | `Tooltip` from MUI                                        |
| `ScrollArea`                             | native `overflow: auto` + CSS scrollbar styling           |
| `Sheet`                                  | MUI `Drawer`                                              |
| `Tabs / TabsList / TabsTrigger`          | MUI `Tabs` + `Tab`                                        |
| `Avatar`                                 | MUI `Avatar`                                              |
| `Popover`                                | MUI `Popover`                                             |
| `DropdownMenu`                           | MUI `Menu` + `MenuItem`                                   |
| `Command` (cmdk)                         | MUI `Autocomplete` inside a `Dialog`                      |

### Pages — content layout

All 5 pages (Forms, Calendar, Pages, Drive, Polls) get a shared `ListGridToggle` pattern:

- A `ToggleButtonGroup` in the page header with list/grid icons
- Default view: **list** — MUI `Table` (TableHead + TableBody + TableRow + TableCell), no borders except header divider, hover background
- Grid view: MUI `Grid` 3-column, each item a `Paper` card (elevation 0, outlined)
- The toggle state lives locally in each page via `useState`

### Command Palette (`CommandPalette.tsx`)

Replaces `cmdk` with a MUI `Dialog` (fullWidth, maxWidth `sm`) containing a sticky `InputBase` at the top and a scrollable `List` of filtered results below. Keyboard navigation handled manually with `onKeyDown`.

### Toast notifications

Replace `sonner` `<Toaster>` with `notistack`'s `<SnackbarProvider>` wrapping the app. Call `enqueueSnackbar(message, { variant })` everywhere a toast is currently triggered. `notistack` uses MUI `Snackbar` under the hood so it respects the MUI theme.

### AI Chat Panel (`AIChatPanel.tsx`)

MUI `Box` + `Paper` for the panel container. Message bubbles use `Paper` with `elevation={0}` and `variant="outlined"`. Input area uses MUI `TextField` multiline. No structural change to the AI logic.

---

## File Change Summary

| Action  | Files                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Delete  | `src/components/ui/` (17 files), `components.json`, `src/lib/utils.ts` (`cn` helper)                               |
| Rewrite | `src/theme.ts`, `src/index.css`, `src/main.tsx`                                                                    |
| Rewrite | `src/layout/AppShell.tsx`, `Sidebar.tsx`, `Header.tsx`                                                             |
| Rewrite | All 5 page files (`FormsPage`, `CalendarPage`, `PagesPage`, `DrivePage`, `PollsPage`)                              |
| Rewrite | `src/components/LoginDialog.tsx`, `CommandPalette.tsx`, `ThemeToggle.tsx`                                          |
| Rewrite | `src/components/ai/AIChatPanel.tsx`, `MessageBubble.tsx`, `EntityCard.tsx`, `AIPendingRow.tsx`, `ToolCallChip.tsx` |
| Rewrite | `src/components/forms/FieldInput.tsx`, `FormAnalytics.tsx`                                                         |
| Rewrite | `src/components/calendar/InvitationInbox.tsx`, `RRuleBuilder.tsx`, `TimezonePicker.tsx`                            |
| Rewrite | `src/components/pages/RichEditor.tsx`                                                                              |
| Rewrite | `src/components/EntityPill.tsx`, `MentionPicker.tsx`                                                               |
| Update  | `package.json` — add MUI, remove Tailwind/Radix/shadcn deps                                                        |
| Update  | `vite.config.ts` — remove `@tailwindcss/vite` plugin                                                               |

---

## Commit Strategy (multiple commits, single PR)

1. **`chore: remove tailwind and shadcn dependencies`** — `package.json`, `vite.config.ts`, delete `components.json` and `src/components/ui/`
2. **`feat: add mui theme and global styles`** — `src/theme.ts`, `src/index.css`, `src/main.tsx`
3. **`feat: redesign app shell — sidebar and header`** — `AppShell.tsx`, `Sidebar.tsx`, `Header.tsx`
4. **`feat: redesign forms page with list/grid toggle`** — `FormsPage.tsx`, `FieldInput.tsx`, `FormAnalytics.tsx`
5. **`feat: redesign calendar, pages, drive, polls pages`** — remaining page files
6. **`feat: redesign dialogs — login, command palette`** — `LoginDialog.tsx`, `CommandPalette.tsx`
7. **`feat: redesign ai panel and misc components`** — AI components, `EntityPill.tsx`, `MentionPicker.tsx`, `ThemeToggle.tsx`, calendar sub-components

The final commit of the PR must be buildable (TypeScript passes, no broken imports). Intermediate commits may have type errors while the migration is in progress — that is acceptable as long as the branch tip is clean.

---

## Testing

- `pnpm test` must pass across `@formstr/core` and `@formstr/app` after all changes (67 tests currently passing)
- No new tests required — this is a pure UI replacement with no logic changes
- Visual verification: run `pnpm dev` and check each page in light + dark mode

---

## Non-goals

- No new features
- No changes to Nostr/relay logic, stores, or services
- No Ant Design in this PR (optional for later)
- No animation library additions
- No font changes (Inter stays)
