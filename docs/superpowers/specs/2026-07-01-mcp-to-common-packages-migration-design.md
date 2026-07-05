# Migrating `@formstr/mcp` (with `core` + `agent`) from super-app to common-packages

- **Status:** design approved, execution deferred (this doc is the runbook)
- **Date:** 2026-07-01
- **Target repo:** https://github.com/formstr-hq/common-packages
- **Source repo:** `formstr-hq/super-app` (this repo; monorepo root at `super-app/`)

## 1. Goal

Move the `@formstr/mcp` package out of the super-app monorepo and into
`common-packages`, the repo that already hosts the other shared Formstr/Nostr engine
packages (`@formstr/signer`, `@formstr/local-relay`). `@formstr/mcp` is published to npm
and is logically a _shared/leaf tool_ built on the shared engine, not part of the web
app — so common-packages is its natural home.

## 2. The core constraint (why this isn't "just move one package")

`@formstr/mcp` is **not self-contained**. Its real payload is a dependency chain:

```
@formstr/mcp  ──►  @formstr/agent  ──►  @formstr/core
      └─────────►  @formstr/signer (already in common-packages, npm ^0.2.2)
```

At build time, `tsup` bundles **agent and core into the single-file CJS output**
(`packages/mcp/tsup.config.ts`: `noExternal: [/^(?!@napi-rs\/keyring)/]`, i.e. inline
everything except the native keychain addon). So mcp cannot build without agent + core
resolvable.

Both `@formstr/agent` and `@formstr/core` are **private, unpublished, `workspace:*`
packages** today, and **`@formstr/app` (the web app) also depends on them** (plus
signer). They are shared engine code, not mcp-only.

Therefore moving mcp forces a decision about core + agent. The approved decision is to
**move all three** (core + agent + mcp) to common-packages.

## 3. Decisions (approved)

| Decision                                        | Choice                                                                     | Rationale                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**                                       | Move `core` + `agent` + `mcp` together to common-packages.                 | mcp can't build without them; they're shared "engine" packages that fit common-packages' stated purpose ("shared packages used across Formstr / Nostr ecosystem apps"), exactly like `signer`/`local-relay`.     |
| **How super-app consumes core+agent afterward** | **Publish to npm** as public packages; super-app depends via semver.       | Reuses the _exact_ pattern already working for `@formstr/signer@^0.2.2` (released from common-packages, consumed by super-app via npm). No git-submodule footguns; reproducible lockfile; clean semver boundary. |
| **Internal linking in common-packages**         | `mcp → agent → core → signer` all `workspace:*`.                           | mcp keeps bundling agent+core with tsup, so its npm tarball stays self-contained; only the _outside_ consumer (super-app) needs the npm release.                                                                 |
| **Initial core/agent version**                  | `0.1.0` (public).                                                          | They're leaving `0.0.1`/`private`; `0.1.0` signals first real public release without implying 1.0 stability.                                                                                                     |
| **Doc scope**                                   | Full end-to-end runbook (common-packages side **and** super-app rewiring). | Requested, so the work can be picked up later in one place.                                                                                                                                                      |

### Rejected alternatives

- **Publish core+agent but keep them in super-app** — duplication/versioning in two
  places, and mcp would lag super-app between releases. Rejected.
- **Vendor/snapshot core+agent into common-packages** — breaks the app/mcp lockstep the
  current layering guarantees (both consume the _same_ 53-tool registry). Drift risk.
  Rejected.
- **Git dependency / submodule for super-app** — no clean semver boundary,
  non-reproducible branch pins or SHA-pinning, `--recursive` clone + CI-init pain,
  pnpm git-deps don't run the dependency's build without a `prepare` hook. Rejected in
  favor of npm (which already works for signer).

## 4. Current-state facts (grounded in source)

### 4.1 super-app packages

