import { describe, it, expect, vi, beforeEach } from "vitest";

const subscribe = vi.hoisted(() => vi.fn());
const unwrapEvent = vi.hoisted(() => vi.fn());
const parseInvitationRumor = vi.hoisted(() => vi.fn());

vi.mock("@formstr/core", () => ({
  nostrRuntime: { subscribe },
  signerManager: { getSigner: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://a.test"]) },
}));

vi.mock("@formstr/calendar-sdk", () => ({ unwrapEvent, parseInvitationRumor }));

import { subscribeToLegacyInvitations } from "./legacyInvitations";

const signer = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  subscribe.mockReturnValue({ unsub: vi.fn() });
});

describe("subscribeToLegacyInvitations", () => {
  it("subscribes to bare kind-1052 wraps addressed to the user", () => {
    subscribeToLegacyInvitations("me", ["wss://a.test"], signer, vi.fn());
    expect(subscribe).toHaveBeenCalledWith(
      ["wss://a.test"],
      [{ kinds: [1052], "#p": ["me"] }],
      expect.anything(),
    );
  });

  it("emits an invitation parsed from a legacy wrap", async () => {
    const onInvitation = vi.fn();
    unwrapEvent.mockResolvedValue({ kind: 52, pubkey: "alice", tags: [], content: "" });
    parseInvitationRumor.mockReturnValue({ giftWrapId: "w1", coordinate: "32678:alice:d1" });

    subscribeToLegacyInvitations("me", ["wss://a.test"], signer, onInvitation);
    subscribe.mock.calls[0][2].onEvent({ id: "w1", kind: 1052 });
    await vi.waitFor(() =>
      expect(onInvitation).toHaveBeenCalledWith(expect.objectContaining({ giftWrapId: "w1" })),
    );
    // The wrap's own id is what identifies the invitation, not the rumor's.
    expect(parseInvitationRumor).toHaveBeenCalledWith(expect.anything(), "w1");
  });

  it("swallows a wrap that fails NIP-59 verification", async () => {
    const onInvitation = vi.fn();
    unwrapEvent.mockRejectedValue(new Error("seal signature invalid"));

    subscribeToLegacyInvitations("me", ["wss://a.test"], signer, onInvitation);
    subscribe.mock.calls[0][2].onEvent({ id: "bad", kind: 1052 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onInvitation).not.toHaveBeenCalled();
  });

  it("ignores a wrap whose rumor is not an invitation", async () => {
    const onInvitation = vi.fn();
    unwrapEvent.mockResolvedValue({ kind: 14, pubkey: "alice", tags: [], content: "hi" });
    parseInvitationRumor.mockReturnValue(null);

    subscribeToLegacyInvitations("me", ["wss://a.test"], signer, onInvitation);
    subscribe.mock.calls[0][2].onEvent({ id: "chat", kind: 1052 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onInvitation).not.toHaveBeenCalled();
  });
});
