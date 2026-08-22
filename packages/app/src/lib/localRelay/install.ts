import { relayManager, resetNostrRuntime, setNostrRuntime } from "@formstr/core";
import type { DataLayer } from "@formstr/local-relay";

import { setRelayHealthReader } from "../relayHealth";

import { LocalRelayRuntime } from "./LocalRelayRuntime";
import { WarmupRegistry } from "./warmup";

const KILL_SWITCH_KEY = "formstr.localRelay";

/**
 * Should the app run on the local relay?
 *
 * A dev-facing escape hatch while the substrate proves itself against live
 * relays: `localStorage.setItem("formstr.localRelay", "off")` puts the app back
 * on the SimplePool runtime for one reload, with nothing else to change. Delete
 * this once live verification passes.
 */
export function isLocalRelayEnabled(): boolean {
  try {
    return localStorage.getItem(KILL_SWITCH_KEY) !== "off";
  } catch {
    // Private-mode browsers throw on storage access. Default to on.
    return true;
  }
}

/**
 * Point the app's runtime at the local relay for one account.
 *
 * Returns the teardown: it drops the standing interests, restores the SimplePool
 * runtime, and stops listening for visibility changes. The worker and data layer
 * outlive this — whoever spawned them tears them down — so an account switch is
 * a teardown plus a fresh install.
 */
export function installRuntime(dataLayer: DataLayer, pubkey: string): () => void {
  // Routing policy, not a command: the worker folds these into how it reaches
  // relays for reads, publishes and outbox retries. Seeded with what is known
  // now and updated when the user's NIP-65 list arrives, because that resolves
  // after login and a worker never told would route on defaults all session.
  dataLayer.setUserRelays(relayManager.getAllRelays());
  void relayManager
    .fetchUserRelays(pubkey)
    .then(() => dataLayer.setUserRelays(relayManager.getAllRelays()))
    .catch(() => {
      // No list published, or no relay answered. The defaults still stand.
    });

  const warmup = new WarmupRegistry(dataLayer);
  warmup.start(pubkey);

  const runtime = new LocalRelayRuntime(dataLayer, {
    isWarm: (filter) => warmup.covers(filter),
  });
  setNostrRuntime(runtime);

  // The header's relay indicator reads whichever backend owns the sockets. Under
  // the local relay that is the worker, and the SimplePool it would otherwise
  // poll never connects to anything.
  setRelayHealthReader(async () => {
    const health = await dataLayer.relayHealth();
    return new Map(health.map((r) => [r.relay, r.connected]));
  });

  // Lifecycle hints, not commands: the worker decides what to close and reopen.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") dataLayer.pause();
    else dataLayer.resume();
  };
  document.addEventListener("visibilitychange", onVisibility);
  // `visibilitychange` does not fire on every path out of a page — a bfcache
  // navigation or a closing tab goes straight to `pagehide`, leaving sockets
  // open behind a page nobody is looking at.
  const onPageHide = () => dataLayer.pause();
  window.addEventListener("pagehide", onPageHide);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    setRelayHealthReader(null);
    warmup.stop();
    runtime.dispose();
    resetNostrRuntime();
  };
}
