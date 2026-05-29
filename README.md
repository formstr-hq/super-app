# Formstr Super App

[![CI](https://github.com/Sky-walkerX/super-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Sky-walkerX/super-app/actions/workflows/ci.yml)

Unified orchestration layer for Formstr modules: Forms, Calendar, Pages, Drive, Polls — with AI as the primary interface. Built on Nostr.

> Summer of Bitcoin 2026 project. See the [proposal](docs/proposal.final.md), the [week 1-2 design](docs/superpowers/specs/2026-05-27-week-1-2-foundation-design.md), and the [implementation plan](docs/superpowers/plans/2026-05-27-week-1-2-foundation.md).

## Quickstart

```bash
pnpm install
pnpm dev          # start the app on http://localhost:5173
pnpm test         # run all tests across the workspace
pnpm lint         # lint
pnpm typecheck    # TypeScript check across the workspace
pnpm build        # production build
```

Node 20+ and pnpm 9+ required (see `.nvmrc`).

## Monorepo layout

- `packages/core/` — `@formstr/core`: signer, runtime, relay, crypto, linking. Framework-agnostic.
- `packages/app/` — `@formstr/app`: React 19 + Vite 6 + Tailwind 4 super-app.
- `upstream/` — read-only clones of `formstr-hq/*` modules (gitignored). Run `./scripts/sync-upstream.sh` to populate.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (added in PR #4).