| Package          | Version | Published              | Build                                               | Notes                                                                                            |
| ---------------- | ------- | ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@formstr/core`  | 0.0.1   | private                | `tsc -p tsconfig.json` → `dist`, `composite: true`  | `exports` already point at `./dist/*`. Clean lift-and-shift.                                     |
| `@formstr/agent` | 0.0.1   | private                | **none** (`noEmit: true`; exports raw `./src/*.ts`) | The real work: needs a build. Only workspace dep is `core`.                                      |
| `@formstr/app`   | 0.0.1   | private (Vite web app) | `tsc -b && vite build`                              | Consumer left behind. Deep-imports `@formstr/agent/services/*`. Stays in super-app.              |
| `@formstr/mcp`   | 0.4.0   | **public (npm)**       | `tsup` (CJS single file)                            | The thing being moved. Deps: `@napi-rs/keyring` runtime; agent/core/signer as devDeps + bundled. |

Baseline test gate (must stay green): **core 95 / agent 331 / mcp 81 / app 243** +
typecheck + build.

### 4.2 `@formstr/agent` `exports` map (must be preserved after build)

super-app imports agent via deep subpaths (e.g. `@formstr/agent/services/forms`). The
published package **must keep these exact keys**, only retargeting from `src/*.ts` to
`dist/*.js`/`.d.ts`:

```
".", "./services", "./services/forms", "./services/calendar", "./services/pages",
"./services/drive", "./services/polls", "./services/profile", "./services/*", "./tools"
```

### 4.3 mcp's actual `@formstr/*` import surface

mcp imports only the package roots — `@formstr/agent` (`toolRegistry`, `ToolCtx`,
`ToolResult`), `@formstr/core` (`relayManager`, `signerManager`, `nostrRuntime`,
`NostrSigner`, `SignerMethod`), and `@formstr/signer` (types + `createSigner`,
`encryptSecretKey`, `hexToBytes`). No deep agent/core subpaths from mcp — so mcp is
insensitive to how agent's internal `exports` are laid out, as long as the roots resolve.

### 4.4 common-packages repo (target)

- pnpm monorepo, `packageManager: pnpm@9.0.0`, `engines.node >=18`.
- `pnpm-workspace.yaml` globs `packages/*` **and** `apps/*`.
- Existing: `packages/signer` (`@formstr/signer` 0.2.2), `packages/local-relay`
  (`@formstr/local-relay` 0.4.0); `apps/tester`, `apps/local-relay-tester`.
- `signer`/`local-relay` are the **conventions to match**: `tsup` build emitting dual
  ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + types; `publishConfig.access: public`;
  `files: ["dist", ...]`; `repository.directory` set; `typecheck`/`test`/`test:coverage`
  scripts.
- Root scripts: `build`/`dev`/`typecheck`/`clean` are `pnpm -r ...`.
- `tsconfig.base.json` there: `strict`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `declaration`, `declarationMap`, `sourceMap`, `isolatedModules`, DOM libs. **Does NOT
  set** `noUnusedLocals`/`noUnusedParameters` (super-app's base does — see risk §7.3).
- **CI** (`.github/workflows/ci.yml`): on push/PR to main → `pnpm install --frozen-lockfile`
  → `pnpm -r typecheck` → `pnpm -r --if-present test:coverage` → `pnpm -r build`. **No
  publish workflow** (signer/local-relay are published manually, like mcp).

## 5. Target end-state

```
common-packages/
  packages/
    signer/       @formstr/signer      0.2.2  (unchanged)
    local-relay/  @formstr/local-relay 0.4.0  (unchanged)
    core/         @formstr/core        0.1.0  NEW — public
    agent/        @formstr/agent       0.1.0  NEW — public, now with a build
    mcp/          @formstr/mcp         0.4.0  moved — public (unchanged version)
  apps/           (unchanged)
```

- **Inside common-packages:** `mcp`, `agent`, `core` link via `workspace:*`
  (`mcp → agent, core, signer`; `agent → core`). mcp still bundles agent+core via tsup.
- **super-app after migration:**
  - `@formstr/app` deps: `@formstr/core: ^0.1.0`, `@formstr/agent: ^0.1.0` (npm), plus
    the existing `@formstr/signer: ^0.2.2`.
  - `packages/{core,agent,mcp}` deleted from super-app; workspace is just `app` (+
    whatever else remains).
  - App import sites unchanged (deep `exports` keys preserved).

## 6. Phased runbook

Each phase ends with a **green gate** before proceeding. Do this on a branch in each repo;
do not push/publish until the gate for that phase is green.

### Phase 0 — Prep & prerequisites

- [ ] Confirm npm publish rights for `@formstr/core` and `@formstr/agent` under the
      `@formstr` org (same account that publishes signer/local-relay/mcp; publishing is
      2FA/OTP-gated).
- [ ] Confirm the `@formstr/core` and `@formstr/agent` names are free/owned on npm.
- [ ] Decide the tsconfig-base strategy per package (§7.3).
- [ ] Snapshot current green gate in super-app: `pnpm -r typecheck`, tests
      (core 95 / agent 331 / mcp 81 / app 243), `pnpm -r build`.

### Phase 1 — Land core + agent + mcp in common-packages (no publish yet)

Work entirely inside a common-packages branch. Copy the three package directories
(`packages/core`, `packages/agent`, `packages/mcp`) over, then:

**core** (lightest):

- [ ] `package.json`: remove `private: true`; set `version: 0.1.0`; add
      `publishConfig.access: public`, `files: ["dist"]`, `license`, `repository`
      (`common-packages`, `directory: packages/core`), `homepage`, `bugs`.
- [ ] `tsconfig.json`: keep `extends: ../../tsconfig.base.json` (now resolves to
      common-packages' base); keep `outDir: dist`, `rootDir: src`, `composite: true`.
- [ ] Keep `@formstr/core` `exports` map as-is (already dist-targeted).

**agent** (the real work — give it a build):

- [ ] Add a `tsup` build (match signer/local-relay): multi-entry so every current
      `exports` subpath is emitted. Entries at minimum:
      `src/index.ts`, `src/services/index.ts`, `src/services/{forms,calendar,pages,drive,polls,profile}/index.ts`,
      the `./services/*` catch-all files, and `src/tools/index.ts`. Emit ESM + CJS + `.d.ts`.
- [ ] `package.json`: remove `private: true`; `version: 0.1.0`; add `type: module`,
      `publishConfig.access: public`, `files: ["dist"]`, `license`, `repository`,
      `homepage`, `bugs`; add `"build": "tsup"` and `"test:coverage"`; add `tsup` +
      `@types/node` (if needed) to devDeps.
- [ ] **Rewrite `exports` to point at `dist`** while keeping every key identical
      (see §4.2). Add a `types`/`main`/`module` top-level trio like signer.
- [ ] `@formstr/core` dep → `workspace:*`.
- [ ] tsconfig: agent currently `noEmit: true` with a project reference to `../core`.
      Keep a `noEmit` tsconfig for typecheck; let `tsup` own emit. The `../core`
      project reference still resolves (sibling). Verify `types: []` still appropriate.

**mcp** (lift-and-shift):

- [ ] `package.json`: move `@formstr/agent`, `@formstr/core`, `@formstr/signer` from
      `devDependencies` to `workspace:*` (dev is fine too since tsup bundles them, but
      `workspace:*` is clearer intent). Update `repository`/`homepage` → common-packages.
- [ ] Add a `"test:coverage"` script (see §7.2 — CI would otherwise skip mcp's tests).
- [ ] `tsup.config.ts` unchanged.
- [ ] Bring `docs/MCP.md` along (into `packages/mcp/` or common-packages `docs/`), and the
      e2e harness `test-create-form.mjs`.

**Workspace-level:**

- [ ] `pnpm-workspace.yaml`: no glob change needed (`packages/*` already covers them).
      **But** add pnpm-9 build-script allowances (§7.1): permit **esbuild** (vitest) and
      **`@napi-rs/keyring`** (mcp native addon) to run their install/build scripts —
      via `pnpm.onlyBuiltDependencies` (root `package.json`) or the workspace
      `allowBuilds` mechanism the repo prefers.
- [ ] `pnpm install --no-frozen-lockfile` (updates `pnpm-lock.yaml`).

**Phase-1 gate (in common-packages):**

- [ ] `pnpm -r typecheck` green.
- [ ] Tests green: core 95, agent 331, mcp 81. (Run vitest directly per package if the
      workspace test wrapper trips the esbuild deps-check:
      `node ../../node_modules/vitest/vitest.mjs run`.)
- [ ] `pnpm -r build` green — **and** inspect mcp's `dist/index.js`: it must have inlined
      agent + core (self-contained, keyring external), same as today.
- [ ] Smoke: `node packages/mcp/dist/index.js version` prints `@formstr/mcp 0.4.0`.

### Phase 2 — Publish core + agent to npm

- [ ] Bump/confirm `@formstr/core` and `@formstr/agent` at `0.1.0`.
- [ ] `pnpm --filter @formstr/core build && pnpm --filter @formstr/agent build`.
- [ ] Publish each: `npm publish --access public --otp=<code>` (2FA). Verify each tarball
      `files` ships `dist` only, no workspace refs, no source leakage of secrets.
- [ ] (mcp is **not** re-published here — it changed repos but not code/version; publish
      mcp only if/when you cut a new mcp version. Its bundle is unaffected by where
      core/agent are hosted.)

### Phase 3 — Rewire super-app to consume core+agent from npm

Work on a super-app branch.

- [ ] `@formstr/app` `package.json`: `@formstr/core` and `@formstr/agent` →
      `^0.1.0` (npm), matching how `@formstr/signer: ^0.2.2` is already declared.
- [ ] Delete `packages/core`, `packages/agent`, `packages/mcp` from super-app.
- [ ] `pnpm-workspace.yaml` / root scripts: still `packages/*`; now resolves just `app`
      (+ any remaining). Remove per-package references from root orchestration if any are
      hardcoded.
- [ ] `pnpm install --no-frozen-lockfile`.
- [ ] **Gate:** app builds (`tsc -b && vite build`) and its 243 tests pass against the
      npm core/agent. Sanity-check the deep imports (`@formstr/agent/services/forms`)
      resolve from the published `exports`.

### Phase 4 — Cleanup & docs

- [ ] super-app `docs/ARCHITECTURE.md` + `docs/MCP.md`: update to reflect that core/agent/
      mcp now live in common-packages and are consumed from npm. The "four packages"
      framing becomes "the web app, consuming shared engine packages from common-packages."
- [ ] Redirect mcp `homepage`/`repository` links (npm README) to common-packages.
- [ ] common-packages `README.md`: list the three new packages.
- [ ] CLAUDE.md / handoff notes: update the repo-layout and gate baselines.
- [ ] Confirm common-packages CI (typecheck + `test:coverage` + build) passes on main
      with all five packages.

## 7. Gotchas & risks (found during investigation)

### 7.1 pnpm-9 build-script gating (install/test/runtime break if missed)

common-packages' `pnpm-workspace.yaml` has **no** `allowBuilds` (super-app's has
`allowBuilds: esbuild: true`). Under pnpm 9, dependency build/postinstall scripts are
blocked by default. Two dependencies need to run scripts:

- **esbuild** (transitive via vitest/tsup) — needed for tests to run.
- **`@napi-rs/keyring`** (mcp's only runtime dep) — a **native addon**; its
  install-time build must be allowed or the keychain won't load at runtime.
  Add both to the repo's allow mechanism (`pnpm.onlyBuiltDependencies` in root
  `package.json`, or the workspace `allowBuilds` block, whichever the repo standardizes on).

### 7.2 CI silently skips mcp tests

common-packages CI runs `pnpm -r --if-present test:coverage`. **mcp has only a `test`
script**, no `test:coverage` → its 81 tests are skipped in CI. core and agent already
have `test:coverage`. **Fix:** add `test:coverage` to mcp (`vitest run --coverage` +
`@vitest/coverage-v8` devDep) so CI actually exercises it. (Also note mcp's test includes
a stdio smoke test.)

### 7.3 tsconfig strictness delta

super-app base sets `noUnusedLocals` + `noUnusedParameters`; common-packages base does
**not**. If the moved packages extend common-packages' base, those checks relax (won't
break anything, but you lose the guardrail). Decision to make: either (a) accept
common-packages' base as-is, or (b) re-add the two flags in each moved package's local
tsconfig to preserve current strictness. Recommend (b) for core/agent/mcp to avoid
silently loosening the packages during the move.

### 7.4 agent's source-exports → dist-exports (the one behavioral change)

Today agent publishes raw `.ts` (works only because every consumer is a bundler in the
same monorepo). After the move it ships compiled `dist`. **The published `exports` map
must keep every current subpath key** (§4.2) so super-app's deep imports don't change.
Verify by building agent and resolving each subpath from a scratch consumer before
publishing.

### 7.5 Version drift (optional cleanup, not a blocker)

`@noble/hashes`: core `^2.0.1` vs agent `^1.8.0`. `nostr-tools`: core `^2.16.0`, agent/mcp
`^2.23.3`, signer `^2.7.0`, local-relay `^2.23.5`. These are bundled per-package today and
already coexist in super-app, so not a migration blocker — but the move is a good moment to
align `@noble/hashes` and `nostr-tools` ranges across core/agent/mcp.

### 7.6 Metadata retargeting

`repository`, `homepage`, `bugs` in core/agent/mcp point at `super-app`. Retarget all to
`common-packages` with the correct `directory`.

### 7.7 Signer coupling reminder

`@formstr/signer` classes use **unbound private-field methods** — copying a bare method
ref detaches `this` (`Cannot read private member #e`). mcp already wraps them correctly in
`toNostrSigner.ts`; no change, but keep this in mind if touching the adapter during the
move. (Same class of bug as the calendar form-fill issue in `issue.md`.)

## 8. Verification checklist (final)

- [ ] common-packages: `pnpm -r typecheck` + tests (core 95 / agent 331 / mcp 81) +
      `pnpm -r build` all green; mcp `dist` self-contained; `formstr-mcp version` works.
- [ ] npm: `@formstr/core@0.1.0` and `@formstr/agent@0.1.0` published, tarballs clean.
- [ ] super-app: app builds + 243 tests pass against npm core/agent; deep imports resolve.
- [ ] mcp end-to-end still works from the published/bundled artifact
      (`FORMSTR_MCP_NCRYPTSEC_PASSPHRASE=… node packages/mcp/test-create-form.mjs`).
- [ ] Docs updated in both repos.

## 9. Rollback

- Phases 1–2 are additive to common-packages and don't touch super-app; abandon the
  common-packages branch to roll back (unpublish/deprecate npm versions if already
  pushed — prefer `npm deprecate` over unpublish).
- Phase 3 is the only destructive step for super-app (deleting the three packages). Keep
  it on a branch; do not merge until the app gate is green. Rollback = revert the branch;
  super-app's `packages/{core,agent,mcp}` are restored and workspace links resume.

## 10. Open items to confirm before executing

- npm ownership/rights for `@formstr/core` + `@formstr/agent` (Phase 0).
- Which pnpm build-allow mechanism common-packages standardizes on (§7.1).
- tsconfig base strategy per package (§7.3).
- Whether `docs/MCP.md` should live under `packages/mcp/` or a top-level `docs/` in
  common-packages.
