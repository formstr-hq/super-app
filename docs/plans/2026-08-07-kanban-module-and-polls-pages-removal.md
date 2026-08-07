# Design: remove Polls & Pages from the app, add a Kanban module

**Date:** 2026-08-07
**Branch:** `feat/kanban-module` (based on `fix/mcp-strict-tool-args` / PR #26 — see §9)
**Status:** implemented — see §10 for where the build diverged from this design

## 1. Goal

Cut the super-app's web surface down to the modules it will ship in production, and add
Kanban boards backed by the published `@formstr/kanban-sdk`.

Module set today: Forms · Calendar · Pages · Drive · Polls.
Module set after this work: **Forms · Calendar · Kanban · Drive**.

Polls and Pages are removed from `packages/app` only. `packages/agent` keeps every polls
and pages service and tool, and `packages/mcp` keeps advertising them — the MCP server's
surface does not shrink.

## 2. Non-goals

Out of scope for this branch, deliberately:

- Kanban invitations inbox, member management, board-key rotation, card comments,
  card links / tracked refs.
- Board-list management UI beyond what private-board create and read require.
- Kanban tools in `packages/agent` or `packages/mcp`, and therefore any kanban
  awareness in the in-app AI panel.
- Deleting polls/pages code from `packages/agent`.
- Any refactor of Forms, Calendar, or Drive not required by the two changes above.

## 3. Background: the module contract

A module in this app touches seventeen places. The same list is the subtraction list for
Polls and Pages and the addition list for Kanban:

1. `packages/app/src/router.tsx` — route
2. `packages/app/src/layout/Sidebar.tsx` — `NAV_ITEMS`
3. `packages/app/src/layout/Header.tsx` — `NAV_ITEMS` + title map
4. `packages/app/src/layout/fullBleed.ts` — edge-to-edge route prefixes
5. `packages/app/src/stores/<mod>Store.ts` + `stores/index.ts`
6. `packages/app/src/pages/<Mod>Page.tsx`
7. `packages/app/src/components/<mod>/`
8. `packages/app/src/ai/types.ts` — `EntityRef["module"]` union
9. `packages/app/src/ai/entityMap.ts` — tool result → entity + route
10. `packages/app/src/ai/context.ts` — assistant system prompt
11. `packages/app/src/stores/aiPendingStore.ts` — `moduleForTool` sets
12. `packages/app/src/components/CommandPalette.tsx` — nav + `?action=new`
13. `packages/app/src/components/EntityPill.tsx`, `MentionPicker.tsx`
14. `packages/core/src/linking.ts` — `ModuleType`, `MODULE_ROUTES`, `KIND_MODULE_MAP`
15. `packages/core/src/relay/module-defaults.ts` — `MODULE_DEFAULT_RELAYS`
16. `packages/agent/src/services/<mod>/`, `tools/<mod>.ts`, `tools/index.ts`
17. `packages/app/src/components/settings/AboutSection.tsx` — suite blurb

Stores call `@formstr/agent` services directly through deep imports (see
`stores/calendarStore.ts`); they do not go through the tool registry. Kanban is the first
module whose store calls an external SDK instead of an agent service.

## 4. Phase 1 — excise Polls and Pages from the app

### 4.1 Deletions

`components/polls/` · `components/pages/` · `pages/PollsPage.tsx` · `pages/PagesPage.tsx` ·
`stores/pollsStore.ts` + test · `stores/pagesStore.ts` + test.

Roughly 3,777 lines: 1,243 for Polls, 2,534 for Pages.

### 4.2 Edits

Every file in §3 loses its polls and pages entries. Specifics worth calling out:

- **`router.tsx`** — the two lazy imports and routes go; `polls/*` and `pages/*` become
  `<Navigate to="/forms" replace />` so existing links and bookmarks resolve instead of
  falling through to not-found.
- **`ai/types.ts`** — `EntityRef["module"]` becomes `"forms" | "calendar" | "drive"`.
  Kanban is deliberately **not** in the union: no kanban tool exists, so nothing can produce
  a kanban `EntityRef`, and `EntityPill`, `MentionPicker`, `EntityCard`, `ToolCallChip`, and
  `moduleForTool` therefore get no kanban branch either. It joins the union in whatever
  version adds kanban tools.
- **`ai/context.ts`** — the system prompt currently names pages and polls and carries
  poll-type guidance. Rewrite for the three remaining tool-backed modules.
- **`components/ai/AIChatPanel.tsx`**, **`EntityCard.tsx`**, **`ToolCallChip.tsx`** — drop
  the poll/page icon and color map entries and the suggestion chips that ask for a poll or
  a page.
- **`core/src/linking.ts`** — `ModuleType` drops `pages`/`polls` and gains `kanban`;
  `MODULE_ROUTES` gains `kanban: "/kanban"`; `KIND_MODULE_MAP` drops the poll and page
  kinds and gains 30301/30302/32301/32302 → `kanban`.
- **`core/src/relay/module-defaults.ts`** — drop `pages` and `polls`, add `kanban` (§5.2).

### 4.3 The tool-surface cut

The app's AI panel builds its tool list from `getToolSchemas()` over the _whole_ agent
registry. Deleting the UI without narrowing that list leaves the assistant able to call
`create_poll` and `update_page`: the calls succeed and write to relays, with no surface in
this app to view the result. The narrowing happens at one seam:

- `ToolEntry` gains a **required** `module: "forms" | "calendar" | "pages" | "polls" | "drive"`
  field, set in each of the five `tools/*.ts` files. Required rather than optional so a
  future tool cannot silently escape the filter; a registry test asserts every entry has one.
- New `packages/app/src/ai/registry.ts`:
  `export const appToolRegistry = toolRegistry.filter((t) => APP_MODULES.has(t.module))`
  with `APP_MODULES = new Set(["forms", "calendar", "drive"])`.
- `ai/toolSchemas.ts` and `ai/agent.ts` (both `VALID_TOOL_NAMES` and the handler lookup)
  read `appToolRegistry`. A model that hallucinates `create_poll` then hits the existing
  unknown-tool error path instead of writing to a relay.
- `getToolSchemas()` gains an optional `{ modules }` filter. `packages/mcp/src/server.ts`
  iterates `toolRegistry` directly and is unaffected — the MCP surface stays whole.

## 5. Phase 2 — the Kanban module

### 5.1 Dependencies

Added to `packages/app/package.json`:

| Package               | Version   | Why                                              |
| --------------------- | --------- | ------------------------------------------------ |
| `@formstr/kanban-sdk` | `^0.1.0`  | the module's entire protocol layer               |
| `@dnd-kit/core`       | `^6.3.1`  | drag context; `react >=16.8` peer, React 19 safe |
| `@dnd-kit/sortable`   | `^10.0.0` | sortable lists across containers                 |

The SDK's own dependencies are only `nostr-tools` and `@noble/hashes`, both already in the
tree.

### 5.2 SDK wiring — `packages/app/src/kanban/sdk.ts`

One module-level `KanbanSDK`, constructed with a signer proxy that resolves per call:

```ts
const signerProxy: KanbanSigner = {
  getPublicKey: async () => (await signerManager.getSigner()).getPublicKey(),
  signEvent: async (t) => (await signerManager.getSigner()).signEvent(t),
  nip44Encrypt: async (pk, pt) => (await signerManager.getSigner()).nip44Encrypt(pk, pt),
  nip44Decrypt: async (pk, ct) => (await signerManager.getSigner()).nip44Decrypt(pk, ct),
};

export const kanbanSdk = new KanbanSDK({
  signer: signerProxy,
  runtime: nostrRuntime,
  relays: MODULE_DEFAULT_RELAYS.kanban,
});
```

Three consequences, all intended:

- **Identity changes need no reconstruction.** `signerManager.getSigner()` is the app-wide
  blocking accessor that opens the login or unlock modal when locked, so kanban writes get
  the same auth behavior as every other module for free.
- **Runtime is injected**, so `ownsRuntime` is false and `kanbanSdk.dispose()` is a no-op —
  correct, because the pool belongs to `@formstr/core` and outlives any one module. The SDK
  only ever calls `querySync`, `subscribe`, and `publish`, none of which read core's
  `EventStore` cache, so replaceable board and card events are never served stale. A code
  comment records that constraint: routing kanban reads through `nostrRuntime.fetchOne`
  (cache-first) would break it.
- **Relays.** `MODULE_DEFAULT_RELAYS.kanban` must remain a **superset** of the SDK's
  `DEFAULT_RELAYS` (`relay.damus.io`, `nos.lol`, `relay.primal.net`) or boards stop syncing
  with kanbanstr.com. Same superset rule the calendar module already documents.

### 5.3 Store — `packages/app/src/stores/kanbanStore.ts`

```ts
boards: KanbanBoard[];
lists: KanbanBoardList[];
cardsByBoard: Record<string, KanbanCard[]>;   // key = board coordinate
activeCoordinate: string | null;
isLoadingBoards: boolean; isLoadingCards: boolean; error: string | null;

fetchBoards(): Promise<void>;   // Promise.all of fetchBoards({authors:[me], maintainedBy:me})
                                // and fetchPrivateBoards()
fetchCards(board: KanbanBoard): Promise<void>;
createBoard(draft: BoardDraft): Promise<KanbanBoard>;
updateBoard(board: KanbanBoard, changes: Partial<BoardDraft>): Promise<KanbanBoard>;
deleteBoard(board: KanbanBoard): Promise<void>;
createCard(board: KanbanBoard, draft: CardDraft): Promise<KanbanCard>;
updateCard(board: KanbanBoard, card: KanbanCard, changes: Partial<CardDraft>): Promise<KanbanCard>;
deleteCard(card: KanbanCard): Promise<void>;
moveCard(board: KanbanBoard, cardId: string, targetStatus: string, targetIndex: number): Promise<void>;
```

`fetchBoards` needs a pubkey, so it is a no-op when logged out and the board list renders a
signed-out empty state. Public boards are readable without a signer, but this version has no
browse-others'-boards surface to read them into, so no logged-out fetch path exists.

Every method follows the existing await-then-`set` pattern and stores failures in `error`,
matching `calendarStore`. `moveCard` is the exception: it reorders `cardsByBoard` locally
first for a responsive drag, then awaits `kanbanSdk.moveCard`; on rejection it restores the
pre-drag snapshot and sets `error`.

**One correctness trap to encode.** `KanbanCard.status` is the column **name** on public
boards and the column **id** on private ones (`@formstr/kanban-sdk` `types.ts`). A single
`statusFor(board, column)` helper owns that branch, and nothing else reads or writes
`card.status` directly.

### 5.4 Components — `packages/app/src/components/kanban/`

| File                    | Responsibility                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `KanbanSidebar.tsx`     | board switcher rail; mirrors `FormsSidebar`                          |
| `BoardListView.tsx`     | grid of boards, empty state, create entry point                      |
| `BoardCard.tsx`         | one board tile: title, description, public/private badge, card count |
| `CreateBoardDialog.tsx` | title, description, column editor, private toggle                    |
| `BoardView.tsx`         | `DndContext` (`closestCorners`) + horizontal column strip            |
| `KanbanColumn.tsx`      | one column: `SortableContext` + droppable region + add-card          |
| `KanbanCardItem.tsx`    | one card: `useSortable` draggable, labels, assignees                 |
| `CardDialog.tsx`        | create/edit a card — title, description, labels, assignees           |
| `dndMapping.ts`         | pure `DragEndEvent` → `{ targetStatus, targetIndex } \| null`        |

`dndMapping.ts` is separate and pure because the drag-end → target derivation is the
bug-prone part and deserves unit tests without a DOM.

### 5.5 Routes

- `/kanban` — board list
- `/kanban/:coordinate` — board detail

Board coordinates are `kind:pubkey:dtag` and contain colons. They are `encodeURIComponent`'d
into the path and decoded in the page component. Both paths are registered in
`fullBleed.ts`.

### 5.6 Data flow, one write end to end

`KanbanCardItem` drag → `BoardView` `onDragEnd` → `dndMapping` → `kanbanStore.moveCard`
(optimistic local reorder) → `kanbanSdk.moveCard(board, allCards, cardId, targetStatus, targetIndex)`
→ SDK branches on `board.isPrivate` → `computeRank(sortedRanks, targetIndex)` → event signed
through `signerProxy` → `signerManager.getSigner()` (login modal if locked) → published via
core's shared pool to `MODULE_DEFAULT_RELAYS.kanban`. The returned card replaces its entry;
the optimistic order already matches.

### 5.7 Error handling

Store methods catch and set `error: string`. Three SDK error types get typed handling rather
than a raw message surfaced to the user:

| Error                  | Handling                                                        |
| ---------------------- | --------------------------------------------------------------- |
| `SignerRequiredError`  | open the login modal (`authStore.openAuthModal("login")`)       |
| `ViewKeyRequiredError` | empty state: this private board's key is not in your board list |
| `NotAMaintainerError`  | disable card writes, show a read-only badge on the board        |

## 6. Testing

**Phase 1.** Update `Sidebar.test.tsx`, `Header.test.tsx`, `fullBleed.test.ts`,
`entityMap.test.ts`, `aiPendingStore.test.ts`, `ai/agent.test.ts`,
`ai/providers/gemini.test.ts`, `settingsStore.test.ts`. Two new assertions: `appToolRegistry`
exposes no `*_poll` or `*_page` tool, and `/polls` and `/pages` redirect to `/forms`. One new
agent-side test: every `ToolEntry` carries a `module`.

**Phase 2.** `kanbanStore.test.ts` against a `vi.mock`'d `kanban/sdk` module, covering the
`moveCard` optimistic-then-rollback path. `dndMapping.test.ts` as pure unit tests.
A `statusFor` test covering the public-name / private-id split. Component tests for
`BoardListView`, `BoardView`, and `CardDialog` in the style of the existing calendar
component tests.

**Gates.** `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @formstr/app build`.
Expected tallies: agent 356 → 357 (the one new registry test), mcp 83 unchanged — the MCP
surface must not move, and an mcp count that changes means §4.3 leaked past the app boundary.

## 7. Risks

- **Public/private status divergence** (§5.3). Mitigated by `statusFor` plus a dedicated test.
- **Relay set drift.** Narrowing `MODULE_DEFAULT_RELAYS.kanban` below the SDK's defaults
  silently breaks kanbanstr.com interop with no local test failure. Recorded as a comment at
  the constant.
- **Cache-first reads.** Injecting core's runtime is safe only while kanban reads go through
  `querySync`/`subscribe`. Recorded as a comment in `kanban/sdk.ts`.
- **`ToolEntry.module` is a breaking change** to an exported agent type, touching all five
  tool files. Accepted: an optional field would let a new tool leak into the app surface by
  omission, which is the exact failure this guards against.

## 8. Verification beyond tests

The unit suite cannot prove interop. After the branch is green, a manual pass against
kanbanstr.com with a throwaway key: create a public board in the super-app, confirm it renders
there; move a card there, confirm the reorder lands here. Private boards are super-app-only in
this version and need no cross-app check.

## 9. Branch base

`feat/kanban-module` branches from `fix/mcp-strict-tool-args` (PR #26), not from `main`.
PR #26 rewrote `packages/agent/src/tools/*` — the same files §4.3 edits — and is already
published to npm as `@formstr/mcp@0.5.0`. Branching from `main` would conflict there. Once
#26 merges, rebase this branch onto `main` and its commits collapse out of the diff.

## 10. Where the implementation diverged

Recorded as built, so the next reader trusts the code over the plan.

**`module` is stamped at the aggregation point, not on each tool** (§4.3). Four of the five
tool files build their arrays through a `registerTool` shim, so adding a field to ~60
definitions meant threading it through five builders. Instead `ToolEntry` was split: module
files export `ToolDef[]` (no `module`), and `tools/index.ts` stamps the field as it
concatenates them. The guarantee is stronger than the original plan's, not weaker — a tool
joins the registry only by joining one of those five arrays, so it cannot be untagged.

**`MODULE_DEFAULT_RELAYS` keeps its `pages` and `polls` entries.** §4.2 called for removing
them; that was wrong and broke the agent's typecheck. Those are protocol relay sets that the
agent's polls and pages services still publish to on behalf of the MCP server. Only
`linking.ts` — app routing — drops the two modules. `kanban` was added to both.

**`EntityRef["module"]` excludes `kanban`.** No kanban tool exists, so nothing can produce a
kanban entity; adding it would have meant dead branches in five components.

**Icon is `SquareKanban`, not `Trello`** — the pinned lucide-react has no `Trello` export.

**Two files not in the original design:**

- `kanban/boardKey.ts` — a board's `d` tag is not unique (a public and a private board can
  share one, and two authors certainly can), so the store keys `cardsByBoard` and dedupes
  `fetchBoards` by the full `kind:pubkey:d` coordinate.
- `@dnd-kit/utilities` was added as an explicit dependency rather than leaning on it as a
  transitive dep of `@dnd-kit/sortable`, since `KanbanCardItem` imports from it directly.

**`router.tsx` now exports its `routes` array** alongside the `createBrowserRouter` instance,
so `router.test.tsx` can mount the real tree in a `MemoryRouter`. The data router
(`createMemoryRouter`) could not be used: its client-side navigation builds a `Request`, and
jsdom's `AbortSignal` fails undici's instance check on every redirect.

**`kanbanStore.moveCard` carries a local `predictRank`** rather than importing the SDK's
`computeRank`, so the optimistic hop cannot corrupt a published rank if the SDK's
fractional-indexing scheme changes. The authoritative value always comes back from
`moveCard` and overwrites it.

**Board deletion is owner-only, and the store never queries board lists.** Both were gaps
found by auditing the first commit, fixed in a follow-up:

- `deleteBoard` existed in the store with a test but nothing called it — a board could be
  created and edited, never removed. It now has an affordance in the board header behind a
  confirm dialog, shown **only to the board's author**. Maintainers may write cards, but a
  NIP-09 tombstone is honored only from the event's own author, so a maintainer's deletion
  would be signed by the wrong key and silently ignored by relays. The dialog says plainly
  that a Nostr deletion is a request, not an erasure.
- `fetchBoards` was also calling `fetchBoardLists` and storing the result in a `lists` field
  that nothing read. `fetchPrivateBoards` already reads those lists internally to recover
  each board's view key, so the extra call was a second round trip for dead state. Both the
  call and the field are gone.

**Gate results:** core 95, agent 357 (was 356), mcp 83 (unchanged, as required), app 290
(was 244). Typecheck green across all four packages, `vite build` green, eslint 0 errors /
33 warnings — four fewer warnings than the pre-change tree.

## 11. Still open

Nothing below is covered by the gates above.

1. **The app has never been run.** Every claim about the Kanban UI rests on unit tests and a
   green `vite build`. No board has been rendered in a browser, no card dragged, nothing
   published to a real relay.
2. **kanbanstr.com interop is unverified** (§8).
3. **The branch is unpushed and has no PR.**
