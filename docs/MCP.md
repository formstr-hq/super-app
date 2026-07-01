# @formstr/mcp Architecture

`@formstr/mcp` is a standalone Model Context Protocol server that exposes the Formstr
super-app (forms, calendar, pages, drive, polls) to any MCP host, such as Claude Code,
Claude Desktop, and Cursor. It talks to Nostr relays directly, signs with a key stored in
your OS keychain or an encrypted file, and never puts key material in the chat transcript.

This document is for developers who want to understand how the package is built, how it
boots and authenticates, what every tool does, and how to configure a host. For the wire
formats of the Nostr events these tools read and write, see
[ARCHITECTURE.md](./ARCHITECTURE.md); this file does not repeat them.

- Package: `packages/mcp`, published to npm as `@formstr/mcp`, current version 0.4.0
- Binary: `formstr-mcp`
- Transport: stdio
- Runtime: Node 20 or newer

## How it fits together

The MCP server is a thin shell around shared code. It does not reimplement any Nostr logic:

```
@formstr/core      nostr primitives (signers, runtime, relays, crypto, Blossom)
      |
@formstr/agent     the 53-tool registry + service layer (no DOM, no MCP SDK)
      |
@formstr/mcp       stdio server: keystore login, CLI, and the SDK adapter
```

The agent package is deliberately free of any DOM or MCP dependency, so its services run
unchanged in Node. The MCP server imports the tool registry from the agent, adapts each
neutral `ToolResult` to the SDK's `CallToolResult`, and serves it over stdio. The same
registry is what the in-browser assistant uses, so the two stay in lockstep.

Because of this layering the MCP package has exactly one runtime dependency,
`@napi-rs/keyring` (the native keychain addon). `tsup` bundles everything else into one CJS
file, so the published tarball contains no workspace references and the keychain addon stays
external (it is a native binary and cannot be bundled).

### Source map

| File                        | Responsibility                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/index.ts`              | Entry point and command dispatch. Thin glue over the helpers below.                                      |
| `src/cli.ts`                | Argument parsing (`parseCli`), the help text, and the fatal-error formatter.                             |
| `src/config.ts`             | Resolves boot config (account, relays, write gate) from flags and env.                                   |
| `src/bootstrap.ts`          | Boots the runtime: Node shims, builds the signer, selects and unlocks the account, injects it into core. |
| `src/server.ts`             | Builds the `McpServer`, registers tools (honoring the write gate), and starts the stdio transport.       |
| `src/version.ts`            | `version` command: reads the installed version and checks npm for updates.                               |
| `src/auth/mcpSigner.ts`     | Builds the keystore-backed `@formstr/signer` instance.                                                   |
| `src/auth/kvStore.ts`       | The encrypted keystore: OS keychain, with an AES-256-GCM file fallback.                                  |
| `src/auth/login.ts`         | The login, logout, whoami, accounts, and switch logic.                                                   |
| `src/auth/toNostrSigner.ts` | Adapts the signer to core's `NostrSigner` interface.                                                     |
| `src/auth/methodMap.ts`     | Maps the signer's login method to core's `SignerMethod`.                                                 |
| `src/auth/pool.ts`          | A WebSocket-patched relay pool for NIP-46 in Node.                                                       |
| `src/auth/terminal.ts`      | Terminal IO: prompts, hidden passphrase input, and the QR renderer.                                      |

## Identity and the keystore

Identity is powered by `@formstr/signer`, the same engine the web app uses. The only
difference is storage: the web app persists to `localStorage`, while the MCP persists to an
encrypted keystore on the machine. Login happens once, out of band, in the terminal, so
secrets never enter an agent conversation. No tool ever returns key material.

### Where keys live

`createKeystoreStorage` picks a backend in this order:

1. **The OS keychain** (macOS Keychain, Windows Credential Manager, or the Linux Secret
   Service through `@napi-rs/keyring`). This is the default and is preferred whenever it is
   usable. The store probes that the secret service actually works before trusting it.
2. **An AES-256-GCM encrypted file** at `~/.config/formstr-mcp/keystore.enc` (mode 0600),
   used when no keychain is available (for example on a headless Linux box). This file is
   encrypted with a key derived from `FORMSTR_MCP_PASSPHRASE` via scrypt.

You can force a backend with `FORMSTR_MCP_KEYSTORE=keychain|file` and move the directory
with `FORMSTR_MCP_CONFIG_DIR`.

A useful property: the stored key is defense-in-depth. Even on the file fallback, the key
inside the keystore is itself NIP-49 (`ncryptsec`) encrypted, so recovering it needs both
the keystore file and the unlock passphrase. There is no plaintext-nsec path anywhere; a
raw key is never read from env, a flag, or a config file.

### Login methods

`formstr-mcp login` is fully terminal-interactive (no browser, no localhost server) and
offers four methods:

| Method     | What happens                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Create     | Generates a new key, encrypts it with a passphrase you choose, and prints the `ncryptsec` once. Back it up; it is the only recovery path.       |
| Import     | Paste an `nsec`, a hex secret, or an existing `ncryptsec1...`. Anything not already encrypted is encrypted with your passphrase before storage. |
| Bunker URI | Paste a `bunker://...` URI (NIP-46). Your key stays in the remote signer; only the session is stored.                                           |
| QR         | A `nostrconnect://` URI is rendered as a terminal QR; scan it in Amber, nsec.app, or another signer.                                            |

