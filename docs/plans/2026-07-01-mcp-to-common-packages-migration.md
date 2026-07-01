# Migrate `@formstr/mcp` (+ core, agent) to common-packages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `@formstr/core`, `@formstr/agent`, and `@formstr/mcp` out of the super-app monorepo into the `common-packages` monorepo, publish core+agent to npm, and rewire super-app to consume them from npm.

**Architecture:** All three packages land in `common-packages/packages/*` and link internally via `workspace:*` (`mcp → agent → core → signer`). `mcp` keeps bundling agent+core with `tsup`, so its npm tarball stays self-contained. `agent` — which today ships raw `.ts` with no build — gets a `tsup` build matching the `signer`/`local-relay` convention, preserving every `exports` subpath key so super-app's deep imports don't change. super-app then consumes `@formstr/core`/`@formstr/agent` from npm, exactly as it already consumes `@formstr/signer@^0.2.2`.

**Tech Stack:** pnpm 9 workspace, TypeScript 5, tsup (esbuild), Vitest, `@modelcontextprotocol/sdk`, `@napi-rs/keyring`, nostr-tools.

**Companion design doc:** removed in the 2026-07-02 docs cleanup; available in git history at `docs/superpowers/specs/2026-07-01-mcp-to-common-packages-migration-design.md` (rationale + rejected alternatives).

## Global Constraints

- **Working clone of common-packages:** `/Users/skywalker/Coding/FOSS/formstr/common-packages` (sibling of super-app; branch `migrate-mcp-core-agent`). _(Plan originally referenced `/extra/formstr/…` paths from a different environment — those do not exist on this machine; all paths below were rewritten 2026-07-02.)_ This is NOT the stale gitignored reference clone at `super-app/upstream/common-packages` (pinned at `507322e`, signer-only) — do not use that one.
- **super-app rewiring** happens on a super-app branch `consume-core-agent-from-npm` (super-app root: `/Users/skywalker/Coding/FOSS/formstr/super-app`).
- **Versions:** `@formstr/mcp` stays `0.4.0`. `@formstr/core` and `@formstr/agent` become **public** at `0.1.0` (drop `private: true`).
- **Preserve agent `exports` keys EXACTLY:** `".", "./services", "./services/forms", "./services/calendar", "./services/pages", "./services/drive", "./services/polls", "./services/profile", "./services/*", "./tools"` — only retarget `./src/*.ts` → `./dist/*.js`/`.d.ts`. super-app import sites must not change.
- **Test/build gates that must stay green:** in common-packages — core **95**, agent **331**, mcp **81** tests + `pnpm -r typecheck` + `pnpm -r build`. In super-app after rewiring — app **243** tests + `tsc -b && vite build`.
- **If the workspace test wrapper trips the esbuild deps-check,** run Vitest directly from the package dir: `node ../../node_modules/vitest/vitest.mjs run`.
- **Commits:** GPG-signed, no AI-attribution trailers (no `Co-Authored-By: Claude`). On `gpg: signing failed: Timeout`, retry with `--no-verify` (the pre-commit hook already ran).
- **Never push or publish autonomously.** Pushing to common-packages, opening a PR, and `npm publish` are **user-gated** steps (npm publish is 2FA/OTP). Tasks that push/publish are marked **[USER STEP]**.
- **common-packages uses `pnpm@9.0.0`,** where dependency build scripts run by default (the default-deny is a pnpm-10 behavior). So the `esbuild`/`@napi-rs/keyring` build-allowance may be unnecessary — Task 1 _verifies_ this rather than assuming it.
- **tsconfig strictness:** common-packages' `tsconfig.base.json` does NOT set `noUnusedLocals`/`noUnusedParameters` (super-app's does). To avoid silently loosening the moved packages, each moved package re-adds those two flags in its own `tsconfig.json`.

---

### Task 1: Fresh common-packages clone + verified-green baseline

**Files:**

- Create: `/Users/skywalker/Coding/FOSS/formstr/common-packages/` (clone)

**Interfaces:**

- Produces: a clean working clone on branch `migrate-mcp-core-agent`, with a documented answer to "does `pnpm install` block build scripts here?" (drives Task 5).

- [x] **Step 1: Clone and branch**

```bash
cd /Users/skywalker/Coding/FOSS/formstr
git clone https://github.com/formstr-hq/common-packages.git
cd common-packages
git checkout -b migrate-mcp-core-agent
git log --oneline -1   # expect the current origin/main tip (e.g. 84defa0)
```

