import { IndexedDBStorage } from "@formstr/local-relay";

/** Just enough of the storage adapter to delete it. */
interface Destroyable {
  destroy(): Promise<void>;
}

/**
 * Delete one account's cached events.
 *
 * Signing out should not leave the next person at this browser able to read
 * which boards, forms and calendars the last one was looking at. The contents
 * are public or encrypted either way, but the shape of someone's data is itself
 * worth clearing.
 *
 * Only this account's database — the namespace is the pubkey — so another
 * signed-in account keeps its cache and switching back to it is still instant.
 * Call it after the worker is terminated: a database with an open connection
 * will not delete until that connection closes.
 */
export async function purgeAccountCache(
  pubkey: string,
  makeStorage: (namespace: string) => Destroyable = (namespace) => new IndexedDBStorage(namespace),
): Promise<void> {
  try {
    await makeStorage(pubkey).destroy();
  } catch {
    // A browser that refuses storage access has nothing to purge.
  }
}
