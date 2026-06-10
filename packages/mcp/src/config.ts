import { type Cli, splitRelays } from "./cli";

export interface ResolvedConfig {
  /** Which stored account to boot (`--account`), or the keystore's active one. */
  account?: string;
  relays?: string[];
  allowWrites: boolean;
}

/**
 * Resolve the boot configuration from CLI flags + environment. The signing identity
 * lives entirely in the keystore-backed `@formstr/signer` (selected + unlocked in
 * `bootstrap`), so there is no key material here — only the account selector, the
 * relay override, and the write gate.
 */
export function resolveConfig(cli: Cli, env: NodeJS.ProcessEnv): ResolvedConfig {
  return {
    account: cli.account,
    relays: cli.relays ?? splitRelays(env.FORMSTR_RELAYS),
    allowWrites: cli.allowWrites,
  };
}
