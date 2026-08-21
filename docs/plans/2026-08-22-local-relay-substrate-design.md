# Local-relay substrate

**Date:** 2026-08-22
**Status:** approved, implementing
**Scope:** replace the app's SimplePool network substrate with `@formstr/local-relay`,
without changing any store, component, or relay-selection call site.

## Why

Core's `EventStore` is in-memory, so every reload starts cold. Each module mount fires
a `querySync` with a 10s timeout against 3–4 relays and shows a spinner until EOSE.
Nothing survives a refresh, and a publish is a `Promise.allSettled` that resolves and
forgets — an event written on flaky wifi is simply lost.

`@formstr/local-relay` (0.6.1 on npm) solves all three: an IndexedDB-backed store that
survives sessions, a worker that owns every connection decision from the union of active
interests, and a durable outbox that re-delivers on reconnect. calendar.formstr.app
already runs on it, so adopting it here also converges the two clients onto one data
layer.

## What this project is not

Reactive UI is the obvious follow-on and is deliberately out of scope. This project
changes what is _under_ `nostrRuntime` and nothing above it: no store rewrites, no
`observe` in components, no changes to the 123 `getRelaysForModule` call sites, no NIP-65
migration for module reads. `observe` adoption gets its own design once this is live.

## Decisions

| Question          | Decision                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Publish targeting | Add an optional `relays` hint to local-relay's publish, symmetric with the one `observe` already takes    |
| Injection         | Settable singleton in core; the local-relay adapter lives in the app                                      |
| Read freshness    | Long-lived warm-up interests declared at login, so reads settle fast against a continuously updated cache |
| Rollout           | Dev-facing kill switch (localStorage + env), no user-facing surface                                       |

## 1. The seam in `@formstr/core`

`query`, `get` and `fetchBatched` have no callers outside core. The surface the app
actually depends on is five methods, which become `NostrRuntimeContract`:

```ts
interface NostrRuntimeContract {
  subscribe(relays: string[], filters: Filter[], options?: SubscribeOptions): SubscriptionHandle;
  fetchOne(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event | null>;
  querySync(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event[]>;
  publish(relays: string[], event: Event, timeoutMs?: number): Promise<void>;
  dispose(): void;
}
```

Core gains `setNostrRuntime(impl)` / `getNostrRuntime()`, and the exported `nostrRuntime`
becomes a thin delegating object over the installed implementation, defaulting to today's
`NostrRuntime`. Every agent service, `kanban/sdk.ts` and `lib/calendar/sdk.ts` keeps
importing the same symbol and passing it to SDKs unchanged. MCP never calls the setter,
so Node keeps SimplePool.

`query`/`get`/`fetchBatched` stay on the `NostrRuntime` class as internals rather than
entering the contract — nothing outside core calls them, and a cache-only backend cannot
answer them synchronously.

**NIP-46 moves off the runtime.** `nostrRuntime.pool` is used by the bunker unlock in
`authStore.ts` and patched for Node in `mcp/bootstrap.ts`. Signer transport was never app
data, so core exports a dedicated `signerPool` and both point there. That is what frees
the contract from exposing a `pool` the local-relay backend does not own.

## 2. `@formstr/local-relay` 0.7.0 — publish relay hints

The worker computes publish targets itself (author write relays ∪ user relays ∪ p-tag
inboxes) and takes no per-publish relay argument. Super-app publishes to fixed per-module
lists, and kanbanstr interop depends on kanban events landing on the kanban set.

An optional hint threads through the existing layers:

- `DataLayer.publish(template, { relays })` and `publishEvent(event, { relays })`
- `LocalRelayClient.publish(event, relays?)`
- frame `{ kind: "publish"; pubId; event; relays? }` → `WorkerHost`
- `RelayService.publishUpstream(pubId, event, hints)` → `publishTargets(event, hints)`

`publishTargets` unions the hints into the set it already computes. The outbox needs no
change: debt is derived from actual per-relay results, so a hinted relay that times out is
retried like any other.

This mirrors the read side, where `ObserveOptions.relays` already means "relays the app
knows hold this data". It does not weaken the load-bearing principle — the worker still
decides what to open and when; the hint only adds targets it would not otherwise know.

## 3. The adapter

`packages/app/src/lib/localRelay/LocalRelayRuntime.ts` implements `NostrRuntimeContract`
over `observe` and `publishEvent`:

| Contract method                 | local-relay                                              |
| ------------------------------- | -------------------------------------------------------- |
| `subscribe(relays, filters, h)` | `observe(filters, h, { relays })`; `unsub` → `unobserve` |
| `querySync(relays, filter, t)`  | temporary `observe`, collect, settle on a quiet window   |
| `fetchOne(relays, filter, t)`   | same, resolves on the first matching event               |
| `publish(relays, event)`        | `publishEvent(event, { relays })`                        |
| `dispose()`                     | unobserve everything, terminate the worker               |

