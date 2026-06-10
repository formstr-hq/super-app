# @formstr/mcp

A standalone [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes the **Formstr** super-app (forms, calendar, pages, drive, polls) to any MCP host —
Claude Code/Desktop, Cursor, and others. It builds on `@formstr/core` and the super-app's
service layer and talks to Nostr relays directly. Transport: **stdio**.

Identity is powered by [`@formstr/signer`](https://www.npmjs.com/package/@formstr/signer) —
the same login engine the Formstr web app uses. Local keys are stored **NIP-49 encrypted
(`ncryptsec`)** inside an OS-keychain (or encrypted-file) keystore; a raw nsec is never
persisted. Remote keys stay in your NIP-46 signer.

## Quick start

```bash
# 1. Sign in once (terminal-interactive; key is stored encrypted in your keystore)
npx -y @formstr/mcp login

# 2. Point your MCP host at the server (see "Host configuration")
#    No key in the config — the account is unlocked from the keystore at startup.
```

Subcommands: `formstr-mcp login` · `formstr-mcp whoami` · `formstr-mcp accounts` ·
`formstr-mcp logout` · `formstr-mcp` (run the stdio server, the default).

## Sign-in

`formstr-mcp login` is fully terminal-interactive (no browser, no localhost server) and
offers four methods:

| Method                          | What happens                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Create** (new key)            | Generates a key, encrypts it with a passphrase you choose, and prints the `ncryptsec` once — **back it up**, it is the only recovery path. |
| **Import** (nsec/hex/ncryptsec) | Paste an `nsec…`, hex secret, or existing `ncryptsec1…`. Non-encrypted input is encrypted with your passphrase before storage.             |
| **Bunker URI** (NIP-46)         | Paste a `bunker://…` URI. Your key stays in the remote signer; only the session is stored.                                                 |
| **QR** (NIP-46 nostrconnect)    | A `nostrconnect://` URI is rendered as a terminal QR; scan it in Amber / nsec.app / nsecbunker.                                            |

**Where the key lives:** the OS keychain (macOS Keychain / Windows Credential Manager /
Linux Secret Service via `@napi-rs/keyring`). On hosts without a keychain (e.g. headless
Linux), set `FORMSTR_MCP_PASSPHRASE` to use an AES-256-GCM encrypted file at
`~/.config/formstr-mcp/keystore.enc` (mode `0600`). Multiple identities are supported
(`formstr-mcp accounts` lists them); select one at boot with `--account <pubkey>`.

**Defense in depth:** even on the encrypted-file fallback the stored key is _also_ NIP-49
encrypted, so recovering it needs **both** the keystore **and** the unlock passphrase.

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

## Headless / unattended

Run `formstr-mcp login` once interactively to populate the keystore, then run the server
unattended. At boot the active account is unlocked headlessly:

- **ncryptsec accounts** decrypt using `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` (the passphrase
  you set during `login`). Required for the `run` command when the active account is local.
- **NIP-46 accounts** reconnect from their stored session — no passphrase needed.

| Variable                           | Meaning                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` | unlock the active ncryptsec account at boot                       |
| `FORMSTR_MCP_PASSPHRASE`           | encrypts the at-rest keystore **file** (keychain-less hosts only) |
| `FORMSTR_MCP_KEYSTORE`             | force `file` or `keychain` backend (optional)                     |
| `FORMSTR_MCP_CONFIG_DIR`           | keystore directory (default `~/.config/formstr-mcp`)              |
| `FORMSTR_RELAYS`                   | comma-separated relay override (optional)                         |

CLI flags: `--relays <wss://a,wss://b>`, `--allow-writes`, `--account <pubkey>`.
There is no plaintext-nsec path — a raw key is never read from env, flags, or a config file.

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
