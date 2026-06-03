import { NIP46Signer, type Nip46Connection, type NostrSigner } from "@formstr/core";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { BunkerSigner, createNostrConnectURI } from "nostr-tools/nip46";
import {
  SimplePool,
  useWebSocketImplementation as setWebSocketImplementation,
} from "nostr-tools/pool";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import WebSocket from "ws";

import { type Credential } from "./credential";
import { createKeystore } from "./keystore";
import { type Nip46Handshake, runLoginServer } from "./loginServer";

/** Relays used for the NIP-46 handshake when the operator hasn't configured their own. */
const DEFAULT_NIP46_RELAYS = ["wss://relay.nsec.app"];

let wsInstalled = false;
function installWebSocket(): void {
  if (wsInstalled) return;
  setWebSocketImplementation(WebSocket);
  wsInstalled = true;
}

/** Run the interactive login flow and persist the chosen credential to the keystore. */
export async function doLogin(relays?: string[]): Promise<Credential> {
  installWebSocket();
  const keystore = createKeystore();
  const cred = await runLoginServer({ nip46: makeNip46Handshake(relays) });
  await keystore.set(cred, true);
  return cred;
}

/** Remove a stored credential (the given pubkey, or the active default). */
export async function doLogout(pubkey?: string): Promise<void> {
  const keystore = createKeystore();
  if (pubkey) {
    await keystore.remove(pubkey);
    return;
  }
  const current = await keystore.get();
  if (current) await keystore.remove(current.pubkey);
}

/** The active identity, if any. */
export async function whoami(): Promise<{ pubkey: string; method: Credential["method"] } | null> {
  const cred = await createKeystore().get();
  return cred ? { pubkey: cred.pubkey, method: cred.method } : null;
}

/**
 * Build a connected NIP-46 signer from a persisted session. Passed to
 * `signerManager.loginWithNip46` at bootstrap. The user's key never enters this process —
 * only the ephemeral client key is local.
 */
export async function buildNip46Signer(conn: Nip46Connection): Promise<NostrSigner> {
  installWebSocket();
  const pool = new SimplePool();
  patchPoolWebSocket(pool);
  const pointer = {
    pubkey: conn.remoteSignerPubkey,
    relays: conn.relays,
    secret: conn.secret ?? null,
  };
  const bunker = BunkerSigner.fromBunker(hexToBytes(conn.clientSecretKey), pointer, { pool });
  await bunker.connect();
  return new NIP46Signer(bunker);
}

/** Construct the handshake the login server drives (nostrconnect:// → connected credential). */
function makeNip46Handshake(relays?: string[]): Nip46Handshake {
  const connectRelays = relays?.length ? relays : DEFAULT_NIP46_RELAYS;
  return {
    async start() {
      const clientSk = generateSecretKey();
      const secret = bytesToHex(generateSecretKey()).slice(0, 32);
      const uri = createNostrConnectURI({
        clientPubkey: getPublicKey(clientSk),
        relays: connectRelays,
        secret,
        name: "Formstr MCP",
      });
      const pool = new SimplePool();
      patchPoolWebSocket(pool);

      const connected = (async (): Promise<Credential> => {
        const bunker = await BunkerSigner.fromURI(clientSk, uri, { pool });
        const userPubkey = await bunker.getPublicKey();
        // BunkerSigner stores the resolved bunker pointer on `.bp`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bp = (bunker as any).bp as { pubkey: string; relays?: string[]; secret?: string };
        return {
          method: "nip46",
          pubkey: userPubkey,
          clientSecretKey: bytesToHex(clientSk),
          remoteSignerPubkey: bp.pubkey,
          relays: bp.relays?.length ? bp.relays : connectRelays,
          secret: bp.secret ?? secret,
        };
      })();

      return { uri, connected };
    },
  };
}

/** Single-file bundles bind a different `_WebSocket` than `useWebSocketImplementation`
 *  writes to; patch the pool instance directly so Node relay connections work. */
function patchPoolWebSocket(pool: SimplePool): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any)._WebSocket = WebSocket;
}