The settle policy is the delicate part. Local EOSE is **not** completion: the data layer
fires it after replaying the local store, which on a cold cache is empty while the upstream
fetch is still streaming. So a one-shot read settles on a quiet period instead, with a hard
cap so it can never hang. calendar-sdk's `LocalRelayRuntime` already ships a proven version
of exactly this (700ms quiet window, 4000ms hard cap); port it rather than reinvent it, then
layer on the warm-cache fast path.

A read is **warm** when its filter is covered by a standing warm-up interest — same kinds,
and its `authors`/`#d`/`#a` constraints are a subset of the declared interest's. The
registry keeps the declared filters for exactly this test. A warm read settles on a 150ms
grace period rather than the full quiet window, because the interest keeping that scope
fresh is already running. Everything else is cold and pays the quiet window.

One qualification, found while building it: an interest that exists is not yet an interest
that has synced. A cache restored from IndexedDB holds whatever was true when the tab last
closed, and for the first round trip after sign-in the standing interest has not corrected
it. A read settled early in that window shows the stale copy, and nothing re-renders it
while the stores remain non-reactive. So the registry vouches for nothing for the first
3 seconds after declaring: until then every read behaves exactly as it does today.

## 4. Warm-up interests

A registry in the app collects, per module, the filters describing the logged-in user's own
scope, and declares them as long-lived observes once at login:

- forms — kind 14083 my-forms list, authored by the user
- kanban — the user's boards (30301 public, 32301 private) and the 32303 private-board list
- calendar — 32123 calendar lists, and the 1059 invitation stream
- drive — the file-metadata index
- profile — kind 0 for the user

These are the same reads modules already fire on mount, hoisted to boot and left standing.
The cache stays continuously fresh, which is what makes the fast settle safe. Handles are
owned by the registry and dropped on logout, so no component owns a subscription and
nothing about the UI changes.

## 5. Lifecycle and account isolation

The stock `@formstr/local-relay/worker` entry uses `IndexedDBStorage("shared")` — one
database for every account. Super-app has an account switcher, so it ships its own worker
entry: identical wiring, but namespaced by the active pubkey.

- **login** — spawn the worker with namespace = pubkey, build the `DataLayer`,
  `setUserRelays(NIP-65 read relays ∪ defaults)`, declare warm-up interests, then
  `setNostrRuntime(adapter)`
- **account switch** — tear the worker down and respawn under the new namespace, so each
  account keeps its own warm cache and switching back is still instant
- **logout** — drop interests, terminate the worker, delete the namespaced database
- **`visibilitychange`** — `pause()` / `resume()`, so a backgrounded tab holds no sockets

Signing is unchanged: the `DataLayer`'s `sign` resolves through `signerManager.getSigner()`
like every other module, and NIP-46 keeps the dedicated pool from section 1.

## 6. Kill switch

`localStorage["formstr.localRelay"] === "off"` (with a Vite env default) decides at boot
whether `setNostrRuntime` is called at all. Off leaves the delegating singleton on its
SimplePool default, and nothing else in the app can tell the difference. One branch in one
file, deleted once live verification passes.

## 7. Testing

jsdom has no `Worker`, and local-relay is built for that: `createChannelPair()` runs a real
`RelayService` in-process, `MemoryStorage` replaces IndexedDB, and the testkit's
`fakeSocketFactory` replaces sockets. The adapter is tested against the actual relay
engine rather than a mock of it.

- adapter: each contract method, and the settle policy — cold cache waits for the quiet
  window, a warm scope settles on the short grace, the hard cap always fires
- publish targeting: a hinted publish reaches the module relays. This is the regression
  that would break kanbanstr interop, so it gets a dedicated test
- warm-up registry: interests declared on login, dropped on logout, respawned on switch
- regression: agent service tests that exercise the SimplePool runtime pass unchanged
  against the adapter
- local-relay: publish-hint tests land in that package, in its own PR

## 8. Risks

- **Settle policy is where bugs will hide.** Too eager shows a board one edit behind; too
  patient feels slower than today. The warm/cold distinction is the mitigation, and it is
  only as good as the warm-up filter coverage.
- **Cross-repo sequencing.** local-relay 0.7.0 must be on npm before the app branch can
  merge — an unpublished pin breaks every `pnpm` invocation in super-app, including the
  husky hook. Local development consumes a packed tarball until then.
- **`relay.nostr.band` already times out from the browser.** It will now surface as outbox
  debt rather than a silent failure. That is an improvement, but a visible one.

## Landing plan

1. local-relay publish hints — PR on `common-packages` off `main`, independent of the open
   #25/#26 stack. Publish 0.7.0.
2. App branch `feat/local-relay-substrate` off `dev`: core seam, adapter, warm-up registry,
   worker entry, kill switch, boot wiring. Consumes a packed tarball until 0.7.0 is live,
   then pins `^0.7.0`.
3. Live verification against real relays before the kill switch is removed.
