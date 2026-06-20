import { encryptSecretKey, hexToBytes, type Signer, type StoredAccount } from "@formstr/signer";
import { nip19 } from "nostr-tools";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";

/** Relays used to advertise a `nostrconnect://` pairing when `--relays` isn't given. */
const DEFAULT_NOSTRCONNECT_RELAYS = ["wss://relay.nsec.app"];

/**
 * Permissions requested from a NIP-46 remote signer. Without a perms list many
 * bunker UIs (Amber, etc.) skip the approval prompt entirely. The MCP needs to
 * sign events of any kind and use NIP-04/44 for the modules' encryption.
 */
const NIP46_PERMS = [
  "sign_event",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt",
];

export interface LoginDeps {
  signer: Signer;
  /** Read a line of input (the prompt is shown to the user). */
  prompt: (question: string) => Promise<string>;
  /** Read a line without echoing (passphrases). */
  promptPassphrase: (question: string) => Promise<string>;
  /** Render a NIP-46 URI (terminal QR + raw URI). */
  printQr: (uri: string) => void;
  /** A WebSocket-patched pool — required for every NIP-46 call in Node. */
  pool: AbstractSimplePool;
  /** Override relays for the nostrconnect flow (from `--relays`). */
  relays?: string[];
  /** Status/output sink (defaults to console.error). */
  log?: (message: string) => void;
}

/**
 * Run the terminal-interactive login over `@formstr/signer` and persist the result
 * to the keystore (the signer's storage adapter does that). Returns the now-active
 * account. Methods: create (new ncryptsec), import (nsec/hex/ncryptsec), bunker URI,
 * and nostrconnect QR.
 */
export async function doLogin(deps: LoginDeps): Promise<StoredAccount> {
  const log = deps.log ?? ((m: string) => console.error(m));
  const choice = (
    await deps.prompt("Sign-in method — [c]reate, [i]mport, [b]unker URI, [q]r (nostrconnect): ")
  )
    .trim()
    .toLowerCase()
    .charAt(0);

  switch (choice) {
    case "c":
      await loginCreate(deps, log);
      break;
    case "i":
      await loginImport(deps);
      break;
    case "b":
      await loginBunker(deps);
      break;
    case "q":
      await loginNostrConnect(deps, log);
      break;
    default:
      throw new Error(`Unknown sign-in method: "${choice}". Choose create, import, bunker, or qr.`);
  }

  const account = deps.signer.getActiveAccount();
  if (!account) throw new Error("Login did not produce an active account.");
  return account;
}

async function loginCreate(deps: LoginDeps, log: (m: string) => void): Promise<void> {
  const passphrase = await deps.promptPassphrase("Choose a passphrase to encrypt the new key: ");
  const { npub, ncryptsec } = await deps.signer.createAccount(passphrase);
  log("");
  log(`  Created ${npub}`);
  log("  BACK UP THIS ncryptsec — it is the ONLY way to recover this key:");
  log("");
  log(`    ${ncryptsec}`);
  log("");
}

async function loginImport(deps: LoginDeps): Promise<void> {
  const input = (await deps.prompt("Paste nsec / hex / ncryptsec1…: ")).trim();
  let ncryptsec: string;
  let passphrase: string;
  if (input.startsWith("ncryptsec1")) {
    ncryptsec = input;
    passphrase = await deps.promptPassphrase("Passphrase to unlock this ncryptsec: ");
  } else {
    const secret = input.startsWith("nsec1")
      ? (nip19.decode(input).data as Uint8Array)
      : hexToBytes(input);
    passphrase = await deps.promptPassphrase("Choose a passphrase to encrypt this key: ");
    ncryptsec = encryptSecretKey(secret, passphrase);
  }
  await deps.signer.loginWithNcryptsec(ncryptsec, passphrase);
}

async function loginBunker(deps: LoginDeps): Promise<void> {
  const uri = (await deps.prompt("Paste the bunker:// URI: ")).trim();
  await deps.signer.loginWithBunkerUri(uri, { pool: deps.pool, perms: NIP46_PERMS });
}

async function loginNostrConnect(deps: LoginDeps, log: (m: string) => void): Promise<void> {
  const relays = deps.relays?.length ? deps.relays : DEFAULT_NOSTRCONNECT_RELAYS;
  log("Scan this QR (or copy the URI) with your remote signer to pair:");
  await deps.signer.loginWithNostrConnect({
    relays,
    onUri: deps.printQr,
    pool: deps.pool,
    perms: NIP46_PERMS,
  });
}

/** Remove a stored account (the given pubkey, or the active one). */
export async function doLogout(signer: Signer, pubkey?: string): Promise<void> {
  await signer.logout(pubkey);
}

/** The active identity, if any. */
export function whoami(signer: Signer): StoredAccount | null {
  return signer.getActiveAccount();
}

/** Every persisted account. */
export function listAccounts(signer: Signer): StoredAccount[] {
  return signer.listAccounts();
}

/**
 * Resolve a stored account by either its `npub` or its hex `pubkey`. Returns
 * null when nothing matches. `accounts` shows npubs, so users naturally pass an
 * npub; the signer's switch/select APIs key on the hex pubkey — this bridges both.
 */
export function findAccount(accounts: StoredAccount[], target: string): StoredAccount | null {
  return accounts.find((a) => a.npub === target || a.pubkey === target) ?? null;
}

/**
 * Persist a new active account, selected by npub or hex pubkey. The MCP server
 * (when not pinned with `--account`) boots whichever account is active, so this
 * is how you point it at a different identity. Returns the now-active account.
 */
export async function doSwitch(signer: Signer, target: string): Promise<StoredAccount> {
  const match = findAccount(listAccounts(signer), target);
  if (!match) {
    throw new Error(
      `No stored account matching "${target}". Run \`formstr-mcp accounts\` to list them.`,
    );
  }
  await signer.switchAccount(match.pubkey);
  return match;
}
