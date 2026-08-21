import { dbNameFor } from "@formstr/local-relay";
import { describe, it, expect, vi } from "vitest";

import { purgeAccountCache } from "./purge";

const ME = "a".repeat(64);

describe("purgeAccountCache", () => {
  it("deletes the database belonging to that account alone", () => {
    const deleteDatabase = vi.fn();

    purgeAccountCache(ME, { deleteDatabase } as unknown as IDBFactory);

    expect(deleteDatabase).toHaveBeenCalledWith(dbNameFor(ME));
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
  });

  it("does nothing where IndexedDB is unavailable", () => {
    // Private-mode browsers and the test environment both lack it; sign-out
    // must not throw on the way through.
    expect(() => purgeAccountCache(ME, undefined)).not.toThrow();
  });
});