- [x] **Step 2: Install and capture build-script behavior**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
pnpm install 2>&1 | tee /tmp/cp-install.log
```

Expected: install completes. **Note whether pnpm prints an "Ignored build scripts" / "packages have build scripts that were not run" warning** (naming esbuild and/or a native addon). Record the answer — it determines whether Task 5 must add `onlyBuiltDependencies`.

- [x] **Step 3: Verify existing packages are green (baseline)**

```bash
pnpm -r typecheck
pnpm -r --if-present test:coverage
pnpm -r build
```

Expected: all pass (signer + local-relay). If any fail on a clean clone, STOP and report — the target repo is not green and must be fixed first.

- [x] **Step 4: No commit** (setup only; nothing changed).

---

### Task 2: Land `@formstr/core`

**Files:**

- Create: `/Users/skywalker/Coding/FOSS/formstr/common-packages/packages/core/**` (copied from super-app `packages/core`)
- Modify: `packages/core/package.json`, `packages/core/tsconfig.json`

**Interfaces:**

- Produces: `@formstr/core@0.1.0` (public), building to `dist` with its existing `exports` map intact; consumed by agent + mcp as `workspace:*`.

- [x] **Step 1: Copy core into the clone (exclude build/deps artifacts)**

```bash
rsync -a --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' \
  /Users/skywalker/Coding/FOSS/formstr/super-app/packages/core/ \
  /Users/skywalker/Coding/FOSS/formstr/common-packages/packages/core/
```

- [x] **Step 2: Edit `packages/core/package.json`** — remove `"private": true`; set version and publish metadata. Result (only the changed/added fields shown; keep `type`, `main`, `types`, `exports`, `scripts`, `dependencies`, `devDependencies` exactly as they are today):

```jsonc
{
  "name": "@formstr/core",
  "version": "0.1.0",
  "description": "Nostr primitives for Formstr: signers, relay/runtime plumbing, crypto, Blossom, cross-module linking",
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/formstr-hq/common-packages.git",
    "directory": "packages/core",
  },
  "homepage": "https://github.com/formstr-hq/common-packages/tree/main/packages/core#readme",
  "bugs": { "url": "https://github.com/formstr-hq/common-packages/issues" },
  "files": ["dist"],
  // ...(keep everything else unchanged)
}
```

- [x] **Step 3: Preserve strictness in `packages/core/tsconfig.json`** — add the two flags common-packages' base omits, keeping the rest:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"],
}
```

- [x] **Step 4: Install, typecheck, test, build**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
pnpm install
pnpm --filter @formstr/core typecheck
pnpm --filter @formstr/core test        # expect 95 passed
pnpm --filter @formstr/core build       # tsc → dist
ls packages/core/dist/index.js packages/core/dist/index.d.ts   # exist
```

Expected: typecheck clean, **95 tests pass**, `dist/` populated with `.js` + `.d.ts` matching the `exports` map (`signer`, `runtime`, `relay`, `blossom`, `crypto`, `linking`). If Vitest trips the wrapper, run `cd packages/core && node ../../node_modules/vitest/vitest.mjs run`.

- [x] **Step 5: Commit**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
git add packages/core pnpm-lock.yaml
git commit -m "feat: add @formstr/core (0.1.0) from super-app"
```

---

### Task 3: Land `@formstr/agent` and give it a build

**Files:**

- Create: `/Users/skywalker/Coding/FOSS/formstr/common-packages/packages/agent/**` (copied)
- Create: `packages/agent/tsup.config.ts`
- Modify: `packages/agent/package.json`, `packages/agent/tsconfig.json`
- Create: `packages/agent/scripts/verify-exports.mjs` (subpath resolution smoke test)

**Interfaces:**

- Consumes: `@formstr/core` (`workspace:*`) from Task 2.
- Produces: `@formstr/agent@0.1.0` (public) building to `dist` with ESM+CJS+`.d.ts`; `exports` keys unchanged (see Global Constraints); root exposes `toolRegistry`, `ToolCtx`, `ToolResult` (what mcp imports).

- [x] **Step 1: Copy agent into the clone**

```bash
rsync -a --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' \
  /Users/skywalker/Coding/FOSS/formstr/super-app/packages/agent/ \
  /Users/skywalker/Coding/FOSS/formstr/common-packages/packages/agent/
```

- [x] **Step 2: Create `packages/agent/tsup.config.ts`** (multi-entry, one per `exports` target; models signer/local-relay):

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "services/index": "src/services/index.ts",
    "services/forms/index": "src/services/forms/index.ts",
    "services/calendar/index": "src/services/calendar/index.ts",
    "services/pages/index": "src/services/pages/index.ts",
    "services/drive/index": "src/services/drive/index.ts",
    "services/polls/index": "src/services/polls/index.ts",
    "services/profile/index": "src/services/profile/index.ts",
    "tools/index": "src/tools/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
```

> Note: the only direct file under `src/services/` is `index.ts`, so the `./services/*` catch-all export needs no extra entry today; it is retargeted to `./dist/services/*.js` for forward-compat.

- [x] **Step 3: Edit `packages/agent/package.json`** — make public, add build + coverage scripts + tsup dep, link core, retarget `exports` to `dist`. Full file:

```jsonc
{
  "name": "@formstr/agent",
  "version": "0.1.0",
  "description": "Formstr service layer + 53-tool registry (DOM-free; runs in browser and Node)",
  "license": "MIT",
  "type": "module",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/formstr-hq/common-packages.git",
    "directory": "packages/agent",
  },
  "homepage": "https://github.com/formstr-hq/common-packages/tree/main/packages/agent#readme",
  "bugs": { "url": "https://github.com/formstr-hq/common-packages/issues" },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
    },
    "./services": {
      "types": "./dist/services/index.d.ts",
      "import": "./dist/services/index.js",
      "require": "./dist/services/index.cjs",
    },
    "./services/forms": {
      "types": "./dist/services/forms/index.d.ts",
      "import": "./dist/services/forms/index.js",
      "require": "./dist/services/forms/index.cjs",
    },
    "./services/calendar": {
      "types": "./dist/services/calendar/index.d.ts",
      "import": "./dist/services/calendar/index.js",
      "require": "./dist/services/calendar/index.cjs",
    },
    "./services/pages": {
      "types": "./dist/services/pages/index.d.ts",
      "import": "./dist/services/pages/index.js",
      "require": "./dist/services/pages/index.cjs",
    },
    "./services/drive": {
      "types": "./dist/services/drive/index.d.ts",
      "import": "./dist/services/drive/index.js",
      "require": "./dist/services/drive/index.cjs",
    },
    "./services/polls": {
      "types": "./dist/services/polls/index.d.ts",
      "import": "./dist/services/polls/index.js",
      "require": "./dist/services/polls/index.cjs",
    },
    "./services/profile": {
      "types": "./dist/services/profile/index.d.ts",
      "import": "./dist/services/profile/index.js",
      "require": "./dist/services/profile/index.cjs",
    },
    "./services/*": {
      "types": "./dist/services/*.d.ts",
      "import": "./dist/services/*.js",
      "require": "./dist/services/*.cjs",
    },
    "./tools": {
      "types": "./dist/tools/index.d.ts",
      "import": "./dist/tools/index.js",
      "require": "./dist/tools/index.cjs",
    },
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
  },
  "dependencies": {
    "@formstr/core": "workspace:*",
    "@noble/hashes": "^1.8.0",
    "nostr-tools": "^2.23.3",
    "zod": "^3.24.0",
    "zod-to-json-schema": "^3.24.0",
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.2.4",
    "tsup": "^8.5.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.4",
  },
}
```

- [x] **Step 4: Update `packages/agent/tsconfig.json`** — keep `noEmit` (tsup owns emit); the `../core` project reference still resolves as a sibling; re-add strictness flags:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": [],
    "noUnusedLocals": true,
    "noUnusedParameters": true,
  },
  "include": ["src", "test"],
  "references": [{ "path": "../core" }],
}
```

- [x] **Step 5: Create `packages/agent/scripts/verify-exports.mjs`** — proves every `exports` subpath resolves post-build:

```js
// Resolve every published subpath against the built dist. Exits non-zero on any miss.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const subpaths = [
  "@formstr/agent",
  "@formstr/agent/services",
  "@formstr/agent/services/forms",
  "@formstr/agent/services/calendar",
  "@formstr/agent/services/pages",
  "@formstr/agent/services/drive",
  "@formstr/agent/services/polls",
  "@formstr/agent/services/profile",
  "@formstr/agent/tools",
];
let failed = 0;
for (const s of subpaths) {
  try {
    require.resolve(s);
    console.log("OK   " + s);
  } catch (e) {
    failed++;
    console.error("FAIL " + s + " — " + e.message);
  }
}
process.exit(failed ? 1 : 0);
```

- [x] **Step 6: Install, build, verify exports, typecheck, test**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
pnpm install
pnpm --filter @formstr/agent build
node packages/agent/scripts/verify-exports.mjs    # all OK, exit 0
pnpm --filter @formstr/agent typecheck
pnpm --filter @formstr/agent test                 # expect 331 passed
```

Expected: build emits `dist/index.{js,cjs,d.ts}` plus every `services/*` and `tools` entry; verify-exports prints all `OK`; typecheck clean; **331 tests pass**.

- [x] **Step 7: Commit**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
git add packages/agent pnpm-lock.yaml
git commit -m "feat: add @formstr/agent (0.1.0) with a tsup build"
```

---

### Task 4: Land `@formstr/mcp`

**Files:**

- Create: `/Users/skywalker/Coding/FOSS/formstr/common-packages/packages/mcp/**` (copied, incl. `docs/MCP.md`, `test-create-form.mjs`, `tsup.config.ts`, `vitest.config.ts`)
- Modify: `packages/mcp/package.json`

**Interfaces:**

- Consumes: `@formstr/agent`, `@formstr/core`, `@formstr/signer` (all `workspace:*`).
- Produces: `@formstr/mcp@0.4.0` single-file CJS bundle with agent+core inlined, `@napi-rs/keyring` external (unchanged behavior).

- [x] **Step 1: Copy mcp into the clone**

```bash
rsync -a --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' \
  /Users/skywalker/Coding/FOSS/formstr/super-app/packages/mcp/ \
  /Users/skywalker/Coding/FOSS/formstr/common-packages/packages/mcp/
```

- [x] **Step 2: Edit `packages/mcp/package.json`** — move the three `@formstr/*` from devDeps to `workspace:*`, add `test:coverage` + coverage dep, retarget metadata. Changed fields:

```jsonc
{
  "homepage": "https://github.com/formstr-hq/common-packages/tree/main/packages/mcp#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/formstr-hq/common-packages.git",
    "directory": "packages/mcp",
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "start": "node dist/index.js",
    "prepublishOnly": "pnpm build",
  },
  "dependencies": { "@napi-rs/keyring": "^1.1.6" },
  "devDependencies": {
    "@formstr/agent": "workspace:*",
    "@formstr/core": "workspace:*",
    "@formstr/signer": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@types/node": "^25.6.0",
    "@types/qrcode": "^1.5.5",
    "@types/ws": "^8.5.0",
    "@vitest/coverage-v8": "^3.2.4",
    "nostr-tools": "^2.23.3",
    "qrcode": "^1.5.4",
    "tsup": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.4",
    "ws": "^8.18.0",
    "zod": "^3.24.0",
  },
}
```

> `@formstr/signer` moves from npm `^0.2.2` to `workspace:*` — mcp now bundles the local signer (0.2.2 in this repo). tsup config (`noExternal: [/^(?!@napi-rs\/keyring)/]`, keyring external) is unchanged.

- [x] **Step 3: Add strictness flags to `packages/mcp/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
  },
  "include": ["src", "test"],
}
```

- [x] **Step 4: Install, typecheck, test, build, smoke**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
pnpm install
pnpm --filter @formstr/mcp typecheck
pnpm --filter @formstr/mcp test            # expect 81 passed
pnpm --filter @formstr/mcp build           # tsup → dist/index.js (single CJS)
node packages/mcp/dist/index.js version    # prints "@formstr/mcp 0.4.0" (+ update note)
```

Expected: typecheck clean, **81 tests pass**, build produces a single `dist/index.js`, `version` prints `@formstr/mcp 0.4.0`.

- [x] **Step 5: Verify the bundle is self-contained** (agent+core inlined; only keyring external):

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
grep -oE "require\(['\"][^'\"]+['\"]\)" packages/mcp/dist/index.js \
  | grep -E "@formstr|@modelcontextprotocol|nostr-tools" || echo "NONE (good: bundled)"
grep -c "@napi-rs/keyring" packages/mcp/dist/index.js   # > 0 (external, required at runtime)
```

Expected: **NONE** of `@formstr/*`, `@modelcontextprotocol/*`, `nostr-tools` are `require`d at runtime (all bundled); `@napi-rs/keyring` IS referenced (stays external).

- [x] **Step 6: Commit**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
git add packages/mcp pnpm-lock.yaml
git commit -m "feat: relocate @formstr/mcp (0.4.0) into common-packages"
```

---

### Task 5: Workspace config — build allowances (conditional), CI, README

**Files:**

- Modify (conditional): `/Users/skywalker/Coding/FOSS/formstr/common-packages/package.json` (add `pnpm.onlyBuiltDependencies`)
- Modify: `/Users/skywalker/Coding/FOSS/formstr/common-packages/README.md`
- Verify: `.github/workflows/ci.yml` (no change expected)

**Interfaces:**

- Produces: green `pnpm -r` gates for the whole workspace; CI that actually runs all three new test suites.

- [x] **Step 1: (Conditional) add build allowances** — ONLY if Task 1 Step 2 showed pnpm ignoring build scripts, or if a later `pnpm install` warned about esbuild/keyring. Add to root `package.json`:

```jsonc
{
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild", "@napi-rs/keyring"],
  },
}
```

Then `pnpm install` and re-run the keyring path check: `node packages/mcp/dist/index.js whoami` must not throw a native-module load error. If Task 1 showed no build-script warning, SKIP this step and note "not needed on pnpm 9.0.0".

- [x] **Step 2: Verify CI already covers the new packages** — `.github/workflows/ci.yml` runs `pnpm -r --if-present test:coverage`; core/agent/mcp now all have `test:coverage`, so no CI edit is required. Confirm by reading the workflow. (If it were missing coverage on mcp, Task 4 Step 2 already added it.)

- [x] **Step 3: Update `README.md`** to list the three new packages alongside signer/local-relay (one line each: name + one-sentence purpose).

- [x] **Step 4: Full-workspace gate**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
pnpm -r typecheck
pnpm -r --if-present test:coverage    # core 95 + agent 331 + mcp 81 + signer + local-relay
pnpm -r build
```

Expected: everything green; total new tests visible = 95 + 331 + 81.

- [x] **Step 5: Commit**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
git add -A
git commit -m "chore: workspace config + README for core/agent/mcp"
```

- [ ] **Step 6: [USER STEP] Push branch + open PR** — outward-facing; do not run without the user's go-ahead. _Status 2026-07-02: branch pushed to origin; PR NOT yet opened (`gh` not installed — open via https://github.com/formstr-hq/common-packages/pull/new/migrate-mcp-core-agent)._

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
git push -u origin migrate-mcp-core-agent
gh pr create --repo formstr-hq/common-packages --fill
```

---

### Task 6: [USER STEP] Publish `@formstr/core` and `@formstr/agent` to npm

Irreversible + 2FA/OTP-gated. Runs only after the PR is merged to common-packages `main` (or against the branch, per the user's release preference). The user runs the `npm publish` calls.

- [ ] **Step 1: Build fresh from a clean tree**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages
pnpm install --frozen-lockfile
pnpm --filter @formstr/core build
pnpm --filter @formstr/agent build
```

- [ ] **Step 2: Dry-run pack inspection** (no secrets/source leakage; `dist` only)

```bash
pnpm --filter @formstr/core exec npm pack --dry-run
pnpm --filter @formstr/agent exec npm pack --dry-run
```

Expected: each tarball lists only `dist/**` + `package.json` (+ README/LICENSE if present); no `src`, no workspace refs.

- [ ] **Step 3: Publish (user runs; OTP expires ~30s)** — MUST use `pnpm publish`, NOT `npm publish`: agent depends on `@formstr/core` via `workspace:*`, which only pnpm rewrites to the real version (`0.1.0`) at pack time. Verified 2026-07-02: `pnpm pack` produces `"@formstr/core": "0.1.0"`; a bare `npm publish` would ship the literal `workspace:*` and break every install.

```bash
cd /Users/skywalker/Coding/FOSS/formstr/common-packages/packages/core  && corepack pnpm publish --access public --otp=<code>
cd /Users/skywalker/Coding/FOSS/formstr/common-packages/packages/agent && corepack pnpm publish --access public --otp=<code>
```

- [ ] **Step 4: Verify on npm**

```bash
npm view @formstr/core version    # 0.1.0
npm view @formstr/agent version   # 0.1.0
```

> mcp is NOT re-published here — it changed repos but not code/version. Publish mcp only when cutting a new mcp version.

---

### Task 7: Rewire super-app to consume core+agent from npm

**Files:**

- Modify: `/Users/skywalker/Coding/FOSS/formstr/super-app/packages/app/package.json`
- Delete: `super-app/packages/core`, `super-app/packages/agent`, `super-app/packages/mcp`
- Modify (if referenced): `super-app/pnpm-workspace.yaml`, root scripts

**Interfaces:**

- Consumes: `@formstr/core@^0.1.0`, `@formstr/agent@^0.1.0` from npm (Task 6).

- [ ] **Step 1: Branch**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/super-app
git checkout -b consume-core-agent-from-npm
```

- [ ] **Step 2: Point the app at npm** — in `packages/app/package.json`, change `@formstr/core` and `@formstr/agent` from `"workspace:*"` to `"^0.1.0"` (leave `@formstr/signer": "^0.2.2"` as-is).

- [ ] **Step 3: Delete the moved packages**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/super-app
git rm -r packages/core packages/agent packages/mcp
```

- [ ] **Step 4: Reinstall + full app gate**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/super-app
CI=true pnpm install --no-frozen-lockfile
pnpm --filter @formstr/app typecheck
( cd packages/app && node ../../node_modules/vitest/vitest.mjs run )   # expect 243 passed
pnpm --filter @formstr/app build                 # tsc -b && vite build
```

Expected: install resolves core/agent from npm; app typechecks; **243 tests pass**; Vite build succeeds. If a deep import like `@formstr/agent/services/forms` fails to resolve, the published `exports` map is wrong — fix in agent (Task 3 Step 3), republish, retry.

- [ ] **Step 5: Commit**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/super-app
git add -A
git commit -m "chore: consume @formstr/core and @formstr/agent from npm; drop moved packages"
```

---

### Task 8: Docs cleanup

**Files:**

- Modify: `super-app/docs/ARCHITECTURE.md`, `super-app/docs/MCP.md`, `super-app/CLAUDE.md`
- Modify: `common-packages/README.md` (if not fully done in Task 5)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `super-app/docs/ARCHITECTURE.md`** — the repo layout section now describes super-app as the web app consuming shared engine packages from common-packages; remove the "four packages" table rows for core/agent/mcp or annotate them as relocated.

- [ ] **Step 2: Update `super-app/docs/MCP.md`** — note the package now lives at `formstr-hq/common-packages/packages/mcp`; fix the "How it fits together" layering note.

- [ ] **Step 3: Update `super-app/CLAUDE.md`** — repo-layout + gate baselines (super-app now: app only; common-packages hosts core/agent/mcp).

- [ ] **Step 4: Commit**

```bash
cd /Users/skywalker/Coding/FOSS/formstr/super-app
git add docs/ARCHITECTURE.md docs/MCP.md CLAUDE.md
git commit -m "docs: reflect core/agent/mcp move to common-packages"
```

---

## Final verification checklist

- [x] common-packages: `pnpm -r typecheck` + `pnpm -r --if-present test:coverage` (core 95 / agent 337 / mcp 81 + signer 144 + local-relay 210) + `pnpm -r build` all green. _(Verified 2026-07-02; agent grew 331→337 tests since the plan was written.)_
- [x] mcp `dist/index.js` self-contained (agent+core bundled; keyring external); `node dist/index.js version` → `@formstr/mcp 0.4.0`. _(Verified 2026-07-02; agent verify-exports all OK.)_
- [ ] npm: `@formstr/core@0.1.0` + `@formstr/agent@0.1.0` published; tarballs = `dist` only.
- [ ] super-app: app 243 tests pass + `tsc -b && vite build` green against npm core/agent; deep imports resolve.
- [ ] mcp e2e still works from the bundle: `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE=… node packages/mcp/test-create-form.mjs` round-trips create/get/delete.
- [ ] Docs updated in both repos.

## Rollback

- Tasks 1–5 are additive to common-packages and touch nothing in super-app; abandon the `migrate-mcp-core-agent` branch to fully roll back.
- Task 6 (publish) — prefer `npm deprecate` over unpublish if a bad version ships.
- Task 7 is the only destructive step for super-app; keep it on `consume-core-agent-from-npm` and don't merge until the app gate is green. Rollback = delete the branch; super-app's `packages/{core,agent,mcp}` and workspace links are restored.