For NIP-46 logins the server requests the `sign_event`, `nip04_encrypt`, `nip04_decrypt`,
`nip44_encrypt`, and `nip44_decrypt` permissions, because several bunker UIs skip the
approval prompt entirely if no permission list is sent.

### Multiple accounts

The keystore holds as many identities as you log into. `accounts` lists them and marks the
active one. `switch <npub|hex>` changes the persisted active account, and `--account
<npub|hex>` selects one for a single boot without changing the persisted choice. Both accept
either the npub (as shown by `accounts`) or the hex pubkey, because users naturally copy the
npub while the signer keys on the hex pubkey internally.

## Boot and unlock

When the server starts (the `run` command, which is the default), `bootstrap` does the
following:

1. **Install Node shims.** It defines a small in-memory `localStorage` shim (the shared core
   expects one) and wires the `ws` WebSocket implementation into `nostr-tools`, patching the
   pool instance directly so relay connections work on Node versions without a native
   WebSocket.
2. **Apply a relay override** if `--relays` or `FORMSTR_RELAYS` is set, by replacing
   `relayManager.getRelaysForModule` process-wide so every module uses the operator's relays.
3. **Build the keystore-backed signer** and select the account (`--account` if given, else
   the persisted active account).
4. **Unlock the account** (details below).
5. **Inject the unlocked signer into core** through `signerManager.setActiveSigner`, exactly
   as the web app does.

Then `startStdio` builds the server, registers the tools, and connects the stdio transport.
All logging goes to stderr, because stdout is the MCP transport.

### How each account type unlocks headlessly

- **ncryptsec accounts** decrypt with a passphrase. The order of preference is: first try the
  configured passphrase (`FORMSTR_MCP_NCRYPTSEC_PASSPHRASE`); if that is missing or wrong and
  the process has an interactive terminal, prompt for it and re-ask up to three times;
  otherwise throw a verbose, actionable error. When an MCP host spawns the server, stdin is
  the JSON-RPC channel, so there is nobody to prompt, which is exactly why the env var is
  required in that case. Each account has its own passphrase.
- **NIP-46 accounts** resume silently from their stored session. The server rebuilds the
  bunker connection from the persisted remote-signer pubkey, relays, and client secret key,
  and skips the `connect` handshake, so there is no fresh approval prompt on every boot. It
  never replays the original pairing URI, because a `nostrconnect://` QR URI is not a valid
  `bunker://` URI and would be rejected.

This is why a NIP-46 (bunker) account is the simplest setup for a host: it needs no
passphrase in any config file. If you would rather not store a passphrase, `switch` to a
bunker account and the host config can stay secret-free.

## Commands and flags

```
formstr-mcp [command] [flags]
```

| Command       | Effect                                                                                |
| ------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `run`         | Run the stdio MCP server. This is the default when no command is given.               |
| `login`       | Sign in (create, import, bunker URI, or QR) and store the key.                        |
| `logout [npub | hex]`                                                                                 | Permanently remove a stored account (defaults to the active one). |
| `whoami`      | Print the active account.                                                             |
| `accounts`    | List stored accounts; `*` marks the active one.                                       |
| `switch <npub | hex>`                                                                                 | Set the persisted active account.                                 |
| `help`        | Show usage. Also `-h` and `--help`.                                                   |
| `version`     | Print the installed version and check npm for a newer one. Also `-v` and `--version`. |

