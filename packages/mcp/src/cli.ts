export type Command = "run" | "login" | "logout" | "whoami" | "accounts" | "switch" | "help";

export interface Cli {
  command: Command;
  relays?: string[];
  allowWrites: boolean;
  /** Pubkey selecting which stored identity to use (defaults to the active account). */
  account?: string;
  /** First positional argument after the subcommand (e.g. the account for `switch`). */
  target?: string;
}

const SUBCOMMANDS = new Set<Command>(["login", "logout", "whoami", "accounts", "switch", "help"]);

/** Parse `process.argv.slice(2)` into a subcommand + flags. */
export function parseCli(argv: string[]): Cli {
  const rest = [...argv];
  // `-h`/`--help` anywhere is a help request, regardless of any subcommand.
  if (rest.includes("-h") || rest.includes("--help")) {
    return { command: "help", allowWrites: false };
  }

  let command: Command = "run";
  if (rest[0] && SUBCOMMANDS.has(rest[0] as Command)) {
    command = rest.shift() as Command;
  }

  let relays: string[] | undefined;
  let account: string | undefined;
  let target: string | undefined;
  let allowWrites = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--relays") relays = splitRelays(rest[++i]);
    else if (arg === "--allow-writes") allowWrites = true;
    else if (arg === "--account") account = rest[++i];
    else if (!arg.startsWith("-") && target === undefined) target = arg;
  }

  return { command, relays, allowWrites, account, target };
}

export function splitRelays(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/** Usage text printed by the `help` command (and `-h`/`--help`). */
export function helpText(): string {
  return [
    "formstr-mcp — MCP server for the Formstr super-app (Nostr forms & more).",
    "",
    "Usage: formstr-mcp [command] [flags]",
    "",
    "Commands:",
    "  run               Run the stdio MCP server (default when no command is given).",
    "  login             Sign in (create / import / bunker URI / QR) and store the key.",
    "  logout [npub]     Remove a stored account (defaults to the active one).",
    "  whoami            Print the active account.",
    "  accounts          List stored accounts ('*' marks the active one).",
    "  switch <npub>     Set the active account (accepts an npub or hex pubkey).",
    "  help              Show this help (also -h, --help).",
    "",
    "Flags:",
    "  --allow-writes         Enable gated write tools (update / delete / share / submit).",
    "  --account <npub|hex>   Boot a specific account instead of the active one.",
    "  --relays <a,b,…>       Override relays (comma-separated).",
    "",
    "Env:",
    "  FORMSTR_MCP_NCRYPTSEC_PASSPHRASE   Unlock the active ncryptsec account at boot.",
    "  FORMSTR_MCP_PASSPHRASE             Encrypt the keystore file (keychain-less hosts).",
  ].join("\n");
}
