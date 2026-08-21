import { dbNameFor } from "@formstr/local-relay";

/**
 * Delete one account's cached events.
 *
 * Signing out should not leave the next person at this browser able to read
 * which boards, forms and calendars the last one was looking at. The contents
 * are public or encrypted either way, but the shape of someone's data is itself
 * worth clearing.
 *
 * Only this account's database: another signed-in account keeps its cache, so
 * switching back to it is still instant.
 */
export function purgeAccountCache(
  pubkey: string,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): void {
  try {
    factory?.deleteDatabase(dbNameFor(pubkey));
  } catch {
    // A browser that refuses storage access has nothing to purge.
  }
}
