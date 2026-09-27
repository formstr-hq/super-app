import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSigner } from "@formstr/core";
import { listen } from "@formstr/nostr-transport";
import type { NostrDuplex } from "@formstr/nostr-transport";
import { getPublicKey, nip19 } from "nostr-tools";

import { startAdminServer } from "./admin/server.js";
import { bridgeToHarness } from "./bridge.js";
import { loadConfig, type ResolvedConfig } from "./config.js";
import { createNodeRuntime } from "./runtime.js";
import { HomeNodeState } from "./state.js";

function main(): void {
  const cfg: ResolvedConfig = loadConfig();
  const signer = new LocalSigner(cfg.secretKey);
  const { runtime, relayStatus } = createNodeRuntime();
  const myPubkey = getPublicKey(cfg.secretKey);
  const state = new HomeNodeState();

  console.log("formstr home node");
  console.log("  npub:   ", nip19.npubEncode(myPubkey));
  console.log("  relays: ", cfg.relays.join(", "));
  console.log("  privacy:", cfg.privacy);
  console.log(
    `  exposed: ${cfg.exposed.map((h) => h.command).join(", ")}` +
      (cfg.harnessAuto ? " (auto-detected)" : ""),
  );
  console.log("  default:", cfg.harness.command, (cfg.harness.args ?? []).join(" "));

  const listener = listen(
    { runtime, signer, relays: cfg.relays, privacy: cfg.privacy },
    (pubkey: string) => cfg.whitelist.has(pubkey),
  );
  const ocConfigPath = join(tmpdir(), "formstr-home-node-opencode.json");
  listener.onConnection((duplex: NostrDuplex) => {
    // Read the model at spawn time so dashboard changes take effect immediately.
    // opencode ignores OPENCODE_MODEL for ACP sessions — the model must come
    // from its config. We point OPENCODE_CONFIG at a tiny generated file that
    // just sets `model`; opencode merges it over the user's global config.
    let env = cfg.harness.env;
    if (cfg.model && cfg.harness.command === "opencode") {
      writeFileSync(
        ocConfigPath,
        JSON.stringify({ $schema: "https://opencode.ai/config.json", model: cfg.model }),
      );
      env = { ...cfg.harness.env, OPENCODE_CONFIG: ocConfigPath };
    }
    bridgeToHarness(duplex, { ...cfg.harness, env }, state);
  });

  const admin = startAdminServer({ cfg, state, myPubkey, relayStatus });
  console.log("  admin:  ", admin.urls.join("  "));
  if (admin.ygg)
    console.log("  (reachable over Yggdrasil — the admin UI has no auth; trust your mesh)");
  console.log("listening — waiting for whitelisted edge devices…");

  const shutdown = () => {
    console.log("\nshutting down…");
    admin.close();
    void listener.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
