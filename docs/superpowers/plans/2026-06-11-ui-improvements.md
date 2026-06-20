# UI Improvement Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six approved UI improvements (spec: `docs/superpowers/specs/2026-06-11-ui-improvements-design.md`) — chrome identity, labeled actions, shared empty states, skeletons, page headers, shortcuts dialog — without changing the design language.

**Architecture:** All work is in `@formstr/app`. One store change (authStore gains kind-0 `profile`, TDD'd); everything else is component work reusing the existing theme tokens. Three new shared components (`AccountMenu`, `EmptyState`, `ShortcutsDialog`, plus `PageHeader`), then surface-by-surface adoption.

**Tech Stack:** React 19, MUI v6, Zustand v5, lucide-react, Vitest (jsdom). Repo: `super-app/` pnpm monorepo; run all commands from `super-app/`.

**Standing rules:** store changes TDD; NO new frontend component tests; pre-commit hook runs eslint+prettier (on `gpg: signing failed: Timeout` retry `git commit --no-verify`); never push.

**Verified-already-done (do NOT re-add):** the AI panel input placeholder already reads "Ask something… ( / for saved prompts)" (`AIChatPanel.tsx:404`) — spec item 6's placeholder bullet is satisfied; only the dialog + hotkey + palette entry remain.

---

### Task 1: authStore kind-0 profile (TDD)

**Files:**

- Modify: `packages/app/src/stores/authStore.ts`
- Test: `packages/app/src/stores/authStore.test.ts`

The store already syncs accounts from `appSigner` via an internal `sync()`. Add a `profile` field loaded best-effort from `@formstr/agent/services/profile` whenever the active pubkey changes, cleared on logout.

- [ ] **Step 1: Write the failing test**

`authStore.test.ts` already mocks `../auth/appSigner` (hoisted `signerState`/`emit`) and `@formstr/core`. Add a mock for the profile service next to the existing `vi.mock("@formstr/core", …)` line:

```ts
vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn(async (pubkey: string) => ({
    pubkey,
    displayName: "Naman",
    picture: "https://example.com/p.jpg",
    createdAt: 1,
  })),
}));
```

Import it with the other imports: `import * as profileService from "@formstr/agent/services/profile";`

Append a new describe block at the end of the file:

```ts
describe("kind-0 profile in authStore", () => {
  it("loads the active account's profile after login and clears it on logout", async () => {
    await useAuthStore.getState().loginWithExtension();
    // fetchProfile is fire-and-forget; flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(profileService.fetchProfile).toHaveBeenCalledWith("extPk");
    expect(useAuthStore.getState().profile?.displayName).toBe("Naman");

    signerState.accounts = [];
    signerState.active = null;
    signerState.unlocked = false;
    emit({ type: "logout" });
    expect(useAuthStore.getState().profile).toBeNull();
  });

  it("does not refetch the profile on a sync that keeps the same pubkey", async () => {
    await useAuthStore.getState().loginWithExtension();
    await new Promise((r) => setTimeout(r, 0));
    (profileService.fetchProfile as any).mockClear();

    emit({ type: "unlock" }); // any change event with the same active pubkey
    await new Promise((r) => setTimeout(r, 0));
    expect(profileService.fetchProfile).not.toHaveBeenCalled();
  });
});
```

Note: the existing tests reset state in `beforeEach` — check the existing `beforeEach` and add `profile: null` to its `useAuthStore.setState({...})` call if it resets fields explicitly, and reset the module-level guard by also emitting a logout. If `loginWithExtension` requires `init()` first in the existing tests, mirror what `describe("authStore bridge")` does.

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @formstr/app test -- src/stores/authStore.test.ts`
Expected: FAIL — `profile` is undefined on the store.

- [ ] **Step 3: Implement**

In `authStore.ts`:

```ts
import { fetchProfile, type NostrProfile } from "@formstr/agent/services/profile";
```

Interface additions (in `interface AuthStore`):

```ts
/** Kind-0 profile of the active account (best-effort; null when logged out). */
profile: NostrProfile | null;
```

Initial state: `profile: null,` next to `pubkey: null`.

In the store factory, above `function sync()`, add a module-scope guard inside the closure:

```ts
let profileLoadedFor: string | null = null;
```

In `sync()`, in the `if (active)` branch (after the existing `set({ ... })`):

```ts
if (active.pubkey !== profileLoadedFor) {
  profileLoadedFor = active.pubkey;
  void fetchProfile(active.pubkey)
    .then((profile) => {
      // The account may have changed while fetching.
      if (get().pubkey === active.pubkey) set({ profile });
    })
    .catch(() => {});
}
```

In the `else` branch (logged out), extend the existing `set(...)`:

```ts
profileLoadedFor = null;
set({ accounts, pubkey: null, method: null, isLoggedIn: false, locked: false, profile: null });
```

- [ ] **Step 4: Run, verify green**

Run: `pnpm --filter @formstr/app test -- src/stores/authStore.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/stores/authStore.ts packages/app/src/stores/authStore.test.ts
git commit -m "auth: load the active account's kind-0 profile into authStore"
```

---

### Task 2: AccountMenu component, wired into Header + Sidebar

**Files:**

- Create: `packages/app/src/components/AccountMenu.tsx`
- Modify: `packages/app/src/layout/Header.tsx` (user section, lines ~195–274)
- Modify: `packages/app/src/layout/Sidebar.tsx` (bottom user area, lines ~144–177)

The Header already has an inline account menu (raw-pubkey rows, Add account, Settings, Log out). Extract it into `AccountMenu`, enriched with the new `profile` (picture, display name, copyable npub).

- [ ] **Step 1: Create `AccountMenu.tsx`**

```tsx
import { Avatar, Box, Divider, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import { Check, ChevronDown, Copy, Lock, LogOut, Plus, Settings } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { copyText } from "../lib/clipboard";
import { useAuthStore } from "../stores";

function npubOf(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

const shorten = (s: string) => `${s.slice(0, 10)}…${s.slice(-4)}`;

interface AccountMenuProps {
  /** "header": avatar + name + chevron. "sidebar": full-width row. */
  variant?: "header" | "sidebar";
}

/** Account chip + menu: kind-0 identity, copyable npub, account switching, logout. */
export function AccountMenu({ variant = "header" }: AccountMenuProps) {
  const { accounts, pubkey, profile, switchAccount, logout, openAuthModal } = useAuthStore();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  if (!pubkey) return null;
  const npub = npubOf(pubkey);
  const displayName = profile?.displayName ?? profile?.name ?? shorten(npub);
  const close = () => setAnchorEl(null);

  const handleCopy = () => {
    void copyText(npub).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const avatar = (
    <Avatar src={profile?.picture} sx={{ width: 26, height: 26, fontSize: 11 }}>
      {displayName.slice(0, 1).toUpperCase()}
    </Avatar>
  );

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
        aria-label="Account menu"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          width: variant === "sidebar" ? "100%" : "auto",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
          color: "text.primary",
          borderRadius: 1,
          px: variant === "sidebar" ? 1 : 0.5,
          py: 0.5,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        {avatar}
        <Typography
          variant="body2"
          fontWeight={550}
          noWrap
          sx={{
            maxWidth: 140,
            display: variant === "header" ? { xs: "none", md: "block" } : "block",
          }}
        >
          {displayName}
        </Typography>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        PaperProps={{ sx: { minWidth: 220, mt: 0.5 } }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {/* Identity block */}
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {displayName}
          </Typography>
          <Box
            onClick={handleCopy}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: "pointer",
              color: "text.secondary",
              "&:hover": { color: "text.primary" },
            }}
          >
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              {shorten(npub)}
            </Typography>
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </Box>
        </Box>
        <Divider />

        {accounts.length > 1 && [
          ...accounts.map((acc) => (
            <MenuItem
              key={acc.pubkey}
              dense
              selected={acc.pubkey === pubkey}
              onClick={() => {
                if (acc.pubkey !== pubkey) void switchAccount(acc.pubkey);
                close();
              }}
              sx={{ gap: 1, fontSize: 12.5, fontFamily: "monospace" }}
            >
              {acc.locked && <Lock size={12} />}
              {shorten(acc.npub)}
            </MenuItem>
          )),
          <Divider key="acc-div" />,
        ]}

        <MenuItem
          dense
          onClick={() => {
            openAuthModal("login");
            close();
          }}
          sx={{ gap: 1.5, fontSize: 13 }}
        >
          <Plus size={14} />
          Add account
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            navigate("/settings");
            close();
          }}
          sx={{ gap: 1.5, fontSize: 13 }}
        >
          <Settings size={14} />
          Profile &amp; settings
        </MenuItem>
        <Divider />
        <MenuItem
          dense
          onClick={() => {
            void logout();
            close();
          }}
          sx={{ gap: 1.5, fontSize: 13, color: "error.main" }}
        >
          <LogOut size={14} />
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
```

- [ ] **Step 2: Wire into `Header.tsx`**

Replace the entire logged-in user block (the `{isLoggedIn ? (<> <IconButton…Avatar… <Menu…/Menu> </>) : …}` section, currently lines ~196–274) with:

```tsx
{
  isLoggedIn ? (
    <AccountMenu />
  ) : (
    <IconButton size="small" onClick={onLoginClick} sx={{ color: "text.secondary", ml: 0.5 }}>
      <Avatar sx={{ width: 26, height: 26, fontSize: 11 }} />
    </IconButton>
  );
}
```

Add `import { AccountMenu } from "../components/AccountMenu";` and delete now-unused state (`anchorEl`/`setAnchorEl` if only the menu used it), store selectors (`accounts`, `switchAccount`, `logout`, `openAuthModal`, `navigate` — ONLY if unused elsewhere in the file), and icon imports (`Lock`, `Plus`, `Settings`, `LogOut`, `Menu`, `MenuItem`, `Divider` — same caveat). Run typecheck to catch leftovers.

- [ ] **Step 3: Wire into `Sidebar.tsx`**

Replace the logged-in branch of the bottom user area (currently `<Avatar …/> + shortPubkey`) with:

```tsx
        {isLoggedIn ? (
          <AccountMenu variant="sidebar" />
        ) : … (keep the existing collapsed/Sign In branches unchanged)
```

Add the import; remove `shortPubkey` and the `Avatar` import if now unused.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`
Expected: typecheck clean; all tests pass (Header/Sidebar have no component tests asserting the old menu — `Header.test.tsx`/`Sidebar.test.tsx` exist; if they assert removed markup, update those assertions minimally).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src
git commit -m "app: account menu with kind-0 identity in header and sidebar"
```

---

### Task 3: Labeled form actions (FormActions → FormCard + list rows)

**Files:**

- Modify: `packages/app/src/components/forms/FormActions.tsx` (rewrite)
- Modify: `packages/app/src/components/forms/FormCard.tsx` (replace inline icon strip)

`FormActions` is the shared action row. Rewrite it as labeled buttons + overflow; FormCard switches to it (its current inline strip duplicates the same five actions).

- [ ] **Step 1: Rewrite `FormActions.tsx`**

```tsx
import type { FormSummary } from "@formstr/agent/services/forms/types";
import { Button, IconButton, ListItemIcon, Menu, MenuItem, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { BarChart3, Link, MoreHorizontal, Pencil, TextCursorInput, Trash2 } from "lucide-react";
import { useState } from "react";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onEdit?: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
}

const btnSx = {
  fontSize: 12,
  px: 1,
  py: 0.25,
  minWidth: 0,
  color: "text.primary",
  borderColor: "divider",
} as const;

/**
 * Labeled Fill / Responses / Share actions + a ⋯ overflow (Edit, Delete).
 * On xs everything collapses into the overflow menu.
 */
export function FormActions({
  form,
  onFill,
  onEdit,
  onViewResponses,
  onDelete,
  onCopyLink,
}: Props) {
  const theme = useTheme();
  const xs = useMediaQuery(theme.breakpoints.down("sm"));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const close = () => setAnchorEl(null);
  const run = (fn: (f: FormSummary) => void) => {
    fn(form);
    close();
  };

  return (
    <>
      {!xs && (
        <>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={btnSx}
            onClick={() => onFill(form)}
          >
            Fill
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={btnSx}
            onClick={() => onViewResponses(form)}
          >
            Responses
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={btnSx}
            onClick={() => onCopyLink(form)}
          >
            Share
          </Button>
        </>
      )}
      <IconButton
        size="small"
        aria-label="More actions"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreHorizontal size={15} />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        {xs && (
          <MenuItem dense onClick={() => run(onFill)}>
            <ListItemIcon>
              <TextCursorInput size={14} />
            </ListItemIcon>
            Fill
          </MenuItem>
        )}
        {xs && (
          <MenuItem dense onClick={() => run(onViewResponses)}>
            <ListItemIcon>
              <BarChart3 size={14} />
            </ListItemIcon>
            Responses
          </MenuItem>
        )}
        {xs && (
          <MenuItem dense onClick={() => run(onCopyLink)}>
            <ListItemIcon>
              <Link size={14} />
            </ListItemIcon>
            Copy link
          </MenuItem>
        )}
        {onEdit && (
          <MenuItem dense onClick={() => run(onEdit)}>
            <ListItemIcon>
              <Pencil size={14} />
            </ListItemIcon>
            Edit
          </MenuItem>
        )}
        {!xs && (
          <MenuItem dense onClick={() => run(onCopyLink)}>
            <ListItemIcon>
              <Link size={14} />
            </ListItemIcon>
            Copy link
          </MenuItem>
        )}
        <MenuItem dense onClick={() => run(onDelete)} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "error.main" }}>
            <Trash2 size={14} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}
```

(The previous `iconSize` prop is dropped; `FormListView` passes only callbacks, so no other call-site change is needed.)

- [ ] **Step 2: Switch `FormCard.tsx` to it**

Replace the whole action strip `<Box sx={{ display:"flex", alignItems:"center", gap:0.25 … }} onClick={(e)=>e.stopPropagation()}> … five Tooltip/IconButton blocks … </Box>` (lines ~66–126) with:

```tsx
<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
  <FormActions
    form={form}
    onFill={onFill}
    onEdit={onEdit}
    onViewResponses={onViewResponses}
    onDelete={onDelete}
    onCopyLink={onCopyLink}
  />
</Box>
```

Add `import { FormActions } from "./FormActions";`; remove the now-unused `IconButton`/`Tooltip` (Tooltip is still used for the Lock chip — keep it) and icon imports (`BarChart3`, `Link`, `Pencil`, `TextCursorInput`, `Trash2`).

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`
Expected: green.

```bash
git add packages/app/src/components/forms
git commit -m "forms: labeled Fill/Responses/Share actions with overflow menu"
```

---

### Task 4: Drive — always-visible labeled Download

**Files:**

- Modify: `packages/app/src/components/drive/FileList.tsx` (file-row actions, lines ~240–268)

- [ ] **Step 1: Replace the hover-revealed action box**

In the file row, replace the `<Box className="file-actions" sx={{ … opacity: 0 … }}>` block with an always-visible version, the Download icon-button becoming a labeled button:

```tsx
<Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5 }}>
  <Button
    size="small"
    variant="outlined"
    color="inherit"
    disabled={downloadingHash === file.hash}
    onClick={() => onDownload(file)}
    startIcon={
      downloadingHash === file.hash ? <CircularProgress size={12} /> : <Download size={13} />
    }
    sx={{ fontSize: 12, px: 1, py: 0.25, color: "text.primary", borderColor: "divider" }}
  >
    Download
  </Button>
  <IconButton size="small" onClick={(e) => openMenu(e, file)}>
    <MoreVertical size={15} />
  </IconButton>
</Box>
```

Also remove the now-dead `"&:hover .file-actions": { opacity: 1 }` rule from the row `sx`, add `Button` to the MUI import, and drop the `Tooltip` wrapper import if no longer used in this file (the folder rows don't use it).

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`

```bash
git add packages/app/src/components/drive/FileList.tsx
git commit -m "drive: always-visible labeled Download action on file rows"
```

---

### Task 5: Shared EmptyState + rollout to all bare surfaces

**Files:**

- Create: `packages/app/src/components/EmptyState.tsx`
- Modify: `packages/app/src/components/forms/FormListView.tsx` (empty branch, lines ~45–56)
- Modify: `packages/app/src/pages/FormsPage.tsx` (`CategoryEmpty`, lines ~227–259)
- Modify: `packages/app/src/pages/PagesPage.tsx` (empty-mode branch, lines ~158–175)
- Modify: `packages/app/src/components/polls/PollDetail.tsx` ("Select a poll or create a new one", line ~84)
- Modify: `packages/app/src/components/calendar/CalendarListView.tsx` ("No events this month.", line ~37)
- Modify: `packages/app/src/components/calendar/InvitationsView.tsx` ("No pending invitations.", line ~55)
- Modify: `packages/app/src/components/calendar/BookingsView.tsx` ("No pending booking requests.", line ~83)
- Modify: `packages/app/src/components/calendar/AvailabilityView.tsx` ("No busy time published for this month.")
- Modify: `packages/app/src/components/forms/ResponsesDialog.tsx` ("No responses yet.", line ~116)
- Modify: `packages/app/src/components/pages/PageCommentsPanel.tsx` ("No comments yet.")
- Modify: `packages/app/src/components/drive/FileList.tsx` (drop-zone empty block, lines ~92–127)

- [ ] **Step 1: Create `EmptyState.tsx`**

```tsx
import { Box, Button, Link as MuiLink, Typography } from "@mui/material";
import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

import { useSettingsStore } from "../stores/settingsStore";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** e.g. "or ask the AI to draft one" — opens the AI panel. */
  aiHint?: string;
  /** Compact variant for panels/dialogs (smaller paddings, no icon tile). */
  compact?: boolean;
}

/** Shared empty state: icon tile, one-line explanation, primary CTA, AI shortcut. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  aiHint,
  compact = false,
}: EmptyStateProps) {
  const setAIPanelOpen = useSettingsStore((s) => s.setAIPanelOpen);

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        py: compact ? 3 : 8,
        px: 2,
        textAlign: "center",
      }}
    >
      {!compact && (
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.5,
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            mb: 0.5,
          }}
        >
          <Icon size={17} />
        </Box>
      )}
      <Typography variant="body2" fontWeight={600}>
        {title}
      </Typography>
      {description && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ maxWidth: 360, lineHeight: 1.5 }}
        >
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button
          size="small"
          variant="contained"
          startIcon={<Plus size={14} />}
          onClick={onAction}
          sx={{ mt: 0.75 }}
        >
          {actionLabel}
        </Button>
      )}
      {aiHint && (
        <MuiLink
          component="button"
          type="button"
          variant="caption"
          color="text.secondary"
          onClick={() => setAIPanelOpen(true)}
        >
          {aiHint}
        </MuiLink>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Adopt per surface** (each: import `EmptyState` + the icon, replace the existing empty branch — locate by the quoted string; delete the replaced local markup/imports):

`FormListView.tsx` (replace the `forms.length === 0` block):

```tsx
if (forms.length === 0) {
  return (
    <EmptyState
      icon={ClipboardList}
      title="No forms yet"
      description="Build an encrypted survey, share the link, and collect answers only you can read."
      actionLabel="New form"
      onAction={onCreateNew}
      aiHint="or ask the AI to draft one"
    />
  );
}
```

(`import { ClipboardList } from "lucide-react";` — `Plus` import can go if unused.)

`FormsPage.tsx` — `CategoryEmpty` body becomes:

```tsx
function CategoryEmpty({ category }: { category: Exclude<FormsCategory, "my"> }) {
  const { Icon, text } = EMPTY_STATES[category];
  return <EmptyState icon={Icon} title={CATEGORY_TITLES[category]} description={text} />;
}
```

(keeps the existing `EMPTY_STATES` map; drop the `useTheme` use if now unused.)

`PagesPage.tsx` (the `showEditor ? … : (<Box…FileEdit…Select a page…>)` else-branch):

```tsx
<EmptyState
  icon={FileEdit}
  title="No page open"
  description="Encrypted Markdown docs with shareable view or edit links and inline comments."
  actionLabel="New page"
  onAction={handleNew}
  aiHint="or ask the AI to write one"
/>
```

`PollDetail.tsx` (the "Select a poll or create a new one" block):

```tsx
<EmptyState
  icon={BarChart3}
  title="No poll selected"
  description="Pick a poll from the list — or create one and share it on Nostr for live results."
  aiHint="or ask the AI to draft one"
/>
```

(`BarChart3` from lucide; keep surrounding layout container.)

`CalendarListView.tsx` ("No events this month."):

```tsx
<EmptyState
  icon={CalendarDays}
  title="No events this month"
  description="Create an event or import invitations — private events stay encrypted."
  compact
/>
```

`InvitationsView.tsx` ("No pending invitations."):

```tsx
<EmptyState
  icon={Inbox}
  title="No pending invitations"
  description="Invitations sent to your relays appear here — accept to add the event to your calendar."
  compact
/>
```

`BookingsView.tsx` ("No pending booking requests."):

```tsx
<EmptyState
  icon={CalendarClock}
  title="No pending booking requests"
  description="Share a booking link and requests will land here for approval."
  compact
/>
```

`AvailabilityView.tsx` ("No busy time published for this month."):

```tsx
<EmptyState
  icon={CalendarRange}
  title="No busy time published"
  description="Calendar events publish busy slots automatically — or block extra time below."
  compact
/>
```

`ResponsesDialog.tsx` ("No responses yet."):

```tsx
<EmptyState
  icon={BarChart3}
  title="No responses yet"
  description="Share the fill link — submissions appear here live."
  compact
/>
```

`PageCommentsPanel.tsx` ("No comments yet."):

```tsx
<EmptyState
  icon={MessageSquare}
  title="No comments yet"
  description="Anyone with the share link can comment."
  compact
/>
```

`FileList.tsx` (the `childFolders.length === 0 && files.length === 0` drop-zone block — keep the meaning, adopt the shared component):

```tsx
<EmptyState
  icon={CloudUpload}
  title="Drop files here"
  description="Files are encrypted end-to-end before upload — or use the Upload button above."
/>
```

Import paths: components in subfolders use `../EmptyState` (forms/calendar/drive/pages/polls) or `../components/EmptyState` from `pages/`.

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`
Expected: green (no component tests assert the removed strings — `FillPage.test.tsx` is the only page test and is untouched).

```bash
git add packages/app/src
git commit -m "app: shared EmptyState with CTAs and AI hints across all modules"
```

---

### Task 6: Skeleton loading for initial fetches

**Files:**

- Modify: `packages/app/src/components/forms/FormListView.tsx` (isLoading branch, lines ~33–43)
- Modify: `packages/app/src/components/polls/PollsSidebar.tsx` + `packages/app/src/pages/PollsPage.tsx` (pass loading flag)
- Modify: `packages/app/src/components/pages/PagesSidebar.tsx` + `packages/app/src/pages/PagesPage.tsx`
- Modify: `packages/app/src/components/calendar/CalendarListView.tsx` + its caller `packages/app/src/pages/CalendarPage.tsx`

- [ ] **Step 1: FormListView card/row skeletons**

Replace the existing 3×80px skeleton branch with view-aware shapes:

```tsx
if (isLoading) {
  if (view === "list") {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Box
            key={i}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1.25,
              borderTop: i === 1 ? "none" : "1px solid",
              borderColor: "divider",
            }}
          >
            <Skeleton variant="text" sx={{ flex: 1, maxWidth: 280 }} />
            <Skeleton variant="text" width={70} />
          </Box>
        ))}
      </Paper>
    );
  }
  return (
    <MuiGrid container spacing={1.5}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <MuiGrid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Skeleton variant="text" width="65%" height={20} />
            <Skeleton variant="text" width="40%" height={16} />
            <Skeleton variant="rounded" height={28} sx={{ mt: 1.25 }} />
          </Paper>
        </MuiGrid>
      ))}
    </MuiGrid>
  );
}
```

(Poll detail loading: `PollDetail` already receives `isLoading={!!selectedId && isLoadingDetail}` from `PollsPage.tsx:110` and renders its own loading state — no change there.)

- [ ] **Step 2: PollsSidebar list skeletons**

Add `isLoading?: boolean` to `PollsSidebarProps`; in `PollsPage.tsx` destructure `isLoadingMine, isLoadingRecent` from the store and pass `isLoading={isLoadingMine || isLoadingRecent}` into both `<PollsSidebar …/>` renders (inside `renderRail`). In `PollsSidebar`, where the "No polls yet" / lists render, gate first:

```tsx
      {isLoading && myPolls.length === 0 && recentPolls.length === 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, px: 0.5, py: 1 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} variant="rounded" height={34} />
          ))}
        </Box>
      ) : ( …existing content… )}
```

(`recentPolls` = whatever the existing prop is named — `myPolls`/`recentPolls` per the current `PollsSidebarProps`; match exactly when editing.)

- [ ] **Step 3: PagesSidebar skeletons**

Same pattern: add `isLoading?: boolean` prop, pass `isLoading` from `usePagesStore` in `PagesPage.tsx` (`renderRail`), and ahead of the "No pages yet" branch render five `<Skeleton variant="rounded" height={40} />` rows when `isLoading && pages.length === 0`.

- [ ] **Step 4: CalendarListView row skeletons**

Add `isLoading?: boolean` prop (pass `isLoadingEvents` from `useCalendarStore` in `CalendarPage.tsx`); before the empty-state branch:

```tsx
if (isLoading && events.length === 0) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="rounded" height={52} />
      ))}
    </Box>
  );
}
```

(match the component's actual events prop name when editing.)

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`

```bash
git add packages/app/src
git commit -m "app: skeleton loading for initial relay fetches in all modules"
```

---

### Task 7: PageHeader component on all five modules

**Files:**

- Create: `packages/app/src/components/PageHeader.tsx`
- Modify: `packages/app/src/pages/FormsPage.tsx` (toolbar, lines ~148–181)
- Modify: `packages/app/src/pages/CalendarPage.tsx` (calendar view branch)
- Modify: `packages/app/src/pages/PollsPage.tsx`, `packages/app/src/pages/DrivePage.tsx`, `packages/app/src/pages/PagesPage.tsx`

- [ ] **Step 1: Create `PageHeader.tsx`**

```tsx
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One line; hidden on xs. */
  description?: string;
  /** Pinned right (primary action, toggles…). */
  action?: ReactNode;
}

/** Compact self-describing header at the top of each module's main pane. */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
          {title}
        </Typography>
        {description && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: { xs: "none", sm: "block" } }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0, display: "flex", gap: 1 }}>{action}</Box>}
    </Box>
  );
}
```

- [ ] **Step 2: Adopt per page** (descriptions verbatim from the spec table):

`FormsPage.tsx` — replace the existing toolbar `<Box sx={{ display:"flex" … borderBottom … }}>` with:

```tsx
        <PageHeader
          title={CATEGORY_TITLES[category]}
          description="Encrypted surveys on Nostr — share a link, collect answers only you can read."
          action={
            <>
              {category === "my" && (
                <ToggleButtonGroup …existing toggle group unchanged… />
              )}
              <Button
                size="small"
                variant="contained"
                startIcon={<Plus size={14} />}
                onClick={() => setActiveDialog("create")}
              >
                New form
              </Button>
            </>
          }
        />
