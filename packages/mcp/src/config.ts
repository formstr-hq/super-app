import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

export interface ResolvedConfig {
  nsec: string;
  relays?: string[];
  allowWrites: boolean;
}

interface ConfigInput {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

const fileSchema = z.object({
  nsec: z.string().optional(),
  relays: z.array(z.string()).optional(),
});

function parseFlags(argv: string[]): { nsec?: string; relays?: string[]; allowWrites: boolean } {
  let nsec: string | undefined;
  let relays: string[] | undefined;
  let allowWrites = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--nsec") nsec = argv[++i];
    else if (argv[i] === "--relays") relays = splitRelays(argv[++i]);
    else if (argv[i] === "--allow-writes") allowWrites = true;
  }
  return { nsec, relays, allowWrites };
}

function splitRelays(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function readConfigFile(): { nsec?: string; relays?: string[] } {
  const path = join(homedir(), ".config", "formstr-mcp", "config.json");
  try {
    return fileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function resolveConfig(input: ConfigInput): ResolvedConfig {
  const flags = parseFlags(input.argv);
  const file = readConfigFile();
  const nsec = flags.nsec ?? input.env.FORMSTR_NSEC ?? file.nsec;
  const relays = flags.relays ?? splitRelays(input.env.FORMSTR_RELAYS) ?? file.relays;
  const allowWrites = flags.allowWrites || input.env.FORMSTR_ALLOW_WRITES === "true";

  if (!nsec) {
    throw new Error(
      "No signing key found. Provide an nsec via --nsec, FORMSTR_NSEC, or ~/.config/formstr-mcp/config.json",
    );
  }
  return { nsec, relays, allowWrites };
}

export function redact(secret: string | undefined): string {
  if (!secret) return "(none)";
  return secret.slice(0, 5) + "…";
}
