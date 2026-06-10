export type Command = "run" | "login" | "logout" | "whoami" | "accounts";

export interface Cli {
  command: Command;
  relays?: string[];
  allowWrites: boolean;
  /** Pubkey selecting which stored identity to use (defaults to the active account). */
  account?: string;
}

const SUBCOMMANDS = new Set<Command>(["login", "logout", "whoami", "accounts"]);

/** Parse `process.argv.slice(2)` into a subcommand + flags. */
export function parseCli(argv: string[]): Cli {
  const rest = [...argv];
  let command: Command = "run";
  if (rest[0] && SUBCOMMANDS.has(rest[0] as Command)) {
    command = rest.shift() as Command;
  }

  let relays: string[] | undefined;
  let account: string | undefined;
  let allowWrites = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--relays") relays = splitRelays(rest[++i]);
    else if (arg === "--allow-writes") allowWrites = true;
    else if (arg === "--account") account = rest[++i];
  }

  return { command, relays, allowWrites, account };
}

export function splitRelays(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