| Flag                 | Effect                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| `--allow-writes`     | Register the gated write tools. Without it, only read and create tools are served. |
| `--account <npub     | hex>`                                                                              | Boot a specific stored account for this run only. |
| `--relays <a,b,...>` | Override the relay set for every module (comma-separated).                         |

Only `run` is long-lived. The one-shot commands force-exit when done so that any relay
sockets a NIP-46 login opened cannot keep the Node event loop alive.

### Environment variables

| Variable                           | Meaning                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` | Unlock the active ncryptsec account at boot.                  |
| `FORMSTR_MCP_PASSPHRASE`           | Encrypt the at-rest keystore file (keychain-less hosts only). |
| `FORMSTR_MCP_KEYSTORE`             | Force the `file` or `keychain` backend.                       |
| `FORMSTR_MCP_CONFIG_DIR`           | Keystore directory (default `~/.config/formstr-mcp`).         |
| `FORMSTR_RELAYS`                   | Comma-separated relay override (same effect as `--relays`).   |
| `FORMSTR_MCP_DEBUG`                | Set to `1` to print full stack traces on fatal errors.        |

## The safety model

Two independent gates protect destructive and outward actions, and it helps to keep them
separate.

1. **Registration gate (`--allow-writes`).** A tool flagged `write` is only registered when
   the server starts with `--allow-writes`. Without that flag those tools simply do not
   appear in the host's tool list, so the model cannot call them at all. 23 of the 53 tools
   are write tools.
2. **Confirmation gate (`confirm: true`).** Even when a write tool is registered, its handler
   refuses to run unless the call includes `"confirm": true`. Without it the tool returns a
   structured "Confirmation required" message that names the irreversible effect, instead of
   doing anything. This is the per-handler `requireConfirm` guard in the agent package.

So to actually mutate state from a host you need both: start the server with
`--allow-writes`, and the model must pass `confirm: true` on the call. Read and create tools
have neither requirement.

One sharing nuance worth stating: `share_form` distributes only the view key, which grants
read access. It never distributes the signing key.

## Tool catalog

There are 53 tools across the five modules: 30 read-or-create tools that are always
available, and 23 write tools that appear only with `--allow-writes` and that each require
`confirm: true`. The schemas come from the agent registry's zod shapes, so they are
identical to what the in-browser assistant sees.

### Forms (9)

Always on:

- `list_forms` lists your forms with ids, encryption status, and naddr coordinates.
- `get_form` returns a form's fields, settings, and encryption status (pass `viewKey` for an
  encrypted form).
- `fetch_form_responses` returns submissions with the responder npub and per-field answers;
  it auto-decrypts when the form is in your own list.
- `create_form` creates a form with full field, validation, image, and thank-you support.
- `import_form_from_naddr` adds a form to your list by `naddr1...`, `pubkey:formId`, or
  `kind:pubkey:formId`.

Write (need `--allow-writes` and `confirm: true`):

- `update_form` republishes a form's name, fields, or description.
- `share_form` gift-wraps an encrypted form's view key to collaborators.
- `delete_form` publishes a NIP-09 deletion and trims the forms index.
- `submit_form_response` submits a response on your identity.

### Calendar (19)

Always on: `list_calendar_events`, `get_calendar_event`, `create_calendar_event`,
`list_calendars`, `create_calendar`, `fetch_event_rsvps`, `list_invitations`,
`list_scheduling_pages`, `list_booking_requests`.

Write: `approve_booking`, `decline_booking`, `delete_calendar_event`, `rsvp_event`,
`update_calendar_event`, `attach_form_to_event`, `update_calendar`, `delete_calendar`,
`add_event_to_calendar`, `remove_event_from_calendar`.

Two calendar notes for integrators. `create_calendar_event` defaults to a private event and
asks which calendar to file it under when you have calendars and have not chosen one (it
returns the list and a `CALENDAR_REQUIRED` code). A private event created from an MCP host
does send NIP-59 gift-wrap invitations to each participant, published to that participant's
NIP-65 relays, but the tool result does not currently echo how many invites went out, which
is the usual reason an invite seems "missing".

### Pages (12)

Always on: `list_pages`, `get_page`, `list_shared_pages`, `get_page_tags`,
`list_page_comments`, `create_page`, `save_private_note`, `update_page`, `set_page_tags`.

Write: `delete_page`, `share_page`, `add_page_comment`.

### Polls (8)

Always on: `list_polls`, `list_recent_polls`, `get_poll`, `fetch_poll_results`,
`create_poll`.

Write: `submit_poll_response`, `delete_poll`, `clear_my_vote`.

### Drive (5)

Always on: `browse_files`, `get_file_info`.

Write: `delete_file`, `rename_file`, `move_file`.

There is no upload or create-file tool, by design. Blossom blobs cannot be streamed over the
MCP text channel, so file creation happens in the web app; the MCP only browses and manages
the existing metadata index.

## Host configuration

After `login`, no key belongs in the config. The minimal entry runs the published package:

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

Add `"--allow-writes"` to `args` to enable the gated tools, and
`"--relays", "wss://a,wss://b"` to override relays.

### Passing the ncryptsec passphrase

If your active account is an `ncryptsec` key (a Create or Import login), the server needs its
passphrase to unlock at boot, and a host cannot prompt for it (stdin is the JSON-RPC
channel). Supply it through an `env` block in the server entry of your config
(`claude_desktop_config.json`, Cursor's `~/.cursor/mcp.json`, and similar):

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

The host hands that value to the server as an environment variable at startup, so it never
enters the transcript. It unlocks whichever account is active. If you prefer not to keep a
passphrase in a config file, use a NIP-46 (bunker) account instead and skip the env block.

### Using a local model through Ollama

Ollama is not an MCP client; it just runs the model. To drive this server with a local model
you need an MCP host that uses Ollama as its backend, for example
[Goose](https://block.github.io/goose/). The steps are: pull a model that supports tool
calling and run `ollama serve`; run `formstr-mcp login` once; point Goose at Ollama
(`goose configure`, Configure Providers, Ollama); then add a command-line extension that runs
`npx -y @formstr/mcp` (add `--allow-writes` to enable writes) and set the passphrase env var
if you use an ncryptsec account. A model without tool-calling support can chat but cannot
invoke these tools.

## Versioning and updates

`formstr-mcp version` (or `-v` / `--version`) prints the installed version and checks the
npm registry for a newer one:

```text
$ formstr-mcp version
@formstr/mcp 0.4.0
Update available: 0.5.0 (you have 0.4.0).
Upgrade: npm install -g @formstr/mcp@latest
Or just re-run via: npx -y @formstr/mcp@latest
```

The check is best-effort with a three second timeout: if you are offline or the registry is
unreachable it prints the installed version and a note rather than an error. The installed
version is read from the package's own `package.json`, which resolves the same way whether
the code is running from source, from the bundle, or from the published package, because npm
always ships `package.json`. If you launch with `npx -y @formstr/mcp` you already get the
latest published version on each launch; pin a version in your host config if you would
rather control upgrades.

## Building and testing

```bash
pnpm --filter @formstr/mcp test       # unit tests plus a stdio smoke test
pnpm --filter @formstr/mcp typecheck
pnpm --filter @formstr/mcp build      # single-file CJS bundle (keychain dep stays external)
```

If the workspace test wrapper trips over an esbuild deps check, run Vitest directly from the
package directory instead: `node ../../node_modules/vitest/vitest.mjs run`. The `tsup`
binary for the bundle lives at `packages/mcp/node_modules/.bin/tsup`. There is also an
end-to-end harness, `test-create-form.mjs`, that round-trips create, get, and delete of a
form against live relays:

```bash
FORMSTR_MCP_NCRYPTSEC_PASSPHRASE='<passphrase>' node packages/mcp/test-create-form.mjs
```

Publishing is a manual, 2FA-gated step (`npm publish --otp=<code>`); `prepublishOnly` runs
the build, and the published `files` are just `dist` and `README.md`.

## Troubleshooting

- **A host says it cannot unlock the account.** The active account is an ncryptsec and no
  passphrase reached the server. Add `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` to the server entry's
  `env`, or `switch` to a NIP-46 account (which needs no passphrase). Remember that each
  account has its own passphrase.
- **Write tools are missing from the host.** They are not registered without
  `--allow-writes`. Add it to `args`. Note the flag is plural; `--allow-write` is ignored.
- **A write tool returns "Confirmation required".** That is expected. The model must re-call
  with `"confirm": true`.
- **QR (nostrconnect) pairing fails with Amber** with a "subscription closed before
  connection was established" error. This is a known handshake interop issue between the
  underlying nostr-tools client and Amber, downstream of this package. Use the `bunker://`
  flow from nsec.app instead: copy the full `bunker://...&secret=...` URI from its Connect
  app. A bunker URI without a `secret=` token fails fast with a clear message.
- **Want a full stack trace.** Set `FORMSTR_MCP_DEBUG=1`.

```

```
