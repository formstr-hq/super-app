# Week 1 & 2 — Project Setup & Shared Foundation

**Status:** Draft → awaiting user review
**Date:** 2026-05-27
**Author:** Naman Khandelwal (with Claude)
**Scope window:** Proposal weeks 1 & 2 only — no module UI, no AI, no upstream PRs

---

## Goal

Bring the existing `formstr-super-app` prototype to a production-grade foundation that all subsequent module work (weeks 3–10) can build on without revisiting. Match the proposal's week 1 & 2 deliverables literally:

- Monorepo with `@formstr/core` + `@formstr/app`
- TypeScript, linting, formatting, automated testing — from the start
- Shared login (NIP-07, nsec, guest) with instant restore
- Shared relay layer (NIP-65 aware)
- Shared encryption utilities (NIP-44, NIP-59, AES-GCM, NIP-49)
- Cross-module linking

The prototype already covers these in shape. This spec is about **hardening**, not greenfield building.

## Approach decision: Refine, don't rewrite

The current `packages/core` (~2 200 LOC) is structurally sound:

- `signer/` — two-phase restore via `DeferredSigner` (instant startup, async resolution) — keep
- `runtime/` — `SimplePool` + `EventStore` + `SubscriptionManager` with batching — keep
- `relay/` — NIP-65 aware `RelayManager`, `OutboxService` — keep
- `crypto/` — NIP-44, NIP-59 giftwrap, AES-GCM, NIP-49 (`nkeys`) — keep (with bug fixes)
- `linking.ts` — naddr/nevent/nprofile → module route — keep

Rewriting from scratch was considered and rejected: ~3× the work and discards working code. Tooling-only (deferring tests) was also rejected — the proposal explicitly says "automated testing from the start", and the bugs identified below would silently break weeks 5–6 (Calendar invitations) if not caught now.

## Upstream module strategy

The five formstr-hq modules (`nostr-forms`, `nostr-calendar`, `nostr-polls`, `nostr-docs`, `formstr-drive`) are **reference only** during this project:

- Cloned fresh into `./upstream/` via `scripts/sync-upstream.sh`
- `./upstream/` is `.gitignore`d — never committed, never in `pnpm-workspace.yaml`
- We never modify them, never PR from this repo, never `git push` them
- Used only as a source-of-truth grep target when porting logic into `@formstr/app` in weeks 3–8
- The current flat snapshots at the repo root (`nostr-forms/`, `nostr-calendar/`, etc.) are deleted

Bugs spotted upstream during week 1–2 reading get noted in `docs/upstream-notes.md` for the user's separate contribution work later. Out of scope for this spec.

---

## PR breakdown

Work lands in **four small PRs**, in order. Each is independently reviewable and shippable. CI must be green before the next PR opens.

### PR #1 — `chore: tooling & CI`

Concrete files added or changed:

- `eslint.config.js` (root, flat config) — `@typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-import` with sort rules. Same config for both packages.
- `.prettierrc` (root) — `{ "semi": true, "singleQuote": false, "printWidth": 100, "trailingComma": "all" }`. Matches `nostr-calendar`'s style for consistency with upstream.
- `.prettierignore` — `dist/`, `node_modules/`, `upstream/`, lockfiles
- `vitest.workspace.ts` (root) — references both packages
- `packages/core/vitest.config.ts` — `environment: "node"`, `coverage: { provider: "v8", reporter: ["text", "html"] }`
- `packages/app/vitest.config.ts` — `environment: "jsdom"`, alias `@/*` mirrored from `tsconfig`
- `.github/workflows/ci.yml` — matrix on Node `20`/`22`: install (`pnpm install --frozen-lockfile`) → typecheck → lint → test → build. PRs blocked on failure. Coverage uploaded as artifact (not gating).
- `.husky/pre-commit` + `lint-staged.config.js` — format + lint changed files only
- `.editorconfig` — UTF-8, LF, 2-space indent, final newline
- `.nvmrc` — `20`
- `scripts/sync-upstream.sh` — idempotent `git clone --depth=1` or `git pull --ff-only` of all five `formstr-hq/*` repos into `./upstream/`. Logs branch + sha after sync.
- Root `package.json` adds scripts: `format`, `format:check`, `prepare` (husky install)
- `.gitignore` updated — `upstream/`, coverage outputs, `*.tsbuildinfo` if not already
- Delete old flat snapshots: `nostr-forms/`, `nostr-calendar/`, `nostr-polls/`, `nostr-docs/`, `formstr-drive/`, `exx/`, `.obsidian/`, top-level orphan `Pasted image *.png`, `diagram-export-*.svg`, `namankhandelwal.me.md`, `docs/backup.css`, `docs/backup.md`, `docs/screenshots.md`
- `README.md` updated — quickstart (`pnpm install && pnpm dev`), CI badge, link to this spec

