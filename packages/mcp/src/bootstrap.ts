import { relayManager, signerManager } from "@formstr/core";
import { useWebSocketImplementation as setWebSocketImplementation } from "nostr-tools/pool";
import WebSocket from "ws";

import type { ResolvedConfig } from "./config";

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

export async function bootstrap(cfg: Pick<ResolvedConfig, "nsec" | "relays">): Promise<void> {
  installLocalStorageShim();
  setWebSocketImplementation(WebSocket);
  if (cfg.relays?.length) overrideRelays(cfg.relays);
  await signerManager.loginWithNsec(cfg.nsec);
}
