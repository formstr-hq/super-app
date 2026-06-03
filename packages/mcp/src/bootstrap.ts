import { relayManager, signerManager, nostrRuntime } from "@formstr/core";
import { useWebSocketImplementation as setWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

import { type Credential } from "./auth/credential";
import { buildNip46Signer } from "./auth/login";

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
  credential: Credential;
  relays?: string[];
}

export async function bootstrap(input: BootstrapInput): Promise<void> {
  installLocalStorageShim();
  setWebSocketImplementation(WebSocket);
  // When bundled into a single CJS file, nostr-tools/pool's module-level _WebSocket
  // variable (used by SimplePool's constructor) is a different binding than the one
  // setWebSocketImplementation writes to. Patch the pool instance directly so relay
  // connections work in Node environments that lack a native WebSocket (Node < 22).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nostrRuntime.pool as any)._WebSocket = WebSocket;
  if (input.relays?.length) overrideRelays(input.relays);

  if (input.credential.method === "local") {
    await signerManager.loginWithNsec(input.credential.nsec);
  } else {
    const { clientSecretKey, remoteSignerPubkey, relays, secret } = input.credential;
    await signerManager.loginWithNip46(
      { clientSecretKey, remoteSignerPubkey, relays, secret },
      buildNip46Signer,
    );
  }
}