Acceptance: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` is green on a fresh clone. CI badge green.

### PR #2 — `refactor(core): security pass + tests`

#### Crypto fixes

1. **`wrapManyEvents` correctness bug** — [packages/core/src/crypto/nip59.ts:99-115](packages/core/src/crypto/nip59.ts#L99-L115)
   Current behaviour: creates one seal encrypted to `recipientPubkeys[0]`, then wraps that single seal for every recipient. Recipients 2..N decrypt the outer wrap but get a seal they can't decrypt — they cannot read the rumor. Violates NIP-59 (each recipient must get their own seal).
   Fix: create a fresh seal per recipient inside the loop.
   Regression test: 3 generated keypairs as recipients, wrap a known rumor, decrypt as each recipient, assert all three see the rumor.

2. **Wipe secrets on logout** — `LocalSigner` retains `secretKey: Uint8Array` in memory after `signerManager.logout()`. Add `dispose()` method to `LocalSigner` that calls `secretKey.fill(0)`; have `SignerManager.logout()` call it.
   Test: spy on the secretKey byte array, verify it's all zeros after logout.

3. **Audit `nkeys.ts` for non-constant-time comparisons.** If a `===` on bytes-equivalent values is found, switch to `@noble/hashes/utils#equalBytes`. If none found, document the audit in the test file as a comment.

4. **Storage hardening test** — assert that if `KEY_SECRET` exists but `KEY_METHOD` is missing, `SignerManager.restore()` does not load the secret. Today this works by coincidence (the switch in `resolveSignerAsync` has no path for a missing method); a test pins the behaviour.

#### Signer refactor

- Move `bytesToHex`/`hexToBytes` out of `SignerManager.ts` into `packages/core/src/crypto/hex.ts`. Re-export `bytesToHex`/`hexToBytes` from `@noble/hashes/utils` (transitive dep of `nostr-tools` — verify in lockfile before relying on it; if not transitive, add directly). Single source of truth across the codebase.
- Rename `SignerManager.restoreFromStorage(): void` → `restore(): Promise<void>`. Internally `await` the full Phase 1 + Phase 2 resolution chain so callers can sequence on it. (Optional for instant UX: keep `restoreSync()` that returns immediately, but the main API is `restore()`.)
- Introduce `SignerUnavailableError extends Error` with `code: "no-signer" | "no-modal"`. `getSigner()` throws this instead of plain `Error`. Consumers can catch and trigger login.

#### Relay refactor

- Split [packages/core/src/relay/RelayManager.ts](packages/core/src/relay/RelayManager.ts): `DEFAULT_RELAYS` stays in `RelayManager.ts`; `MODULE_RELAYS` moves to `packages/core/src/relay/module-defaults.ts` and is exported as `MODULE_DEFAULT_RELAYS`. Drop the misleading "backwards compatibility" comment.
- Fix relay URL typo: replace `wss://relay.nos.lol` with `wss://nos.lol` in every defaults list. Audit by grep across `packages/core`.
- Add `RelayManager.dispose(): void` — resets `userRelays = []`, used by tests.

#### Runtime

- Add `NostrRuntime.dispose()` and `SubscriptionManager.dispose()` that close every active sub and clear pools. Tests need this to avoid open handles.
- Fix fragile `entries.values().next().value!` in `NostrRuntime.flushBatch` — store `relays` explicitly on the `group` object.

#### Linking

- `parseRef` for `nevent` with unknown `kind` currently defaults `module: "forms"`. Change to return `null`. This matches the existing behaviour for `naddr` with unknown kinds.
- Add a defensive test: pass an `naddr` for `kind 30617` (Nostr Git repo) — assert `null`, no throw.

#### Tests added (target ≥85% line coverage on `packages/core/src/`)

- `signer/SignerManager.test.ts` — login flows (NIP-07 mocked, nsec, guest), `restore()` cycle, logout wipes secret, `SignerUnavailableError` typed
- `signer/LocalSigner.test.ts` — `signEvent` produces a verifiable signature; `dispose()` zeros bytes
- `crypto/nip44.test.ts` — round-trip self-encrypt/decrypt; throws on signer missing `nip44Encrypt`
- `crypto/nip59.test.ts` — full `wrapEvent`/`unwrapEvent` round-trip; **`wrapManyEvents` per-recipient seal** (regression); `randomizeTimestamp` stays inside ±2 days window
- `crypto/nkeys.test.ts` — NIP-49 encode/decode round-trip; wrong-password throws
- `crypto/aesGcm.test.ts` — round-trip; wrong-key throws; IV uniqueness across calls
- `relay/RelayManager.test.ts` — NIP-65 parsing (read-only marker, write-only marker, no marker = both); falls back to defaults when user list empty
- `linking.test.ts` — naddr/nevent/nprofile parse + roundtrip; unknown kind → null; malformed bech32 → null
- `runtime/EventStore.test.ts` — store, query by kind+pubkey+d-tag, replaceable event replacement (kind 30000+ semantics)

Coverage gating is **non-blocking in CI** for this PR (reported, not enforced). Enforcement starts in PR #4.

### PR #3 — `refactor(app): wire core hardening through stores`

