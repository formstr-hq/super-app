# Formstr Super-App as a Universal MCP Server (`@formstr/mcp`)

**Status:** Design / decisions doc (pre-implementation)
**Date:** 2026-06-03
**Branch:** `feat/formstr-mcp-server` (off `main`)
**Scope:** Architectural blueprint + decisions for exposing the Formstr super-app's
capabilities as a standalone Model Context Protocol (MCP) server, so any agentic
host (Claude Code/Desktop, Cursor, Odysseus, …) can drive Formstr out of the box.

---

## 0. Context & the inversion

The `feat/odysseus-integration` branch pursues **browser → Odysseus**: the super-app
calls a local AI brain (see `2026-06-02-formstr-odysseus-local-ai-integration-design.md`).
This design pursues the **opposite direction**: **any AI agent → super-app**. We expose
the super-app's existing tool surface as an MCP server, so the super-app becomes a
_callable_ tool provider for the whole agentic ecosystem — not just Odysseus.

Because MCP is a standard, we do **not** need to modify Odysseus to achieve reach: we
ship an MCP server and any MCP-capable host consumes it via config. A PR into Odysseus
is a possible _later_ step (bundle/register the server there) only if it proves out.

### Why this is highly feasible (findings from the codebase)

- **Tool schemas already exist.** `packages/app/src/ai/tools.ts` defines 17 tools
  (forms, calendar, pages, drive, polls) in JSON-schema/function-calling shape —
  near-1:1 with MCP tool definitions.
- **Business logic is browser-free.** The real logic lives in
  `packages/app/src/services/{forms,calendar,pages,drive,polls}`. The entire services
  tree references exactly **one** browser global (`window.location.origin` in
  `pages/service.ts`). Imports are limited to `@formstr/core`, `nostr-tools`, and local
  files — **no React, MUI, emotion, zustand, or app internals**.
- **Engine is headless.** `@formstr/core` (signer, relay pool, runtime, crypto,
  blossom) is pure TypeScript; runtime deps are only `@noble/hashes` + `nostr-tools`,
  both Node-runnable.
- **Bootstrap is a known path.** Services call core singletons
  (`signerManager.getSigner()`, `relayManager.getRelaysForModule()`). A headless server
  initializes the same singletons (`signerManager.loginWithNsec(nsec)` + relay config +
  a WS impl) and calls the services exactly as the browser does.

**Verdict: HIGH feasibility.** This is wiring + a thin adapter, not new subsystems.

---

## 1. Decisions at a glance

| #   | Decision         | Choice                                                                                                                                                                | Rationale                                                                                         |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| D1  | Target           | **Universal standalone MCP server.** Odysseus PR deferred.                                                                                                            | MCP is the standard; one server reaches every host. Odysseus PR only if it proves out.            |
| D2  | Key custody      | **`nsec` in local config (v1)**, behind core's signer interface.                                                                                                      | Simplest, works with every host out of the box. Bunker (NIP-46) can slot in later.                |
| D3  | Capability scope | **Read all + constructive creates always on; destructive/outward actions gated.**                                                                                     | Safe by default; agent is useful without being able to silently publish/delete on your identity.  |
| D4  | Transport        | **stdio only (v1).**                                                                                                                                                  | Universal across hosts; zero network surface; simplest to ship & secure. HTTP deferred.           |
| D5  | Code reuse       | **Approach B:** new `@formstr/mcp` imports `@formstr/app/services` via a subpath export; server is bundled (esbuild/tsup) so tree-shaking pulls only services + core. | Minimal churn now. Upgrade to a shared `@formstr/sdk` package (Approach A) later via a file move. |
| D6  | Branch           | **New `feat/formstr-mcp-server` off `main`.**                                                                                                                         | The MCP direction is a distinct artifact; does not touch the odysseus branch.                     |

---

## 2. Architecture

