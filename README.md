# Formstr Super App

[![CI](https://github.com/Sky-walkerX/super-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Sky-walkerX/super-app/actions/workflows/ci.yml)

Unified orchestration layer for Formstr modules: Forms, Calendar, Pages, Drive, Polls — with AI as the primary interface. Built on Nostr.

> Summer of Bitcoin 2026 project. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the app is built and [docs/MCP.md](docs/MCP.md) for the MCP server.

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

- `packages/core/` — `@formstr/core`: signer, runtime, relay, crypto, Blossom, linking. Framework-agnostic.
- `packages/agent/` — `@formstr/agent`: the five modules' service layer plus the shared tool registry.
- `packages/app/` — `@formstr/app`: React 19 + Vite 6 + Tailwind 4 super-app.
- `packages/mcp/` — `@formstr/mcp`: stdio MCP server wrapping the agent's tool registry ([npm](https://www.npmjs.com/package/@formstr/mcp)).
- `upstream/` — read-only clones of `formstr-hq/*` modules (gitignored). Run `./scripts/sync-upstream.sh` to populate.

`core`, `agent`, and `mcp` are being migrated to [formstr-hq/common-packages](https://github.com/formstr-hq/common-packages); see [docs/plans/2026-07-01-mcp-to-common-packages-migration.md](docs/plans/2026-07-01-mcp-to-common-packages-migration.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
