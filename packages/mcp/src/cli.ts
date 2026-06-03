export type Command = "run" | "login" | "logout" | "whoami";

export interface Cli {
  command: Command;
  nsec?: string;
  relays?: string[];
  allowWrites: boolean;
  /** Pubkey selecting which stored identity to use (defaults to the keystore default). */
  account?: string;
}

const SUBCOMMANDS = new Set<Command>(["login", "logout", "whoami"]);

/** Parse `process.argv.slice(2)` into a subcommand + flags. */
export function parseCli(argv: string[]): Cli {
  const rest = [...argv];
  let command: Command = "run";
  if (rest[0] && SUBCOMMANDS.has(rest[0] as Command)) {
    command = rest.shift() as Command;
  }

  let nsec: string | undefined;
  let relays: string[] | undefined;
  let account: string | undefined;
  let allowWrites = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--nsec") nsec = rest[++i];
    else if (arg === "--relays") relays = splitRelays(rest[++i]);
    else if (arg === "--allow-writes") allowWrites = true;
    else if (arg === "--account") account = rest[++i];
  }

  return { command, nsec, relays, allowWrites, account };
}

export function splitRelays(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