```
┌─ MCP host (Claude Code/Desktop, Cursor, Odysseus, …) ─┐
│   spawns over stdio ↓                                  │
│        ┌─────────── @formstr/mcp (Node process) ──────┐│
│        │  MCP SDK server  →  tool registry             ││
│        │       ↓ calls                                 ││
│        │  @formstr/app/services  (forms/cal/pages/…)   ││  ← reused as-is (Approach B)
│        │       ↓ uses singletons                       ││
│        │  @formstr/core (signer, relay, crypto, runtime)││
│        └───────────────┬──────────────────────────────┘│
└────────────────────────┼───────────────────────────────┘
                         ↓ ws://  (Nostr relays)
                   Nostr network (transport + storage)
```

The MCP server is a **thin adapter**: MCP tool call → existing service call → core does
the Nostr work. No business logic is reimplemented; no new Nostr kinds or wire formats.

---

## 3. Package structure (Approach B)

New workspace package `packages/mcp` (`@formstr/mcp`):

```
packages/mcp/
  package.json        # deps: @modelcontextprotocol/sdk, @formstr/app (workspace:*),
                      #       @formstr/core (workspace:*), nostr-tools, ws, zod
  tsup.config.ts      # bundle to single ESM w/ shebang; tree-shake → only services
                      #   + core + nostr-tools land (React never imported)
  src/
    index.ts          # #!/usr/bin/env node — entry; parse config; start stdio server
    bootstrap.ts      # init core singletons (signer, relays, ws, storage shim)
    config.ts         # load nsec + relays from env/flags/config file (zod-validated)
    server.ts         # MCP Server; register tools; wire call → dispatch
    tools/            # one file per module: tool name → service call + zod schema
      forms.ts  calendar.ts  pages.ts  drive.ts  polls.ts
    safety.ts         # gating for destructive tools
  README.md           # host config snippets (Claude Desktop/Code, Cursor, Odysseus)
```

**Two minimal touches in `packages/app`** (only changes outside the new package):

1. Add `packages/app/src/services/index.ts` barrel + a `"./services"` entry in
   `@formstr/app`'s `package.json` `exports` map (pointing at source).
2. Guard the lone browser global: `pages/service.ts` `generateShareLink` —
   `window.location.origin` falls back to a configurable base URL when `window` is
   undefined (return the fragment; let callers build the URL).

The later **Approach A** upgrade is then a mechanical `git mv` of services into
`packages/sdk` + repoint imports.

---

## 4. Runtime bootstrap & config

On startup, `bootstrap.ts`:

1. **WebSocket** — `nostr-tools` needs a WS impl in Node. Call
   `useWebSocketImplementation(ws)` (pin the `ws` package; Node ≥22 has a global
   `WebSocket` but the repo engine floor is `node>=20`).
2. **Storage shim** — `signerManager.setSigner` → `persist()` touches browser storage.
   Provide an in-memory/no-op `localStorage` shim (or guard) so headless login works.
3. **Signer** — `await signerManager.loginWithNsec(cfg.nsec)`. Key source priority:
   `--nsec` flag / `FORMSTR_NSEC` env → config file
   (`~/.config/formstr-mcp/config.json`, `0600`) → bunker URL (**reserved, not v1**).
   The nsec is never logged and is redacted in error output.
4. **Relays** — defaults from `MODULE_DEFAULT_RELAYS`; overridable via `FORMSTR_RELAYS`.

Config is `zod`-validated. If no key is present, the process exits with a clear message.

---

## 5. Tool surface

Sourced from the existing 17 schemas in `tools.ts`, re-expressed as MCP tools (zod) and
mapped to **services** (not the WIP dispatcher/stores):

