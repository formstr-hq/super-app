# Design: kanban board membership — roles, invitations, revocation

**Date:** 2026-08-09
**Branch:** `feat/kanban-members` (based on `dev`)
**Status:** design approved, not yet implemented

## 1. Goal

Let a board owner manage who is on a kanban board: see the member list, invite someone as
an editor or a viewer, change an existing member's role, and revoke access. Let an invited
user see and act on the invitations sent to them, so the loop closes inside super-app
rather than only on kanbanstr.com.

This was listed as a non-goal of the kanban module branch
([2026-08-07-kanban-module-and-polls-pages-removal.md](2026-08-07-kanban-module-and-polls-pages-removal.md) §2).
It is now in scope.

Every protocol operation already exists in `@formstr/kanban-sdk@0.1.0`. Nothing in this
design invents wire format, adds an event kind, or patches the SDK. The work is entirely a
super-app surface over `invite`, `fetchMembers`, `removeMember`, `rotateBoardKey`,
`fetchInvitations`, `acceptInvitation`, `dismissInvitation`, and `fetchRemovalNotices`.

## 2. Non-goals

- Card comments. The `member` role's only write capability is `createComment`, and the app
  has no comment UI. A `member` is therefore read-only in practice until comments ship.
- NIP-05 resolution in the invite field. An npub or a 64-char hex pubkey only.
- Batched or subscription-based profile fetching. One `fetchProfile` per pubkey, cached.
- A live subscription for invitations. The SDK exposes `fetchInvitations()` only.
- Ownership transfer. The protocol has no such operation — board identity _is_ the owner's
  pubkey (`kind:pubkey:d`).
- Any change to `@formstr/kanban-sdk`.

## 3. The permission model, as the SDK actually enforces it

Three roles, from `BoardRole = "owner" | "maintainer" | "member"`:

| Role       | Where it lives                       | Can                                                  |
| ---------- | ------------------------------------ | ---------------------------------------------------- |
| owner      | `board.pubkey` (the event author)    | everything, including membership                     |
| maintainer | `board.maintainers`                  | `canEditCards` → create / edit / move / delete cards |
| member     | `board.members`, private boards only | read, and `canComment`                               |

Two constraints come out of the SDK's own guards and shape the whole UI:

**Membership management is owner-only.** `invite` and the non-rotating branch of
`removeMember` both call `updatePrivateBoard`, which throws `NotBoardOwnerError` when the
signer is not `board.pubkey`. `rotateBoardKey` throws the same error directly. A
maintainer can edit cards but cannot touch the member list, so the app gates every
membership control on `pubkey === board.pubkey` rather than on `canEditCards`.

**The `member` role only exists on private boards.** It means "holds the view key but is
not authorised to write cards" — a client-enforced read-only convention over a key that
technically decrypts everything. A public board has no view key, so there is nothing to
grant and nothing to withhold: anybody can read it. Its `maintainers` list is plain `p`
tags on the 30301 event.

### 3.1 Consequence: two panel modes

|                       | private board (32301)                                                   | public board (30301)                                |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| roles offered         | maintainer, member                                                      | maintainer only                                     |
| add                   | `sdk.invite(...)` → board tags + NIP-59 gift wrap carrying the view key | `sdk.updateBoard(board, { maintainers })` → `p` tag |
| remove                | `sdk.removeMember(...)` → drops the tag **and rotates the board key**   | drop the `p` tag                                    |
| what removal achieves | real revocation after rotation                                          | authorship only; the board stays world-readable     |

The panel states the public-board case in words, because "remove maintainer" on a public
board looks like revoking access and is not.

### 3.2 Pre-existing bug noted, deliberately not fixed here

`updateBoard` (the public path) does not check authorship, and publishes the event under
the signer's pubkey. A maintainer who edits a public board therefore publishes
`30301:<their-pubkey>:<d>` — a fork at a new coordinate, not an edit of the original. The
Edit button at [`KanbanPage.tsx:90`](../../packages/app/src/pages/KanbanPage.tsx) is
already exposed to maintainers, so this is reachable today and is not a regression
introduced here. This design gates the _new_ membership controls to the owner and leaves
that button alone. Fixing it is a separate one-line change.

