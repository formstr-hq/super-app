import { relayManager, signerManager, nostrRuntime } from "@formstr/core";
import { type Signer, type StoredAccount } from "@formstr/signer";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { useWebSocketImplementation as setWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

import { findAccount } from "./auth/login";
import { buildMcpSigner } from "./auth/mcpSigner";
import { mapMethod } from "./auth/methodMap";
import { createPatchedPool } from "./auth/pool";
import { toNostrSigner } from "./auth/toNostrSigner";

function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: shim,
      writable: true,
      configurable: true,
    });
  } catch {
    // A non-configurable localStorage already exists (e.g. Node's experimental
    // Web Storage); leave it in place.
  }
}

function overrideRelays(relays: string[]): void {
  // RelayManager.getRelaysForModule returns hardcoded module defaults; for v1 we
  // override it process-wide so every module uses the operator's relay set.
  relayManager.getRelaysForModule = () => [...relays];
}

export interface BootstrapInput {
  /** `--account <pubkey>` override; defaults to the keystore's active account. */
  account?: string;
  /** Operator relay override (applied to every module). */
  relays?: string[];
}

export interface BootstrapDeps {
  /** Build the keystore-backed signer (overridable in tests). */
  buildSigner?: () => Promise<Signer>;
  /** WebSocket-patched pool for the NIP-46 resume (overridable in tests). */
  pool?: AbstractSimplePool;
  /** ncryptsec boot passphrase; defaults to `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE`. */
  passphrase?: string;
  /**
   * Interactively read the ncryptsec passphrase when none is configured. Only
   * wired up for interactive TTY runs — when an MCP host spawns the server,
   * stdin is the JSON-RPC channel, so there's nobody to prompt and the env var
   * is required instead.
   */
  promptPassphrase?: (question: string) => Promise<string>;
}

/**
 * Boot the runtime: install the Node shims, build the keystore-backed
 * `@formstr/signer`, select + unlock the active account, and inject the unlocked
 * signer into core's `signerManager`. Returns the account that was activated.
 *
 * Unlock: ncryptsec accounts use `FORMSTR_MCP_NCRYPTSEC_PASSPHRASE` (or, on an
 * interactive run, `deps.promptPassphrase`); nip46 accounts resume from their
 * stored client session.
 */
export async function bootstrap(
  input: BootstrapInput,
  deps: BootstrapDeps = {},
): Promise<StoredAccount> {
  installLocalStorageShim();
  setWebSocketImplementation(WebSocket);
  // When bundled into a single CJS file, nostr-tools/pool's module-level _WebSocket
  // variable (used by SimplePool's constructor) is a different binding than the one
  // setWebSocketImplementation writes to. Patch the pool instance directly so relay
  // connections work in Node environments that lack a native WebSocket (Node < 22).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nostrRuntime.pool as any)._WebSocket = WebSocket;
  if (input.relays?.length) overrideRelays(input.relays);

  const signer = await (deps.buildSigner ?? buildMcpSigner)();
  const account = await selectAccount(signer, input.account);
  await unlock(signer, account, deps);

  const active = signer.getActiveSigner();
  if (!active) throw new Error("Unlock failed: no active signer after sign-in.");
  signerManager.setActiveSigner(toNostrSigner(active), mapMethod(account.method), account.pubkey);
  return account;
}

async function selectAccount(signer: Signer, requested?: string): Promise<StoredAccount> {
  if (requested) {
    // Accept either an npub (what `accounts` shows) or a hex pubkey.
    const match = findAccount(signer.listAccounts(), requested);
    if (!match) {
      throw new Error(
        `No stored account for --account ${requested}. Run \`formstr-mcp accounts\` to list them.`,
      );
    }
    await signer.switchAccount(match.pubkey);
    return match;
  }
  const active = signer.getActiveAccount();
  if (!active) {
    throw new Error("No account found. Run `formstr-mcp login` to sign in.");
  }
  return active;
}

