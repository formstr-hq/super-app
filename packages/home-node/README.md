# @formstr/home-node

Runs on your always-on machine. Listens over Nostr for **whitelisted** edge
devices and pipes each session into a local **ACP harness** (e.g. `opencode`)
over stdio. The transport ([`@formstr/nostr-transport`](../transport)) is
ACP-blind — this daemon just spawns the harness and connects the pipes.

```
edge device (super-app)  ⇄  Nostr relays  ⇄  home-node  ⇄  opencode (ACP/stdio)
        connect()                              listen()      spawn + pipe
```

## Setup

1. **Build** (from the monorepo root):

   ```bash
   pnpm --filter @formstr/home-node build
   ```

2. **Make a config** — copy `home-node.config.example.json` and fill it in:

   ```json
   {
     "nsec": "nsec1...", // this home node's identity
     "relays": ["wss://relay.damus.io", "wss://nos.lol"],
     "whitelist": ["npub1phone...", "npub1laptop..."], // your edge devices
     "cwd": "/home/you/projects/your-repo", // where the agent works
     "privacy": "nip44",
     "admin": { "port": 4577, "host": "yggdrasil" }
   }
   ```

   - `nsec`: generate a fresh key for the node (its npub is what you paste into
     the super-app). Keep it secret.
   - `whitelist`: the npub of **each** edge device that may connect. Nothing else
     can open a session.
   - **`harness` is optional.** If omitted, the daemon **auto-detects** installed
     ACP agents on `PATH` (opencode → `opencode acp`, Claude Code →
     `claude-code-acp`, Gemini → `gemini --experimental-acp`) and exposes them
     zero-click, using the first as the default. To pin one explicitly:
     ```json
     "harness": { "command": "opencode", "args": ["acp"], "cwd": "/path/to/repo" }
     ```
   - **`admin.host`**: `"127.0.0.1"` (default, local only), `"yggdrasil"` (also
     binds your [Yggdrasil](https://yggdrasil-network.github.io/) mesh address so
     you can reach the dashboard from anywhere on your mesh), or `"::"` (all
     interfaces). ⚠️ The admin UI has **no auth** — only expose it on networks
     you trust (Yggdrasil is a private mesh, so that's usually fine).

3. **Run**:

   ```bash
   node packages/home-node/dist/index.js /path/to/home-node.config.json
   # or during dev:
   pnpm --filter @formstr/home-node dev /path/to/home-node.config.json
   ```

   It prints its own npub on startup — copy that into the super-app.

4. **Open the admin dashboard** — the daemon serves a local web UI (default
   `http://127.0.0.1:4577`, set via `admin` in the config). It shows the node's
   npub, the exposed ACP harness, live relay status, active sessions (with
   harness pid + bytes), and the allowed-device npubs. You can kill a session or
   add/remove an allowed npub live — whitelist edits persist back to the config
   file.

## What happens per connection

- An allowlisted edge device completes the handshake → `onConnection` fires.
- The daemon spawns one `opencode acp` process for that session.
- Edge bytes → harness stdin; harness stdout → edge bytes.
- When either side closes (or the harness exits), the other is torn down.

## Notes / current limits

- One harness process **per session** (per connected edge device).
- Uses a local `nsec` signer. NIP-46 (bunker) support can be added later by
  swapping the signer.
- Ephemeral wire kinds mean **both ends must be online**; there's no offline
  queue. Fine for interactive use.
