import { signerManager } from "@formstr/core";

import { doLogin, doLogout, whoami } from "./auth/login";
import { bootstrap } from "./bootstrap";
import { parseCli } from "./cli";
import { resolveConfig } from "./config";
import { startStdio } from "./server";

async function runServer(cli: ReturnType<typeof parseCli>): Promise<void> {
  const cfg = await resolveConfig(cli, process.env);
  await bootstrap({ credential: cfg.credential, relays: cfg.relays });
  const pubkey = signerManager.getPublicKey();
  console.error(
    `formstr-mcp: signed in as ${pubkey?.slice(0, 12)}… ` +
      `(${cfg.credential.method}, source: ${cfg.source}), ` +
      `writes ${cfg.allowWrites ? "ENABLED" : "disabled"}`,
  );
  await startStdio({ allowWrites: cfg.allowWrites });
  console.error("formstr-mcp: server running on stdio");
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));

  switch (cli.command) {
    case "login": {
      const cred = await doLogin(cli.relays);
      console.error(
        `formstr-mcp: signed in as ${cred.pubkey} (${cred.method}). Key stored securely.`,
      );
      return;
    }
    case "logout": {
      await doLogout(cli.account);
      console.error("formstr-mcp: signed out.");
      return;
    }
    case "whoami": {
      const who = await whoami();
      console.error(
        who ? `formstr-mcp: ${who.pubkey} (${who.method})` : "formstr-mcp: not signed in.",
      );
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
