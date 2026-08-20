import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { querySync: vi.fn(), subscribe: vi.fn(), publish: vi.fn() },
  relayManager: {
    getRelaysForModule: vi.fn(() => ["wss://a.test"]),
    fetchUserRelays: vi.fn(async () => []),
  },
}));

import { signerManager, relayManager } from "@formstr/core";

import { getCalendarSdk, getInvitationInboxSdk, resetCalendarSdk } from "./sdk";

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
  (relayManager.fetchUserRelays as any).mockResolvedValue([]);
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

  it("exposes the calendar relay set it was built with", async () => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
    const sdk = await getCalendarSdk();
    expect(sdk.relays).toEqual(["wss://a.test"]);
  });

  it("throws when the signer object omits the NIP-44 methods", async () => {
    (signerManager.getSigner as any).mockResolvedValue({
      getPublicKey: vi.fn().mockResolvedValue("alice"),
      signEvent: vi.fn(),
    });
    await expect(getCalendarSdk()).rejects.toThrow(/NIP-44/);
  });
});

describe("getInvitationInboxSdk", () => {
  beforeEach(() => {
    (signerManager.getSigner as any).mockResolvedValue(signer("alice"));
  });

  it("unions the module relays with the user's NIP-65 read relays", async () => {
    // Senders publish each gift wrap to the recipient's own relays, so an inbox
    // limited to the module set never sees invitations from other clients.
    (relayManager.fetchUserRelays as any).mockResolvedValue([
      { url: "wss://me.inbox", read: true, write: true },
      { url: "wss://me.outbox", read: false, write: true },
    ]);
    const sdk = await getInvitationInboxSdk();
    expect([...sdk.relays]).toEqual(["wss://a.test", "wss://me.inbox"]);
  });

  it("falls back to the module relays when the relay list cannot be read", async () => {
    (relayManager.fetchUserRelays as any).mockRejectedValue(new Error("relay down"));
    expect([...(await getInvitationInboxSdk()).relays]).toEqual(["wss://a.test"]);
  });

  it("reuses one instance for the same account and relay set", async () => {
    expect(await getInvitationInboxSdk()).toBe(await getInvitationInboxSdk());
  });

  it("is a different instance from the module-relay SDK", async () => {
    (relayManager.fetchUserRelays as any).mockResolvedValue([
      { url: "wss://me.inbox", read: true, write: true },
    ]);
    expect(await getInvitationInboxSdk()).not.toBe(await getCalendarSdk());
  });
});
