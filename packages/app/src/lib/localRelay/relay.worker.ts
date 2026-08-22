/**
 * The app's relay worker.
 *
 * The stock `@formstr/local-relay/worker` entry stores everything in one
 * database. This app switches accounts, so each gets its own: the namespace
 * arrives as the Worker's `name`, which is the only construction-time argument
 * a Worker takes. A per-account database means switching back is still instant,
 * and logging out can delete one account's cache without touching another's.
 */

import { IndexedDBStorage, RelayService, selfChannel } from "@formstr/local-relay";

import { appPrunePolicy } from "./prunePolicy";

const scope = self as unknown as {
  name?: string;
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

const service = new RelayService({
  channel: selfChannel(scope),
  storage: new IndexedDBStorage(scope.name || "shared"),
  // A silent relay must not hold a publish open: after this the event becomes
  // outbox debt and is retried on reconnect, which is strictly better than the
  // old runtime's fire-and-forget.
  publishTimeoutMs: 5000,
  // Without this the store keeps only what a generic Nostr client would, and
  // sweeps the user's own boards, calendars and forms on a 7-day TTL.
  persistence: { prunePolicy: appPrunePolicy() },
});

void service.start();

export {};
