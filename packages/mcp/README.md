# @formstr/mcp

A standalone Model Context Protocol (MCP) server that exposes the Formstr super-app
(forms, calendar, pages, drive, polls) to any MCP host — Claude Code/Desktop, Cursor,
Odysseus, and others. It builds on `@formstr/core` and the super-app's service layer and
talks to Nostr relays directly. Transport: stdio.

## Quick start

```bash
pnpm --filter @formstr/mcp build
node packages/mcp/dist/index.js --nsec nsec1...                  # read + create tools
node packages/mcp/dist/index.js --nsec nsec1... --allow-writes   # + destructive/outward tools
```

Configuration precedence: CLI flag > env var > `~/.config/formstr-mcp/config.json`
(`{ "nsec": "...", "relays": ["wss://..."] }`, recommend `chmod 0600`).

| Variable                    | Meaning                                   |
| --------------------------- | ----------------------------------------- |
| `FORMSTR_NSEC`              | signing key (required)                    |
| `FORMSTR_RELAYS`            | comma-separated relay override (optional) |
| `FORMSTR_ALLOW_WRITES=true` | enable gated tools (optional)             |

CLI flags: `--nsec <nsec>`, `--relays <wss://a,wss://b>`, `--allow-writes`.

## Host configuration

```json
{
  "mcpServers": {
    "formstr": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/super-app/packages/mcp/dist/index.js"],
      "env": { "FORMSTR_NSEC": "nsec1..." }
    }
  }
}
```

Add `"--allow-writes"` to `args` to enable the gated tools.

## Safety model

Destructive / outward tools are **not registered** unless `--allow-writes` (or
`FORMSTR_ALLOW_WRITES=true`) is set, AND each such call additionally requires
`"confirm": true` in its arguments. Without `confirm`, the tool returns a structured
"confirmation required" message naming the irreversible effect instead of executing.

## Tools

**Read (always on):** `list_forms`, `get_form`, `fetch_form_responses`, `list_pages`,
`list_polls`, `get_poll`, `fetch_poll_results`, `browse_files`, `list_calendar_events`.

**Create (always on):** `create_form`, `create_page`, `save_private_note`, `create_poll`,
`create_calendar_event` (public events).

**Gated (require `--allow-writes` + `confirm: true`):** `delete_form`,
`delete_calendar_event`, `submit_form_response`, `submit_poll_response`, `rsvp_event`.

### Deferred (not implemented in v1)

`update_form`, `update_event`, `share_form`, `share_page`, `import_form_from_naddr`,
`attach_form_to_event`, **private (encrypted) calendar events** (need a calendar list),
and **drive uploads/downloads/deletes** (`browse_files` is read-only in v1). These need
store-level orchestration (gift-wrap key distribution, calendar lists, Blossom uploads)
not yet exposed by the service layer.

## Security

The server holds your `nsec` in-process on your own machine. Treat the key as a
local-trust secret — prefer env injection or a `0600` config file. A NIP-46 "bunker"
mode (no key in the server process) is the planned sovereign upgrade. The server never
exposes per-file drive decryption keys.

## Tests

```bash
pnpm --filter @formstr/mcp test       # unit + stdio smoke test
pnpm --filter @formstr/mcp typecheck
```
