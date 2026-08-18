import { describe, it, expect, vi, beforeEach } from "vitest";

const sdk = vi.hoisted(() => ({
  relays: ["wss://relay.test"],
  fetchInvitationsWithEvents: vi.fn(async () => []),
  subscribeToInvitations: vi.fn((_pubkey: string, _cb: (w: unknown) => void) => ({
    unsub: vi.fn(),
  })),
  dismissInvitation: vi.fn(async () => undefined),
  fetchEventByCoordinate: vi.fn(async () => null),
}));

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { subscribe: vi.fn(), querySync: vi.fn(), publish: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
}));

vi.mock("../lib/calendar/sdk", () => ({
  getCalendarSdk: vi.fn(async () => sdk),
  toCalendarSigner: vi.fn((s: unknown) => s),
}));

vi.mock("../lib/calendar/legacyInvitations", () => ({
  subscribeToLegacyInvitations: vi.fn(() => ({ unsub: vi.fn() })),
}));

const unwrapEvent = vi.hoisted(() => vi.fn());
const parseInvitationRumor = vi.hoisted(() => vi.fn());
vi.mock("@formstr/calendar-sdk", () => ({ unwrapEvent, parseInvitationRumor }));

import { signerManager } from "@formstr/core";

import { subscribeToLegacyInvitations } from "../lib/calendar/legacyInvitations";

import { useCalendarStore } from "./calendarStore";
import { useInvitationsStore } from "./invitationsStore";

function invitation(over: Partial<any> = {}) {
  return {
    giftWrapId: "w1",
    senderPubkey: "author",
    recipientPubkey: "me",
    eventId: "abc12345",
    kind: 32678,
    authorPubkey: "author",
    coordinate: "32678:author:abc12345",
    viewKey: "nsec1k",
    relayHint: "wss://relay.test",
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useInvitationsStore.setState({
    invitations: [],
    isSubscribing: false,
    subscription: null,
    legacySubscription: null,
  });
  (signerManager.getSigner as any).mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue("me"),
  });
  sdk.fetchInvitationsWithEvents.mockResolvedValue([]);
  sdk.subscribeToInvitations.mockReturnValue({ unsub: vi.fn() });
  (subscribeToLegacyInvitations as any).mockReturnValue({ unsub: vi.fn() });
});

describe("invitationsStore.start", () => {
  it("seeds from the one-shot query, which is what honours kind-5 dismissals", async () => {
    sdk.fetchInvitationsWithEvents.mockResolvedValue([
      { ...invitation(), event: { id: "abc12345", title: "Party" } },
    ] as any);
    const ingestSpy = vi
      .spyOn(useCalendarStore.getState(), "ingestEvent")
      .mockImplementation(() => {});

    await useInvitationsStore.getState().start();

    expect(useInvitationsStore.getState().invitations).toHaveLength(1);
    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc12345", isInvitation: true }),
    );
  });

  it("opens both the current and the legacy 1052 subscription", async () => {
    await useInvitationsStore.getState().start();
    expect(sdk.subscribeToInvitations).toHaveBeenCalledWith("me", expect.any(Function));
    // Wraps written by older super-app builds are bare kind 1052 and the SDK's
    // inbox filter never sees them.
    expect(subscribeToLegacyInvitations).toHaveBeenCalledWith(
      "me",
      ["wss://relay.test"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("does not list the same invitation twice when both paths deliver it", async () => {
    sdk.fetchInvitationsWithEvents.mockResolvedValue([{ ...invitation(), event: null }] as any);
    await useInvitationsStore.getState().start();

    // Replay the same wrap through the legacy path.
    const onLegacy = (subscribeToLegacyInvitations as any).mock.calls[0][3];
    onLegacy(invitation());
    await new Promise((r) => setTimeout(r, 0));

    expect(useInvitationsStore.getState().invitations).toHaveLength(1);
  });

  it("decodes an arriving wrap directly instead of re-querying the inbox", async () => {
    // A relay's `limit` applies to its own ordering, so re-querying to find the
    // wrap that just arrived can silently return a different one.
    unwrapEvent.mockResolvedValue({ kind: 14, pubkey: "author", tags: [], content: "" });
    parseInvitationRumor.mockReturnValue(invitation({ giftWrapId: "w-live" }));

    let onWrap: ((w: unknown) => void) | undefined;
    sdk.subscribeToInvitations.mockImplementation((_pubkey: string, cb: (w: unknown) => void) => {
      onWrap = cb;
      return { unsub: vi.fn() };
    });
    await useInvitationsStore.getState().start();

    onWrap!({ id: "w-live", kind: 1059 });
    await vi.waitFor(() => expect(useInvitationsStore.getState().invitations).toHaveLength(1));
    expect(sdk.fetchInvitationsWithEvents).toHaveBeenCalledTimes(1); // the seed only
    expect(parseInvitationRumor).toHaveBeenCalledWith(expect.anything(), "w-live");
  });

  it("is a no-op when already subscribed", async () => {
    await useInvitationsStore.getState().start();
    sdk.subscribeToInvitations.mockClear();
    await useInvitationsStore.getState().start();
    expect(sdk.subscribeToInvitations).not.toHaveBeenCalled();
  });
});

describe("invitationsStore mutations", () => {
  it("dismiss records the opt-out through the SDK and drops the entry", async () => {
    sdk.fetchInvitationsWithEvents.mockResolvedValue([{ ...invitation(), event: null }] as any);
    await useInvitationsStore.getState().start();

    useInvitationsStore.getState().dismiss("w1");
    await new Promise((r) => setTimeout(r, 0));

    expect(sdk.dismissInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ giftWrapId: "w1" }),
    );
    expect(useInvitationsStore.getState().invitations).toHaveLength(0);
  });

  it("markRsvp sets status; stop unsubscribes both subscriptions", async () => {
    const unsub = vi.fn();
    const legacyUnsub = vi.fn();
    sdk.subscribeToInvitations.mockReturnValue({ unsub });
    (subscribeToLegacyInvitations as any).mockReturnValue({ unsub: legacyUnsub });
    sdk.fetchInvitationsWithEvents.mockResolvedValue([{ ...invitation(), event: null }] as any);

    await useInvitationsStore.getState().start();
    useInvitationsStore.getState().markRsvp("32678:author:abc12345", "accepted");
    expect(useInvitationsStore.getState().invitations[0].rsvp).toBe("accepted");
    expect(useInvitationsStore.getState().hasPending()).toBe(false);

    useInvitationsStore.getState().stop();
    expect(unsub).toHaveBeenCalled();
    expect(legacyUnsub).toHaveBeenCalled();
    expect(useInvitationsStore.getState().invitations).toHaveLength(0);
  });
});