```

`CalendarPage.tsx` — in the default (calendar) branch, render above `<CalendarHeader …/>`:

```tsx
<PageHeader
  title="Calendar"
  description="Private events, invitations, and booking pages — busy times publish automatically for booking links."
  action={
    <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={openNewEvent}>
      New event
    </Button>
  }
/>
```

(`openNewEvent` = whatever handler currently opens the EventDialog for creation — `setEventDialogOpen(true)` + `setEditEvent(null)`; reuse the existing function if one exists, else inline both calls.)

`PagesPage.tsx` — above the editor/empty area (inside the main column, after `<AIPendingRow …/>`):

```tsx
<PageHeader
  title="Pages"
  description="Encrypted Markdown docs with shareable view/edit links and inline comments."
  action={
    <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={handleNew}>
      New page
    </Button>
  }
/>
```

`DrivePage.tsx` — above `<DriveToolbar …/>`:

```tsx
<PageHeader
  title="Drive"
  description="End-to-end-encrypted files on Blossom servers, indexed on relays."
/>
```

(Upload stays in DriveToolbar — don't duplicate the action.)

`PollsPage.tsx` — top of the main column:

```tsx
<PageHeader
  title="Polls"
  description="Public Nostr polls with live tallies and optional proof-of-work gates."
  action={
    <Button
      size="small"
      variant="contained"
      startIcon={<Plus size={14} />}
      onClick={() => setCreateOpen(true)}
    >
      New poll
    </Button>
  }
