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
`formstr-mcp switch <npub>` · `formstr-mcp logout` · `formstr-mcp version` ·
`formstr-mcp help` · `formstr-mcp` (run the stdio server, the default). Run
`formstr-mcp help` (or `-h`) for the full usage.

## Version & updates

`formstr-mcp version` (or `-v` / `--version`) prints the installed version and checks the
npm registry for a newer release:

```text
$ formstr-mcp version
@formstr/mcp 0.3.2
Update available: 0.4.0 (you have 0.3.2).
Upgrade: npm install -g @formstr/mcp@latest
Or just re-run via: npx -y @formstr/mcp@latest
```

The update check is best-effort — if you're offline or the registry is unreachable it
prints the installed version and a note, never an error. If you run the server via
`npx -y @formstr/mcp` you already get the latest published version on each launch; pin a
version (`@formstr/mcp@0.3.2`) in your host config if you'd rather control upgrades.

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
(`formstr-mcp accounts` lists them). Change the persisted active account with
`formstr-mcp switch <npub>`, or pick one for a single boot with `--account <npub>`; the
server follows the active account when neither is given, so switching accounts just works.
Both `switch` and `--account` accept either the `npub` (as shown by `accounts`) or the hex
pubkey.

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

### Passing the ncryptsec passphrase

If your active account is an `ncryptsec` key (Create / Import login), the server needs its
passphrase to unlock at boot. An MCP host spawns the server with stdin wired to the
JSON-RPC channel, so it **can't prompt** — supply the passphrase through an `"env"` block in
the server entry of your MCP config (`mcp_config.json`, `claude_desktop_config.json`, Cursor's
`~/.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "formstr": {
      "command": "npx",
      "args": ["-y", "@formstr/mcp"],
      "env": {
        "FORMSTR_MCP_NCRYPTSEC_PASSPHRASE": "your-passphrase-here"
      }
    }
  }
}
```

The host hands that value to the server as an environment variable at startup — it never
enters the chat transcript. Each account has its own passphrase, so this unlocks whichever
one is **active** (set it with `formstr-mcp switch <npub>`).

> **Tip:** prefer not to keep a passphrase in a config file? Use a **NIP-46 (bunker)**
> account instead — it reconnects from its stored session and needs **no** passphrase, so
> the config can stay secret-free. Run `formstr-mcp switch <npub>` to a bunker account.

## Headless / unattended

Run `formstr-mcp login` once interactively to populate the keystore, then run the server
unattended. At boot the active account is unlocked headlessly:

- **ncryptsec accounts** decrypt using `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` (the passphrase
  you set during `login`). On an **interactive terminal** the server instead **prompts**
  for it (and re-prompts up to 3× on a typo) — so the env var is only _required_ when an
  MCP host spawns the server, since then stdin is the JSON-RPC channel and there's nobody
  to prompt. Each account has its own passphrase.
- **NIP-46 accounts** reconnect from their stored session — no passphrase needed. This is
  the simplest setup for a host: `formstr-mcp switch <npub>` to a bunker account and the
  config needs no secret at all.

| Variable                           | Meaning                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` | unlock the active ncryptsec account at boot                       |
| `FORMSTR_MCP_PASSPHRASE`           | encrypts the at-rest keystore **file** (keychain-less hosts only) |
| `FORMSTR_MCP_KEYSTORE`             | force `file` or `keychain` backend (optional)                     |
| `FORMSTR_MCP_CONFIG_DIR`           | keystore directory (default `~/.config/formstr-mcp`)              |
| `FORMSTR_RELAYS`                   | comma-separated relay override (optional)                         |
| `FORMSTR_MCP_DEBUG`                | print full stack traces on fatal errors (set to `1`)              |

CLI flags: `--relays <wss://a,wss://b>`, `--allow-writes`, `--account <npub|hex>`.
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
