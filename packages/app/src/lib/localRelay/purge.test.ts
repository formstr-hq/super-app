import { describe, it, expect, vi } from "vitest";

import { purgeAccountCache } from "./purge";

const ME = "a".repeat(64);

describe("purgeAccountCache", () => {
  it("destroys the store belonging to that account alone", async () => {
    const destroy = vi.fn(async () => {});
    const namespaces: string[] = [];
    const makeStorage = (namespace: string) => {
      namespaces.push(namespace);
      return { destroy };
    };

    await purgeAccountCache(ME, makeStorage);

    // The namespace IS the pubkey, so no other account's database is touched.
    expect(namespaces).toEqual([ME]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not throw where the store cannot be opened", async () => {
    // Private-mode browsers and the test environment both lack IndexedDB;
    // signing out must not fail on the way through.
    const makeStorage = () => ({
      destroy: async () => {
        throw new Error("no indexedDB");
      },
    });

    await expect(purgeAccountCache(ME, makeStorage)).resolves.toBeUndefined();
  });
});