/>
```

Each page: add `PageHeader`/`Button`/`Plus` imports as needed; remove the replaced toolbar markup and any imports it orphaned (FormsPage's `useTheme` if unused).

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`

```bash
git add packages/app/src
git commit -m "app: self-describing page headers with pinned primary actions"
```

---

### Task 8: ShortcutsDialog + “?” hotkey + palette entry

**Files:**

- Create: `packages/app/src/components/ShortcutsDialog.tsx`
- Modify: `packages/app/src/layout/AppShell.tsx` (state + key listener + render)
- Modify: `packages/app/src/components/CommandPalette.tsx` (new item + prop)

- [ ] **Step 1: Create `ShortcutsDialog.tsx`**

```tsx
import { Box, Dialog, Typography } from "@mui/material";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["Command palette", "⌘K"],
  ["Save page", "⌘S"],
  ["Saved AI prompt", "/keyword"],
  ["Block menu (Pages editor)", "/"],
  ["Link entity (Pages editor)", "@"],
  ["This dialog", "?"],
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
          Keyboard shortcuts
        </Typography>
        {SHORTCUTS.map(([label, key]) => (
          <Box
            key={label}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              py: 0.75,
            }}
          >
            <Typography variant="body2">{label}</Typography>
            <Box
              component="kbd"
              sx={{
                fontFamily: "monospace",
                fontSize: 12,
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 0.5,
                px: 0.75,
                py: 0.25,
              }}
            >
              {key}
            </Box>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
```