Small consumer-side PR. No new features — adapt to the refactored `@formstr/core` API.

- [packages/app/src/stores/authStore.ts](packages/app/src/stores/authStore.ts):
  - `init()` switches from `signerManager.restoreFromStorage()` (sync) to `await signerManager.restore()` (async). Drop the manual `signerManager.getState()` re-read after — the `onChange` subscriber already pushes state into the store.
  - Initial `isLoading` is `false`, not `true`. App must render instantly per proposal ("App loads instantly without a loading screen"). Only flip to `true` on explicit user action (clicking a login button).
- [packages/app/src/components/LoginDialog.tsx](packages/app/src/components/LoginDialog.tsx): catch `SignerUnavailableError` separately with a clearer message ("Browser extension not detected — install Alby, nos2x, or use private key").
- [packages/app/src/layout/AppShell.tsx](packages/app/src/layout/AppShell.tsx): on `authStore` reporting a pubkey, fire-and-forget `relayManager.fetchUserRelays(pubkey)` once. Don't await — modules read from the singleton later.
- `packages/app/src/stores/authStore.test.ts` — mocked `signerManager`; covers init, three login methods, logout. `jsdom` environment.
- Verify dev server (`pnpm dev`): three login methods + reload + logout work end-to-end. Capture as part of PR description, not a test.

### PR #4 — `feat(linking): tag-ref helpers + route registry + coverage gate`

- `packages/core/src/linking.ts`: add `createTagRef(module, identifier): string` returning `"formstr:<module>:<identifier>"` and `parseTagRef(s): { module, identifier } | null`. Both are tested. This mirrors the proposal's `r`-tag format that's distinct from bech32 user-facing URLs.
- `packages/core/src/linking.ts`: add `MODULE_ROUTES: Record<ModuleType, string>` registry. `parseRef` uses it instead of hardcoding `/${module}/${bech32}`. Single source of truth that the AI router (week 9-10) will read.
- Tests added to `linking.test.ts` covering the new helpers.
- CI gate switched on: `pnpm test --coverage` fails the build if `packages/core/src/` line coverage drops below 85%.
- `CONTRIBUTING.md` added at root — quickstart, conventions (Prettier, ESLint, conventional commits), and a short "how to add a new module" section sketching: `services/<module>/`, `stores/<module>Store.ts`, `pages/<module>Page.tsx`, kind registration in `linking.ts`, route in `router.tsx`. Matters because weeks 3–8 are exactly this, six times.

---

## Non-goals (explicit, to keep scope honest)

- ❌ No new module functionality (forms editor, calendar UI, etc.) — weeks 3-8
- ❌ No AI work — weeks 9-10
- ❌ No upstream PRs to formstr-hq repos
- ❌ No PWA / mobile wrapper / plugin system — listed under "Future Deliverables" in proposal
- ❌ No deletion of existing app pages even though they're rough — they get rewritten in their respective module weeks
- ❌ No refactor of `@formstr/core` internals beyond the specific bugs and smells called out in PR #2

## Definition of done

A reviewer pulling `main` after week 2 sees:

1. `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green on a fresh clone
2. CI badge green on README
3. `packages/core/src/` line coverage ≥85%, enforced in CI
4. The `wrapManyEvents` correctness bug is fixed and has a regression test
5. Login (NIP-07 + nsec + guest) all work end-to-end in the dev server, with instant restore on reload (no loading screen flash)
6. Pasting a `naddr` into the URL routes to the correct module (or to a 404 if unknown kind — not a silent default)
7. `CONTRIBUTING.md` exists with the "how to add a new module" section
8. `./upstream/` exists after running `scripts/sync-upstream.sh` and is `.gitignore`d

## Risks and mitigations

- **R1: NIP-07 testing is awkward** — `window.nostr` doesn't exist in `jsdom`. Mitigation: tests mock `window.nostr` with a stub implementing the `NostrSigner` interface. Manual dev-server verification covers the real path.
- **R2: Husky pre-commit slowing down commits** — first-time setup. Mitigation: `lint-staged` only runs on changed files; typical commit <2s.
- **R3: 85% coverage gate is brittle** — refactors can dip below. Mitigation: gate applies only to `packages/core/src/`, not the app. Untested files are listed in `vitest.config.ts` `coverage.exclude` (currently empty, but reserved).
- **R4: Module-specific relay subsets are subjective** — each upstream module hardcodes a different list. Mitigation: document the picked defaults in `module-defaults.ts` JSDoc with the rationale (e.g. "kept upstream Polls list because Yakinonne relay carries most poll events").

## Out-of-band noted: real bugs found while reading

For your contribution backlog, not this project:

- `wrapManyEvents` bug exists in `nostr-calendar`'s `nip59.ts` too (same code shape, since this version was extracted from Calendar). PR-worthy.
- Relay URL typo `wss://relay.nos.lol` likely traces back to one of the upstream modules. Worth grepping upstream after the sync script runs.

Tracked in `docs/upstream-notes.md` (created in PR #1).
