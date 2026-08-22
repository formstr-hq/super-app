# Reactive UI on the local-relay substrate

**Date:** 2026-08-22
**Status:** approved, implementing
**Scope:** make the app's stores track the relay without the user asking, on top of
the substrate from PR #31, with no new UI and no SDK releases.

## Why

PR #31 put the app on `@formstr/local-relay` — a worker holding standing interests, an
IndexedDB cache that survives reloads, and a durable outbox. It deliberately changed
nothing above `nostrRuntime`, so stores still pull once on mount and never hear anything
again. The substrate is live; the UI is still a snapshot. A collaborator's card edit, an
invitation that lands, a form created in another tab — none of it appears until the user
navigates away and back.

Two facts make this cheap:

1. The warm-up interests declared at login already receive every matching event.
   `warmup.ts` hands them `{ onEvent: () => {} }` — the events arrive and are discarded.
2. The worker handles a publish as `["EVENT", …]` through its relay core, so the app's
   own writes echo back to local observers immediately. Optimistic update is free.

## Decisions

| Question                | Decision                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| How events reach stores | Invalidate + refetch through the existing `fetchX()` pipelines       |
| What it is built on     | `nostrRuntime.subscribe`, not `DataLayer.observe`                    |
| Coverage                | The user's root scopes, plus a view scope for the open board's cards |
| User-visible surface    | None                                                                 |

## 1. Invalidate + refetch, not event-level decode

A standing subscription fires → the affected store re-runs the `fetchX()` it already has
→ that read is covered by a warm interest, so it settles on the 150ms grace instead of
waiting out the network.

The alternative — decode each event and upsert it by coordinate — is cheaper per event
but needs new decode-only exports in `@formstr/agent`, `@formstr/kanban-sdk` and
`@formstr/calendar-sdk`, none of which expose one today. Every store fetch is a
`filter → querySync → decrypt → parse` pipeline living inside those packages. Refetching
reuses all of it and keeps every existing store test valid.

The cost is amplification: one card edit re-decrypts a board's cards. The coalescing
window is the mitigation, and per-card decode stays available as an escape hatch.

## 2. Built on the runtime contract

Reactivity goes through `nostrRuntime.subscribe(relays, filters, handlers)`, which is
already in `NostrRuntimeContract` and already used by `formsStore.loadResponses`.

That choice means reactivity works on the SimplePool backend too, survives the
`formstr.localRelay=off` kill switch, needs no local-relay import in any store, and lets
jsdom tests keep mocking core exactly as they do now. Nothing here is local-relay-specific;
the substrate makes it _fast_, not possible.

## 3. The invalidation bus

`src/lib/live/liveSync.ts` owns one subscription per named scope.

**Events before EOSE are ignored.** local-relay replays the whole cache before firing
EOSE, so invalidating on each replayed event would fire a refetch storm at login for
data the store is loading anyway. After EOSE, every event is a real change. The same
rule reads correctly on SimplePool (stored events, then EOSE, then the live tail).

Post-EOSE events debounce onto a single `onChange`. Opening a scope under an existing
key replaces it, so switching boards is one call and local-relay's `unobserveGraceMs`
absorbs the churn.

`singleFlight` guards the refetch itself: if one is in flight, mark dirty and re-run
exactly once when it lands, so a burst can never stack N concurrent `fetchBoards`.

## 4. Root scopes

`warmScopesFor(pubkey)` moves out of `lib/localRelay/warmup.ts` into `lib/live/scopes.ts`.
The filters are not local-relay-specific, and what is kept warm must not diverge from
what is watched. Each scope gains a refetch binding: forms → `fetchMyForms`, kanban →
`fetchBoards`, calendar → `fetchCalendars`, drive → `fetchFiles`, profile → the auth
store's profile.

The `1059` invitation scope stays warm-only. `invitationsStore` already runs its own live
subscription through `sdk.subscribeToInvitations` plus `legacyInvitations.ts`; watching it
again would double-decode every wrap.

**A kind-5 scope is added.** Every SDK read pairs itself with a deletion query —
`kanban-sdk` does this in `fetchBoards`, `fetchPrivateBoards` and `fetchCards`. That query
is not covered by any warm interest today, so it pays the full 700ms cold quiet window and
sets the floor for every refetch. The warm fast path is currently defeated by its own
companion query.

## 5. View scopes

Root scopes cover lists, not their contents, so a collaborator's card edit would still be
invisible. `kanbanStore.fetchCards(board)` opens a scope keyed by the board coordinate,
covering that board's cards and the deletions of anyone allowed to write them; its
`onChange` re-runs `fetchCards`.

No component changes: `KanbanPage` already re-runs `fetchCards` in an effect keyed on the
open board, so the store learns which board is open for free. `reset()` closes the scope,
and reset already runs on logout.

The calendar's event window is deliberately not a view scope in this slice — its
discovery path composes direct events, calendar-list refs and per-author deletions, so
scoping it correctly is its own piece of work. The calendars list going live covers the
common case.

## 6. Lifecycle

`retargetSession(pubkey)` in `authStore.ts` is the one place that already fires on login,
account switch and logout. Live sync is retargeted alongside it — but outside the
`isLocalRelayEnabled()` guard, because reactivity is backend-agnostic and must work with
the kill switch off.

## 7. Testing

Everything is driven through a fake `nostrRuntime.subscribe`, the pattern
`formsStore.test.ts` already uses; jsdom needs no Worker for any of it.

- liveSync: pre-EOSE events do not invalidate, a post-EOSE event does, a burst coalesces
  into one call, re-opening a key drops the previous subscription, `closeAll` drops all
- singleFlight: overlapping invalidations produce two fetches, not N
- scopes: each root scope's binding calls its store's fetch; the kind-5 scope is declared;
  `isCoveredBy` accepts the deletion filters the SDKs actually issue
- kanbanStore: `fetchCards` opens a scope on the board coordinate, switching boards closes
  the old one, `reset` closes it, an invalidation re-runs `fetchCards`
- regression: the existing suite stays green with no edits. A store test that has to
  change means the design leaked into the stores' public shape.

## 8. Risks

- **Refetch amplification.** One card edit re-decrypts a board's cards. Acceptable at
  current board sizes; coalescing is the mitigation.
- **Uncovered companion queries.** The kind-5 scope handles the known case. Any other
  uncovered sub-query silently reimposes the 700ms floor, so post-invalidation latency is
  measured during live verification rather than assumed.
- **#31 is not yet verified live.** This work stacks on it, so a substrate finding
  invalidates work here too.

## Out of scope

Event-level decode/upsert, an offline/outbox indicator, calendar event-window view scopes,
and `observe` inside components. Stores remain the state container; components are
untouched.
