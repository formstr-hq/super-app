# CLAUDE.md

## What this repo is

Formstr super-app: a pnpm monorepo hosting the Formstr web app (`packages/app`) plus — for now — the shared engine packages `packages/core`, `packages/agent`, and `packages/mcp`. Those three are mid-migration to the sibling repo `../common-packages` (github.com/formstr-hq/common-packages), which already hosts `@formstr/signer` and `@formstr/local-relay`.

**Sibling repos** (all under `/Users/skywalker/Coding/FOSS/formstr/`):

- `../common-packages` — shared packages monorepo; active work happens here (branches `migrate-mcp-core-agent`, `calendar-sdk`)
- `../nostr-calendar` — clone of `formstr-hq/nostr-calendar` (calendar.formstr.app). **No push access** — upstream contributions go via a fork (add fork remote or change URL before pushing)
- `../nostr-forms` — formstr-sdk lives at `packages/formstr-sdk` (`@formstr/sdk@0.2.7` on npm); its consumption model is the DX template for calendar-sdk

Conventions: `pnpm` is not installed globally — use `corepack pnpm …` (repos pin `packageManager: pnpm@9.0.0`). Commits: GPG-signed, no AI-attribution trailers. Package layering: `mcp → agent → core → signer`.

## Migration status (mcp/core/agent → common-packages, as of 2026-07-02)

Plan: [docs/superpowers/plans/2026-07-01-mcp-to-common-packages-migration.md](docs/superpowers/plans/2026-07-01-mcp-to-common-packages-migration.md) (checkboxes are current).

**Done (Tasks 1–5), verified green:** branch `migrate-mcp-core-agent` holds core (0.1.0), agent (0.1.0, tsup build), mcp (0.4.0); pushed to origin, **no PR yet**. Gates: `pnpm -r build` → `typecheck` → `test:coverage` all green (build before typecheck on a fresh clone — agent resolves core types from `dist`).

**Deferred (user-gated):**

- Open the PR: https://github.com/formstr-hq/common-packages/pull/new/migrate-mcp-core-agent
- Publish `@formstr/core` + `@formstr/agent` to npm. **MUST use `corepack pnpm publish --access public`, NOT `npm publish`** — only pnpm rewrites agent's `workspace:*` dep on core to `0.1.0`; npm ships the literal string and breaks installs.

**Pending in this repo (blocked on the publish):** Task 7 — branch `consume-core-agent-from-npm`, switch app deps to `^0.1.0`, `git rm -r packages/{core,agent,mcp}`, gate = app 243 tests + `tsc -b && vite build`. Task 8 — docs cleanup.

## Calendar SDK (current work, as of 2026-07-02)

**Goal:** ship `@formstr/calendar-sdk` consumable like `@formstr/sdk` (npm install → class → methods, zero relay wiring), converging super-app and calendar.formstr.app onto one protocol implementation.

**Reference doc:** [docs/sdk/calendar.md](docs/sdk/calendar.md) — fully re-verified against code 2026-07-02. Key corrections made then: upstream nip59 now uses **real timestamps** everywhere (no ±2d jitter, no `useRealTimestamp`); upstream's public-event fetcher is live again (not dead code) and writes legacy `["name", …]` tags (SDK writes `title`, reads both); day-event kinds 31922/32681 are **spec-only** (neither client implements); upstream isolates bad-list decrypt failures per list but still doesn't heal; §14 = packaging/consumption model; §15 has a "which side to copy, per concern" table.

**Status: v0.1.0 built and committed** — `../common-packages` branch `calendar-sdk`, commit `97a5707` (local only, not pushed). `packages/calendar-sdk`:

- Extracted from `agent/src/services/calendar` + core crypto; singletons → constructor DI. `new CalendarSDK({ signer })` defaults to a SimplePool runtime + the 9-relay cross-app set; hosts inject `runtime`/`relays`. Signer contract = FormsSigner-compatible (`getPublicKey, signEvent, nip44Encrypt, nip44Decrypt`, all required); `toCalendarSigner` bind-adapter for class signers; `LocalSigner` included. `wrapTimestamps: "jittered" (default) | "real"` covers the upstream divergence.
- Deps: only `nostr-tools`, `@noble/hashes`, `rrule` (CJS-interop shim in `codec/recurrence.ts` — don't revert to a named import).
- **Fix beyond the agent:** calendar-list republishes bump `created_at` monotonically (`max(now, prev+1)`). Same-second create-list → link-event writes otherwise tie and NIP-01 tie-breaking can resurrect the stale version, losing the ref + viewKey. **Latent race exists in agent and upstream — backport candidate.**
- Gates: 65 tests (real-crypto round-trips through an in-memory relay fake in `test/helpers.ts`), typecheck/build green, CJS+ESM smoke-tested in real Node. Workspace total: 932 tests green.

**Next steps (in order):**

1. Rewire `agent`'s calendar service as a thin wrapper over the SDK (convergence; agent tool surface unchanged)
2. Publish `@formstr/calendar-sdk` to npm (`corepack pnpm publish --access public`)
3. Fork-PR migrating calendar.formstr.app's protocol code (`src/common/nostr.ts`, `calendarList.ts`, `nip59.ts`) onto the SDK — it already consumes `@formstr/sdk` + `@formstr/signer` from npm
4. Upstream fix candidates for that PR (found 2026-07-02): `publishPublicCalendarEvent` emits locations as `["image", …]` (copy-paste bug); leftover `console.log("HERE!!!!!!!")` in `calendarList.ts` and `SIGNER-DECRYPT` logs in `nip59.ts`; stale `isRecurring` docstring in `stores/events.ts`

**Interop invariants the SDK enforces (don't regress):** private events must be linked into a calendar list (only discovery channel upstream renders; ref holds the viewKey); reuse `existingId` + `viewKey` on edit; inner `["d", id]` row inside encrypted payloads; deterministic RSVP d-tags; fetch own events window-free (`since`/`until` filter publish time, not event start).

## Uncommitted in this repo

`CLAUDE.md` (this file), the migration plan doc updates, and the `docs/sdk/calendar.md` rewrite — all docs-only, commit when convenient (suggested: `docs: calendar-sdk reference verified against code; migration + SDK status`).
