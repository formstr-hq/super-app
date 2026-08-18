import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { querySync: vi.fn(), subscribe: vi.fn(), publish: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

import { signerManager, relayManager } from "@formstr/core";

import { getCalendarSdk, resetCalendarSdk } from "./sdk";

function signer(pubkey: string) {
  return {
    getPublicKey: vi.fn().mockResolvedValue(pubkey),
    signEvent: vi.fn(),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCalendarSdk();
  (relayManager.getRelaysForModule as any).mockReturnValue(["wss://a.test"]);
});

describe("getCalendarSdk", () => {
  it("reuses one instance for the same pubkey and relay set", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    expect(await getCalendarSdk()).toBe(await getCalendarSdk());
  });

  it("rebuilds when the signed-in pubkey changes", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    const first = await getCalendarSdk();
    (signerManager.getSigner as any).mockResolvedValue(signer("bob"));
    expect(await getCalendarSdk()).not.toBe(first);
  });

  it("rebuilds when the relay set changes", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    const first = await getCalendarSdk();
    (relayManager.getRelaysForModule as any).mockReturnValue(["wss://b.test"]);
    expect(await getCalendarSdk()).not.toBe(first);
  });

  it("rebuilds when the same account's signer object is replaced", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    const first = await getCalendarSdk();
    (signerManager.getSigner as any).mockResolvedValue(signer("alice")); // new object, same pubkey
    expect(await getCalendarSdk()).not.toBe(first);
  });

  it("asks for the calendar relay set", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    await getCalendarSdk();
    expect(relayManager.getRelaysForModule).toHaveBeenCalledWith("calendar");
  });

  it("throws when the signer object omits the NIP-44 methods", async () => {
    (signerManager.getSigner as any).mockResolvedValue({
      getPublicKey: vi.fn().mockResolvedValue("alice"),
      signEvent: vi.fn(),
    });
    await expect(getCalendarSdk()).rejects.toThrow(/NIP-44/);
  });
});