## 4. Revocation, and why rotation is not optional

`removeMember(board, pubkey)` rotates the board key by default. Rotation:

1. refetches every private card and comment on the board,
2. mints a fresh view key and republishes the board under it,
3. republishes each card and comment encrypted to the new key, signed by the owner, with
   the original author preserved in the payload (`rotated-author`, surfaced as
   `card.authorPubkey` with `card.rotated === true`),
4. re-invites every surviving member with the new key,
5. publishes a kind-84 removal notice against the _retiring_ key's blinded pointer.

`{ rotate: false }` skips all of it and only drops the tag. The removed user keeps the old
view key and can still decrypt every existing event, and every future one, because the key
did not change. **The app never offers that branch.** A control labelled "revoke access"
that does not revoke access is a security trap, so rotation is unconditional and the
confirm dialog explains its cost instead of offering an opt-out.

What the dialog must say, because none of it is obvious:

- N cards and M comments will be rewritten; on a large board this takes a while.
- The operation is not atomic. A failure part-way leaves some events under the new key and
  some under the old.
- It is not retroactive. Copies already published under the old key remain on relays and
  stay readable to anyone who kept that key. Rotation stops future reads, not past ones.
- Remaining members are re-invited automatically and need do nothing.

## 5. Files

### New

| File                                                        | Responsibility                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/app/src/stores/kanbanMembersStore.ts`             | pending invitations, removal notices, per-action busy/error state, and the invite/role/remove/accept/dismiss actions |
| `packages/app/src/kanban/roles.ts`                          | pure helpers — `roleOf`, `canManageMembers`, `roleLabel`, `roleHelp`, `parseInvitee`                                 |
| `packages/app/src/components/kanban/MembersDialog.tsx`      | member list + invite form                                                                                            |
| `packages/app/src/components/kanban/MemberRow.tsx`          | one member: avatar, name, role control, remove                                                                       |
| `packages/app/src/components/kanban/RemoveMemberDialog.tsx` | revocation confirm, states the rotation cost                                                                         |
| `packages/app/src/components/kanban/InvitationsView.tsx`    | the inbox pane                                                                                                       |
| `packages/app/src/lib/profileCache.ts`                      | `useProfileName(pubkey)` over agent's `fetchProfile`                                                                 |

### Modified

| File                                  | Change                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/kanban/KanbanSidebar.tsx` | an "Invitations" row under "All boards" with a pending count                                                   |
| `pages/KanbanPage.tsx`                | a Members action in the header, the `members` dialog state, the invitations pane, and the removal-notice alert |
| `stores/kanbanStore.ts`               | add `ingestBoard(board)` — replace one board in place, since every membership write returns an updated board   |
| `stores/index.ts`                     | export `useKanbanMembersStore`                                                                                 |

### No member cache

`fetchMembers` is pure derivation from the board's own tags:

```js
return [
  { pubkey: board.pubkey, role: "owner" },
  ...board.maintainers.map((pubkey) => ({ pubkey, role: "maintainer" })),
  ...board.members.map((pubkey) => ({ pubkey, role: "member" })),
];
```

It takes no network. The member list is therefore computed from the `KanbanBoard` the
boards store already holds, and the new store keeps no member state — only invitations,
removal notices, and action status. Membership writes stay correct by ingesting the
updated board they return.

## 6. Routing

No new route entry. `KanbanPage` reads `activeKey` from `params["*"]`, and every board key
is a coordinate containing colons (`boardKey` → `kind:pubkey:d`), so the literal
`"invitations"` cannot collide with one. `/kanban/invitations` renders `InvitationsView`
in the main pane; the sidebar row links to it.

## 7. Flows

**Invite.** Form validates through `parseInvitee` (npub or hex → hex, rejects malformed,
self, and anyone already on the board), then
`sdk.invite(board, [{ pubkey, role }], message)`. The returned board goes to
`kanbanStore.ingestBoard`.

