import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getPublicKey } from "nostr-tools";
import { decode } from "nostr-tools/nip19";
import { z } from "zod";

import { type Credential } from "./auth/credential";
import { createKeystore, type Keystore } from "./auth/keystore";
import { type Cli, splitRelays } from "./cli";

export interface ResolvedConfig {
  credential: Credential;
  relays?: string[];
  allowWrites: boolean;
  /** Where the credential came from — drives the plaintext security warning. */
  source: "plaintext" | "keystore";
}

const fileSchema = z.object({
  nsec: z.string().optional(),
  relays: z.array(z.string()).optional(),
});

function configDir(env: NodeJS.ProcessEnv): string {
  return env.FORMSTR_MCP_CONFIG_DIR ?? join(homedir(), ".config", "formstr-mcp");
}

function readConfigFile(env: NodeJS.ProcessEnv): { nsec?: string; relays?: string[] } {
  const path = join(configDir(env), "config.json");
  try {
    return fileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

/** Read a plaintext key from flags → env → config.json (the legacy/headless path). */
export function plaintextSource(
  cli: Cli,
  env: NodeJS.ProcessEnv,
): { nsec?: string; relays?: string[] } {
  const file = readConfigFile(env);
  return {
    nsec: cli.nsec ?? env.FORMSTR_NSEC ?? file.nsec,
    relays: cli.relays ?? splitRelays(env.FORMSTR_RELAYS) ?? file.relays,
  };
}

const PLAINTEXT_WARNING = [
  "",
  "⚠️  formstr-mcp: using a PLAINTEXT nsec from env/CLI/config.json.",
  "    This key is readable by anyone who can read your MCP host config.",
  "    For secure storage (OS keychain) run:  formstr-mcp login",
  "",
].join("\n");

/**
 * Resolve the signing credential. Precedence: a plaintext nsec (flags/env/config.json,
 * which prints a loud warning) → the OS keychain credential (default or `--account`) →
 * a friendly error telling the user to run `formstr-mcp login`.
 */
export async function resolveConfig(
  cli: Cli,
  env: NodeJS.ProcessEnv,
  keystore: Keystore = createKeystore(),
): Promise<ResolvedConfig> {
  const plaintext = plaintextSource(cli, env);

  if (plaintext.nsec) {
    console.error(PLAINTEXT_WARNING);
    return {
      credential: { method: "local", pubkey: pubkeyFromNsec(plaintext.nsec), nsec: plaintext.nsec },
      relays: plaintext.relays,
      allowWrites: cli.allowWrites,
      source: "plaintext",
    };
  }

  const cred = await keystore.get(cli.account);
  if (cred) {
    const credRelays = cred.method === "nip46" ? cred.relays : undefined;
    return {
      credential: cred,
      relays: plaintext.relays ?? credRelays,
      allowWrites: cli.allowWrites,
      source: "keystore",
    };
  }

  throw new Error(
    "No credentials found. Run `formstr-mcp login` to sign in securely, " +
      "or set FORMSTR_NSEC for headless/CI use.",
  );
}

function pubkeyFromNsec(nsec: string): string {
  const decoded = decode(nsec.trim());
  if (decoded.type !== "nsec") throw new Error("Invalid nsec.");
  return getPublicKey(decoded.data);
}

export function redact(secret: string | undefined): string {
  if (!secret) return "(none)";
  return secret.slice(0, 5) + "…";
}
