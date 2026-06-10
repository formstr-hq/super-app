import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

import { readLegacySession, clearLegacySession, legacyNeedsMigration } from "./legacySession";

describe("legacySession", () => {
  beforeEach(() => localStorage.clear());

  it("readLegacySession returns null when nothing is stored", () => {
    expect(readLegacySession()).toBeNull();
  });

  it("readLegacySession reads method/pubkey/secret", () => {
    localStorage.setItem("formstr:signer-method", "guest");
    localStorage.setItem("formstr:pubkey", "pk1");
    localStorage.setItem("formstr:client-secret", "deadbeef");
    expect(readLegacySession()).toEqual({
      method: "guest",
      pubkey: "pk1",
      secretHex: "deadbeef",
    });
  });

  it("legacyNeedsMigration is true only for local/guest with a stored secret", () => {
    expect(legacyNeedsMigration({ method: "guest", pubkey: "p", secretHex: "ab" })).toBe(true);
    expect(legacyNeedsMigration({ method: "local", pubkey: "p", secretHex: "ab" })).toBe(true);
    expect(legacyNeedsMigration({ method: "nip07", pubkey: "p", secretHex: null })).toBe(false);
    expect(legacyNeedsMigration({ method: "guest", pubkey: "p", secretHex: null })).toBe(false);
    expect(legacyNeedsMigration(null)).toBe(false);
  });

  it("clearLegacySession removes all three keys", () => {
    localStorage.setItem("formstr:signer-method", "guest");
    localStorage.setItem("formstr:pubkey", "pk1");
    localStorage.setItem("formstr:client-secret", "deadbeef");
    clearLegacySession();
    expect(localStorage.getItem("formstr:signer-method")).toBeNull();
    expect(localStorage.getItem("formstr:pubkey")).toBeNull();
    expect(localStorage.getItem("formstr:client-secret")).toBeNull();
  });
});