**Change role.** The same `invite` call with the other role — the SDK filters the pubkey
out of both lists and re-adds it to the chosen one. This re-sends an invitation gift wrap
as a side effect, so the UI reports "role updated, invitation re-sent" rather than
implying a silent tag edit.

**Revoke.** `RemoveMemberDialog` → `sdk.removeMember(board, pubkey)` → `ingestBoard`, then
**refetch that board's cards**. Rotation republished every card and comment, so every
cached `eventId` in `cardsByBoard` is stale even though the `d` tags are unchanged.

**Accept.** `sdk.acceptInvitation(inv)` links the board into the user's board list under
the delivered view key; then `kanbanStore.fetchBoards()` and navigate to the new board.

**Dismiss.** `sdk.dismissInvitation(inv)` (a self-signed NIP-09 deletion of the wrap when
the inviter supplied its signing nsec, otherwise a kind-84), then drop it locally. The
dismissal persists — relays keep serving the wrap, so without it the invitation returns on
the next fetch.

**Removal notices.** `sdk.fetchRemovalNotices()` once when the kanban page mounts. If the
open board's coordinate is among them, an alert on the board: the owner removed you, this
copy no longer receives updates. Advisory only — the board event is authoritative, and the
notice is what makes the state discoverable without diffing every board's tags.

**Invitation freshness.** One-shot `fetchInvitations()` on mount plus an explicit refresh,
not a live subscription. The calendar's `invitationsStore` subscribes because agent exposes
a runtime subscription for calendar wraps; the kanban SDK exposes only the query.

## 8. Identity display

The invite field accepts an npub or a 64-char hex pubkey, decoded by the existing
`npubToHex` in [`lib/npub.ts`](../../packages/app/src/lib/npub.ts).

Member rows and invitation cards resolve a display name through agent's `fetchProfile`
(kind 0) behind a module-level cache in `lib/profileCache.ts`: one request per pubkey per
session, in-flight requests deduped, failures cached as "no profile" so a missing kind-0
does not re-query on every render. The fallback is today's `formatNpub` short form beside
the `AssigneeAvatar` colour tile, which is also what renders while a lookup is in flight.
`AssigneeAvatar` can adopt the same hook later; this design does not change it.

## 9. Errors

| Condition                                     | Surface                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotBoardOwnerError`                          | "Only the board owner can manage members." Shouldn't be reachable — the controls are owner-gated — so treat it as a stale-board signal and refetch. |
| `SignerRequiredError`, `ViewKeyRequiredError` | existing kanban snackbar                                                                                                                            |
| `InvitationVerificationError` on accept       | "This invitation's key does not open that board." Keep the invitation listed so the user can dismiss it deliberately.                               |
| rotation throws part-way                      | refetch boards and cards, then say it plainly: rotation may be incomplete, re-check the member list before trusting it                              |
| invalid / self / duplicate invitee            | inline under the field, not the snackbar                                                                                                            |

## 10. Tests

Matching the existing kanban test style — vitest + React Testing Library, with
`../kanban/sdk` mocked, as in `stores/kanbanStore.test.ts` and
`components/kanban/*.test.tsx`.

- `kanban/roles.test.ts` — role resolution for owner / maintainer / member / stranger;
  `canManageMembers` true only for the owner; `parseInvitee` accepts npub and hex, rejects
  malformed input, self, and existing members.
- `stores/kanbanMembersStore.test.ts` — invite ingests the returned board; a role change
  calls `invite` with the new role; revoke ingests the board **and** triggers a card
  refetch; accept refetches boards; dismiss removes the entry; each SDK error maps to the
  message in §9.
- `components/kanban/MembersDialog.test.tsx` — a non-owner sees the roster with no
  controls; a private board offers both roles, a public board only maintainer.
- `components/kanban/RemoveMemberDialog.test.tsx` — names the member, states the rotation
  cost, and calls back only on explicit confirm.
- `components/kanban/InvitationsView.test.tsx` — renders inviter and role, accept
  navigates to the board, dismiss drops the row.

Gate before merge: `pnpm --filter @formstr/app test`, `typecheck`, and `tsc -b && vite build`.