| Tier                                 | Tools                                                                                                                              | Maps to (service)                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Read** (always on)                 | `list_forms`, `fetch_form_responses`, `fetch_poll_results`, `browse_files`, `get_form`                                             | `fetchMyForms`, `fetchResponses`, `fetchPollResults`, `fetchFileIndex`, `fetchForm` |
| **Create** (always on)               | `create_form`, `create_calendar_event`, `update_event`, `create_page`, `save_private_note`, `create_poll`                          | `createForm`, `publishPublic/PrivateCalendarEvent`, `savePage`, `createPoll`        |
| **Destructive/outward** (gated — §6) | `delete_form`, `delete_calendar_event`, `submit_form_response`, `share_form`, `share_page`, `rsvp_event`, `import_form_from_naddr` | `deleteForm`, `deleteCalendarEvent`, `submitResponse`, share/rsvp paths             |

Each tool returns the existing `ActionResult` shape (`success`, `message`, `data`, and
`naddr`/coordinate where relevant) as MCP structured content, so the agent gets
shareable refs back.

**Maturity note.** Some dispatcher paths used _store_ methods that don't yet exist
(`updateForm`, `shareForm`, `importForm` in stores). Building on **services** sidesteps
that. Where a _service_ genuinely lacks a capability (e.g. form update), that tool is
marked **deferred** rather than shipped half-working. The exact final in/out tool list
is produced during planning, grounded in the services that actually exist.

---

## 6. Safety model (destructive tools)

Default = safe. Destructive/outward tools are **not registered** unless the operator
opts in (belt-and-suspenders, both layers):

- **Layer 1 — registration gate.** `--allow-writes` / `FORMSTR_ALLOW_WRITES=true`
  registers the gated tier. Without it, those tools do not appear to the agent at all.
- **Layer 2 — per-call confirm.** Gated tools require `confirm: true` in their args.
  Absent it, the tool returns a structured "confirmation required" result that names the
  exact irreversible effect (what is published/deleted, on whose identity) instead of
  executing.
- **Audit.** Every gated execution logs to stderr with event kind + target.

This contains prompt-injected agents (no silent publish/delete on your identity) while
remaining fully usable when intended.

---

## 7. Build & distribution

- `tsup` → single bundled ESM with a shebang; `bin` field so it runs via
  `npx @formstr/mcp` (publishable binary later).
- **Host config example** (what a user pastes):
  ```json
  {
    "mcpServers": {
      "formstr": {
        "command": "npx",
        "args": ["-y", "@formstr/mcp"],
        "env": { "FORMSTR_NSEC": "nsec1…" }
      }
    }
  }
  ```
- `README` with Claude Desktop / Claude Code / Cursor / Odysseus snippets — the
  "works with any agentic tool out of the box" payoff.

---

## 8. Testing

- **Unit** — tool-schema ↔ service-arg mapping (pure, fast); safety gating (writes off
  by default; confirm required).
- **Integration** — bootstrap against a throwaway nsec + a local/mock relay; round-trip
  `create_form` → `list_forms` → `fetch_form_responses`. Mirrors the repo's existing
  `vitest` setup.
- **Smoke** — launch the server; run the MCP `initialize` + `tools/list` handshake;
  assert the tool set matches the `--allow-writes` state.

---

## 9. Non-goals (v1)

- No NIP-46 bunker, no Streamable HTTP, no browser-bridge (interfaces left open).
- No Approach-A extraction yet (B now; A later).
- No Odysseus PR yet (ship the server first; PR if it proves out).
- No new Nostr kinds or wire-format changes.
- No changes to the `feat/odysseus-integration` branch.

---

## 10. Open questions & risks

- **`persist()` / browser storage** in `signerManager` — confirm the cleanest headless
  shim vs. guarding the call (pick one during planning).
- **Relay configuration surface** — `RelayManager` exposes `getRelaysForModule`; confirm
  the supported way to override relays headlessly (config method vs. constructing with
  custom config) during planning.
- **Drive uploads** rely on Blossom + `fetch` (Node ≥20 global `fetch` is fine);
  `browse_files` is read-only so low-risk in v1.
- **nsec at rest** — documented as a local-machine trust assumption; recommend `0600`
  config and env injection. Bunker is the future sovereign upgrade.
- **Service capability gaps** (e.g. form update) — finalize the shippable tool list in
  the plan.
