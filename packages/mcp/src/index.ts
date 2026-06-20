import { doLogin, doLogout, doSwitch, listAccounts, whoami } from "./auth/login";
import { buildMcpSigner } from "./auth/mcpSigner";
import { createPatchedPool } from "./auth/pool";
import { createTerminalIo, printQr } from "./auth/terminal";
import { bootstrap } from "./bootstrap";
import { parseCli, helpText, type Command } from "./cli";
import { resolveConfig } from "./config";
import { startStdio } from "./server";

async function runServer(cli: ReturnType<typeof parseCli>): Promise<void> {
  const cfg = resolveConfig(cli, process.env);
  // On an interactive terminal, prompt for the ncryptsec passphrase when it
  // isn't set in the environment. When an MCP host spawns the server, stdin is
  // the JSON-RPC channel (not a TTY) — there's nobody to prompt — so we skip it
  // and the env var stays required. The terminal IO is created lazily so it only
  // ever touches stdin when a passphrase is genuinely needed (not for nip46 or
  // env-var unlocks), then closes before startStdio takes over stdin.
  const deps = process.stdin.isTTY
    ? {
        promptPassphrase: async (question: string): Promise<string> => {
          const io = createTerminalIo();
          try {
            return await io.promptPassphrase(question);
          } finally {
            io.close();
          }
        },
      }
    : {};
  const account = await bootstrap({ account: cfg.account, relays: cfg.relays }, deps);
  console.error(
    `formstr-mcp: signed in as ${account.npub} (${account.method}), ` +
      `writes ${cfg.allowWrites ? "ENABLED" : "disabled"}`,
  );
  await startStdio({ allowWrites: cfg.allowWrites });
  console.error("formstr-mcp: server running on stdio");
}

async function runLogin(cli: ReturnType<typeof parseCli>): Promise<void> {
  const io = createTerminalIo();
  // Own the pool here so we can tear it down once pairing is done. NIP-46
  // logins (bunker + QR) open relay sockets and a live subscription on this
  // pool; left open they keep the Node event loop alive and `login` hangs
  // instead of returning to the shell.
  const pool = createPatchedPool();
  try {
    const account = await doLogin({
      signer: await buildMcpSigner(),
      prompt: io.prompt,
      promptPassphrase: io.promptPassphrase,
      printQr,
      pool,
      relays: cli.relays,
    });
    console.error(
      `formstr-mcp: signed in as ${account.npub} (${account.method}). Key stored securely.`,
    );
  } finally {
    io.close();
    try {
      pool.destroy();
    } catch {
      // best-effort: closing relay sockets must never mask a login result
    }
  }
}

async function main(): Promise<Command> {
  const cli = parseCli(process.argv.slice(2));

  switch (cli.command) {
    case "login":
      await runLogin(cli);
      return cli.command;
    case "logout": {
      await doLogout(await buildMcpSigner(), cli.account);
      console.error("formstr-mcp: signed out.");
      return cli.command;
    }
    case "whoami": {
      const who = whoami(await buildMcpSigner());
      console.error(
        who ? `formstr-mcp: ${who.npub} (${who.method})` : "formstr-mcp: not signed in.",
      );
      return cli.command;
    }
    case "accounts": {
      const signer = await buildMcpSigner();
      const active = whoami(signer);
      const accounts = listAccounts(signer);
      if (accounts.length === 0) {
        console.error("formstr-mcp: no accounts. Run `formstr-mcp login`.");
        return cli.command;
      }
      for (const a of accounts) {
        const marker = active && a.pubkey === active.pubkey ? "* " : "  ";
        console.error(`${marker}${a.npub} (${a.method})`);
      }
      return cli.command;
    }
    case "switch": {
      if (!cli.target) {
        throw new Error(
          "Usage: formstr-mcp switch <npub|hex>. Run `formstr-mcp accounts` to list them.",
        );
      }
      const account = await doSwitch(await buildMcpSigner(), cli.target);
      console.error(`formstr-mcp: active account is now ${account.npub} (${account.method}).`);
      return cli.command;
    }
    case "help":
      console.error(helpText());
      return cli.command;
    case "run":
    default:
      await runServer(cli);
      return "run";
  }
}

main()
  .then((command) => {
    // One-shot subcommands (login/logout/whoami/accounts) must return to the
    // shell. Force-exit so any relay sockets / NIP-46 subscription a login
    // opened can't keep the event loop alive. `run` is the long-lived stdio
    // server (kept alive by stdin) and must NOT exit here.
    if (command !== "run") process.exit(0);
  })
  .catch((err) => {
    console.error("formstr-mcp: fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
