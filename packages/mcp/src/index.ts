import { signerManager } from "@formstr/core";

import { bootstrap } from "./bootstrap";
import { redact, resolveConfig } from "./config";
import { startStdio } from "./server";

async function main(): Promise<void> {
  const cfg = resolveConfig({ argv: process.argv.slice(2), env: process.env });
  await bootstrap(cfg);
  const pubkey = signerManager.getPublicKey();
  console.error(
    `formstr-mcp: signed in as ${pubkey?.slice(0, 12)}… (key ${redact(cfg.nsec)}), ` +
      `writes ${cfg.allowWrites ? "ENABLED" : "disabled"}`,
  );
  await startStdio({ allowWrites: cfg.allowWrites });
  console.error("formstr-mcp: server running on stdio");
}

main().catch((err) => {
  console.error("formstr-mcp: fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
