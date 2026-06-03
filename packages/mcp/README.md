# @formstr/mcp

A standalone [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes the **Formstr** super-app (forms, calendar, pages, drive, polls) to any MCP host —
Claude Code/Desktop, Cursor, and others. It builds on `@formstr/core` and the super-app's
service layer and talks to Nostr relays directly. Transport: **stdio**.

v2 adds a **secure login flow** (your key lives in the OS keychain or a remote NIP-46
signer — never in your host config or the chat) and the **complete forms tool surface**.

## Quick start

```bash
# 1. Sign in once (opens a browser; key is stored in your OS keychain)
npx -y @formstr/mcp login

# 2. Point your MCP host at the server (see "Host configuration")
#    No key in the config — it's read from the keychain at startup.
```

Subcommands: `formstr-mcp login` · `formstr-mcp whoami` · `formstr-mcp logout` ·
`formstr-mcp` (run the stdio server, the default).

## Sign-in

`formstr-mcp login` starts a one-shot localhost page (it also prints the URL for
headless/SSH use) offering the same choices as the super-app:

| Method                      | What happens                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Paste nsec**              | Validated locally; the key is stored in your OS keychain.                                                                      |
| **Create guest**            | A fresh Nostr key is generated and stored in your keychain.                                                                    |
| **Connect signer (NIP-46)** | Scan/paste a `nostrconnect://` URI in Amber / nsec.app / nsecbunker. Your key stays there; the MCP keeps only a session token. |

**Where the key lives:** the OS keychain (macOS Keychain / Windows Credential Manager /
Linux Secret Service via `@napi-rs/keyring`). On hosts without a keychain (e.g. headless
Linux), set `FORMSTR_MCP_PASSPHRASE` to use an AES-256-GCM encrypted file at
`~/.config/formstr-mcp/credentials.enc` (mode `0600`). Multiple identities are supported;
select one with `--account <pubkey>`.

**The agent never sees your key.** No tool returns key material, and login happens
out-of-band, so secrets never enter the chat transcript.

## Host configuration

After `login`, no key belongs in the config:

```json
{
  "mcpServers": {
    "formstr": {
      "command": "npx",
      "args": ["-y", "@formstr/mcp"]
    }
  }
}
```

Add `"--allow-writes"` to `args` to enable the gated (destructive/outward) tools, and
`"--relays", "wss://a,wss://b"` to override relays.

## Headless / CI

For unattended use where no keychain or browser is available, provide a plaintext key.
The server **prints a prominent security warning** when you do this — prefer `login`.

| Variable                    | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `FORMSTR_NSEC`              | signing key (plaintext)                             |
| `FORMSTR_RELAYS`            | comma-separated relay override (optional)           |
| `FORMSTR_ALLOW_WRITES=true` | enable gated tools (optional)                       |
| `FORMSTR_MCP_PASSPHRASE`    | passphrase for the encrypted-file keystore fallback |

CLI flags: `--nsec <nsec>`, `--relays <wss://a,wss://b>`, `--allow-writes`, `--account <pubkey>`.
Precedence: plaintext flag/env/`config.json` → keychain → "run `formstr-mcp login`".

## Forms tools

The forms module is fully implemented — the MCP can create **every** field type the
service supports (more than the super-app builder UI currently exposes).

**Read (always on)**

- `list_forms` — your forms with ids, encryption status, and naddr coordinates.
- `get_form` — a form's fields, settings, and encryption status (pass `viewKey` for encrypted forms).
- `fetch_form_responses` — submissions with responder npub and per-field answers.

**Create / import (always on)**

- `create_form` — name, description, fields (short/paragraph/choice/dropdown/number/date/
  time/grid/file/signature/section), per-field `validation`, title/cover images, thank-you
  text, `publicForm`, `encrypted`, `allowedResponders`, `collaborators`, `notifyNpubs`.
- `import_form_from_naddr` — add a form by `naddr1…` / `pubkey:formId` to your forms list.

**Gated (require `--allow-writes` + `confirm: true`)**

- `update_form` — republish a form's name/fields/description.
- `share_form` — gift-wrap (NIP-59) an encrypted form's view key to collaborators.
- `delete_form` — publish a NIP-09 deletion.
- `submit_form_response` — submit a response on your identity.

Other modules (calendar, pages, polls, drive) expose the v1 read/create tools and gated
actions; see the source under `src/tools/`.

## Safety model

Destructive / outward tools are **not registered** unless `--allow-writes` (or
`FORMSTR_ALLOW_WRITES=true`) is set, AND each such call additionally requires
`"confirm": true`. Without `confirm`, the tool returns a structured "confirmation
required" message naming the irreversible effect instead of executing. `share_form`
distributes only the view key (read access) — never the signing key. Logging goes to
stderr (stdout is the MCP transport).

## Tests

```bash
pnpm --filter @formstr/mcp test       # unit + stdio smoke test
pnpm --filter @formstr/mcp typecheck
pnpm --filter @formstr/mcp build      # single-file CJS bundle (keychain dep stays external)
```
