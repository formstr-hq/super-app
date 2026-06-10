import { doLogin, doLogout, listAccounts, whoami } from "./auth/login";
import { buildMcpSigner } from "./auth/mcpSigner";
import { createPatchedPool } from "./auth/pool";
import { createTerminalIo, printQr } from "./auth/terminal";
import { bootstrap } from "./bootstrap";
import { parseCli } from "./cli";
import { resolveConfig } from "./config";
import { startStdio } from "./server";

async function runServer(cli: ReturnType<typeof parseCli>): Promise<void> {
  const cfg = resolveConfig(cli, process.env);
  const account = await bootstrap({ account: cfg.account, relays: cfg.relays });
  console.error(
    `formstr-mcp: signed in as ${account.npub} (${account.method}), ` +
      `writes ${cfg.allowWrites ? "ENABLED" : "disabled"}`,
  );
  await startStdio({ allowWrites: cfg.allowWrites });
  console.error("formstr-mcp: server running on stdio");
}

async function runLogin(cli: ReturnType<typeof parseCli>): Promise<void> {
  const io = createTerminalIo();
  try {
    const account = await doLogin({
      signer: await buildMcpSigner(),
      prompt: io.prompt,
      promptPassphrase: io.promptPassphrase,
      printQr,
      pool: createPatchedPool(),
      relays: cli.relays,
    });
    console.error(
      `formstr-mcp: signed in as ${account.npub} (${account.method}). Key stored securely.`,
    );
  } finally {
    io.close();
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));

  switch (cli.command) {
    case "login":
      await runLogin(cli);
      return;
    case "logout": {
      await doLogout(await buildMcpSigner(), cli.account);
      console.error("formstr-mcp: signed out.");
      return;
    }
    case "whoami": {
      const who = whoami(await buildMcpSigner());
      console.error(
        who ? `formstr-mcp: ${who.npub} (${who.method})` : "formstr-mcp: not signed in.",
      );
      return;
    }
    case "accounts": {
      const signer = await buildMcpSigner();
      const active = whoami(signer);
      const accounts = listAccounts(signer);
      if (accounts.length === 0) {
        console.error("formstr-mcp: no accounts. Run `formstr-mcp login`.");
        return;
      }
      for (const a of accounts) {
        const marker = active && a.pubkey === active.pubkey ? "* " : "  ";
        console.error(`${marker}${a.npub} (${a.method})`);
      }
      return;
    }
    case "run":
    default:
      await runServer(cli);
  }
}

main().catch((err) => {
  console.error("formstr-mcp: fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
