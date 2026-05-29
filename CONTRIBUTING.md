# Contributing to Formstr Super App

## Quickstart

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Node 20+ and pnpm 9+ required.

## Commands

| Command                                     | What it does                          |
| ------------------------------------------- | ------------------------------------- |
| `pnpm dev`                                  | Vite dev server for `@formstr/app`    |
| `pnpm test`                                 | Run all tests across the workspace    |
| `pnpm --filter @formstr/core test:coverage` | Core tests with coverage (85% gate)   |
| `pnpm typecheck`                            | TypeScript check across both packages |
| `pnpm lint`                                 | ESLint across the workspace           |
| `pnpm format`                               | Prettier format all files             |
| `pnpm build`                                | Production build                      |

## Repository layout

```
packages/
  core/   @formstr/core — framework-agnostic: signer, runtime, relay, crypto, linking
  app/    @formstr/app  — React 19 super-app
upstream/ # ignored — read-only clones of formstr-hq/* (run scripts/sync-upstream.sh)
docs/     # proposal, design specs, plans
```

## Conventions

- **Commits:** conventional commits (`feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `ci`)
- **Lint + format:** enforced on commit via Husky + lint-staged; CI re-checks
- **Tests:** TDD where possible. Security-sensitive code (signer, crypto, linking) must have tests
- **Files:** keep focused; if a file passes ~300 LOC, consider splitting

## Adding a new module

A "module" is a feature area (Forms, Calendar, Pages, Drive, Polls). To add one:

1. **Register the event kind(s)** in [`packages/core/src/linking.ts`](packages/core/src/linking.ts) — add to `KIND_MODULE_MAP` and `MODULE_ROUTES`.
2. **Pick default relays** in [`packages/core/src/relay/module-defaults.ts`](packages/core/src/relay/module-defaults.ts) — start with the global defaults; narrow only if the module needs specific relays.
3. **Service layer** at `packages/app/src/services/<module>/service.ts` — pure functions that take a signer and return structured data. No React imports.
4. **Store** at `packages/app/src/stores/<module>Store.ts` — Zustand store mirroring service results.
5. **Page** at `packages/app/src/pages/<Module>Page.tsx` — wired into [`packages/app/src/router.tsx`](packages/app/src/router.tsx).
6. **Tests** for service layer (unit, mocked signer) and store (mocked service).

Don't touch `@formstr/core` to add module-specific features unless the logic is genuinely cross-module.

## Upstream references

The five `formstr-hq/*` modules are cloned read-only into `./upstream/` via `scripts/sync-upstream.sh`. They're not part of the monorepo — only reference. Bugs spotted upstream go to `docs/upstream-notes.md` for separate PRs to those repos, not this one.