async function unlock(signer: Signer, account: StoredAccount, deps: BootstrapDeps): Promise<void> {
  if (account.method === "ncryptsec") {
    await unlockNcryptsec(signer, account, deps);
    return;
  }
  if (account.method === "nip46") {
    if (!account.nip46) {
      throw new Error("Stored nip46 account is missing its session. Run `formstr-mcp login`.");
    }
    const pool = deps.pool ?? createPatchedPool();
    // Silent resume: rebuild the BunkerSigner from the persisted
    // remoteSignerPubkey + relays + clientSecretKey. We must NOT replay the
    // pairing URI through loginWithBunkerUri — for a QR (nostrconnect://)
    // login that URI is not a bunker:// URI and parseBunkerInput rejects it
    // ("invalid bunker URI"). unlock() also skips the `connect` request, so
    // there's no fresh approval prompt on every boot.
    const active = await signer.unlock({ pool });
    if (!active) {
      throw new Error(
        "Could not resume the stored nip46 session (its keys are incomplete). " +
          "Run `formstr-mcp login` to re-pair.",
      );
    }
    return;
  }
  throw new Error(
    `Account method "${account.method}" cannot be unlocked headlessly — use ncryptsec or nip46.`,
  );
}

/** How many times an interactive run will re-ask for a mistyped passphrase. */
const MAX_PASSPHRASE_ATTEMPTS = 3;

/**
 * Unlock a local (ncryptsec) account. Order of preference:
 *   1. the configured passphrase (`--passphrase` dep or FORMSTR_MCP_NCRYPTSEC_PASSPHRASE);
 *   2. if that's missing or wrong AND we have a terminal, prompt (with retries);
 *   3. otherwise throw a verbose, actionable error.
 *
 * `deps.promptPassphrase` is only wired up on an interactive TTY — when an MCP host
 * spawns the server, stdin is the JSON-RPC channel and there's nobody to prompt, so
 * the configured passphrase is required and the errors say exactly how to provide it.
 */
async function unlockNcryptsec(
  signer: Signer,
  account: StoredAccount,
  deps: BootstrapDeps,
): Promise<void> {
  if (!account.ncryptsec) {
    throw new Error(
      `Account ${account.npub} is stored as an ncryptsec but its encrypted key is missing. ` +
        "Re-add it with `formstr-mcp login`.",
    );
  }
  const ncryptsec = account.ncryptsec;
  const tryUnlock = async (passphrase: string): Promise<boolean> => {
    try {
      await signer.loginWithNcryptsec(ncryptsec, passphrase);
      return true;
    } catch {
      return false;
    }
  };

  const configured = deps.passphrase ?? process.env.FORMSTR_MCP_NCRYPTSEC_PASSPHRASE;
  if (configured) {
    if (await tryUnlock(configured)) return;
    if (!deps.promptPassphrase) {
      throw new Error(
        `The configured passphrase did not unlock account ${account.npub} — it is most likely ` +
          "the wrong passphrase for this account (each account has its own). Set " +
          "FORMSTR_MCP_NCRYPTSEC_PASSPHRASE to the passphrase that matches this account, or " +
          "switch to another with `formstr-mcp switch <npub>` (a nip46/bunker account needs no " +
          "passphrase).",
      );
    }
    console.error(
      `formstr-mcp: the configured passphrase didn't unlock ${account.npub} — enter it manually.`,
    );
  } else if (!deps.promptPassphrase) {
    throw new Error(
      `Cannot unlock account ${account.npub} (ncryptsec): no passphrase is available. ` +
        "FORMSTR_MCP_NCRYPTSEC_PASSPHRASE is not set and this process has no interactive terminal " +
        "to prompt on — an MCP host runs the server with stdin wired to the JSON-RPC channel. " +
        "Fix: add FORMSTR_MCP_NCRYPTSEC_PASSPHRASE to your MCP server config's `env`, or switch to " +
        "a nip46/bunker account with `formstr-mcp switch <npub>` (resumes with no passphrase).",
    );
  }

  const promptPassphrase = deps.promptPassphrase!;
  for (let attempt = 1; attempt <= MAX_PASSPHRASE_ATTEMPTS; attempt++) {
    const passphrase = await promptPassphrase(`Passphrase to unlock ${account.npub}: `);
    if (await tryUnlock(passphrase)) return;
    const left = MAX_PASSPHRASE_ATTEMPTS - attempt;
    if (left > 0) console.error(`formstr-mcp: incorrect passphrase, ${left} attempt(s) left.`);
  }
  throw new Error(
    `Incorrect passphrase for account ${account.npub} after ${MAX_PASSPHRASE_ATTEMPTS} attempts.`,
  );
}