- [ ] **Step 2: AppShell wiring**

In `AppShell.tsx`: add state + listener + render.

```tsx
const [shortcutsOpen, setShortcutsOpen] = useState(false);

useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    e.preventDefault();
    setShortcutsOpen(true);
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []);
```

Render next to the other dialogs at the bottom:

```tsx
<ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
```

Pass an opener into the palette: `<CommandPalette … onOpenShortcuts={() => setShortcutsOpen(true)} />`.

- [ ] **Step 3: CommandPalette entry**

Add to `CommandPaletteProps`: `onOpenShortcuts?: () => void;` and destructure it. Append to `allItems` (after the theme/AI items, before any account/danger items):

```tsx
    ...(onOpenShortcuts
      ? [
          {
            id: "help-shortcuts",
            group: "Help",
            label: "Keyboard shortcuts",
            shortcut: "?",
            icon: Keyboard,
            action: () => run(onOpenShortcuts),
          },
        ]
      : []),
```

(`import { Keyboard } from "lucide-react";` — add to the existing lucide import list. Match the `allItems` array’s existing item shape exactly.)

- [ ] **Step 4: Verify + full gate + commit**

Run: `pnpm --filter @formstr/app typecheck && pnpm --filter @formstr/app test`
Then the full close-out gate: `pnpm -r test && pnpm -r typecheck && pnpm -r build`
Expected: everything green (baseline: core 95 / agent 317 / mcp 38 / app 239+).

```bash
git add packages/app/src
git commit -m "app: keyboard-shortcuts dialog (? hotkey) and palette entry"
```

---

## Final checklist

- [ ] All 8 task commits exist; `git status` clean.
- [ ] Full gate green: `pnpm -r test && pnpm -r typecheck && pnpm -r build`.
- [ ] Update `CLAUDE.md` session-progress section with the commit hashes (per standing directive).
- [ ] Do not push; no PR.
