import { signerManager, nostrRuntime } from "@formstr/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { subscribe: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
}));
vi.mock("@formstr/agent/services/calendar/rsvp", () => ({ extractInvitationFromWrap: vi.fn() }));
vi.mock("@formstr/agent/services/calendar/service", () => ({
  fetchCalendarEventByCoordinate: vi.fn(),
  getInvitationInboxRelays: vi.fn(),
  fetchParticipantRemovals: vi.fn(),
  publishParticipantRemovalEvent: vi.fn(),
}));

import { extractInvitationFromWrap } from "@formstr/agent/services/calendar/rsvp";
import { CALENDAR_KINDS } from "@formstr/agent/services/calendar/types";
import {
  fetchCalendarEventByCoordinate,
  getInvitationInboxRelays,
  fetchParticipantRemovals,
  publishParticipantRemovalEvent,
} from "@formstr/agent/services/calendar/service";

import { useCalendarStore } from "./calendarStore";
import { useInvitationsStore } from "./invitationsStore";

const handle = { unsub: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  useInvitationsStore.setState({ invitations: [], isSubscribing: false, subscription: null });
  (signerManager.getSigner as any).mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue("me"),
  });
  (getInvitationInboxRelays as any).mockResolvedValue(["wss://relay.test", "wss://me.inbox"]);
  (fetchParticipantRemovals as any).mockResolvedValue({
    ids: new Set<string>(),
    coordinates: new Set<string>(),
  });
  (publishParticipantRemovalEvent as any).mockResolvedValue(undefined);
});

describe("invitationsStore.start", () => {
  it("subscribes to gift-wrap kinds and ingests resolved invitation events (deduped)", async () => {
    let onEvent: ((w: any) => void) | undefined;
    (nostrRuntime.subscribe as any).mockImplementation((_r: any, _f: any, opts: any) => {
      onEvent = opts.onEvent;
      return handle;
    });
    (extractInvitationFromWrap as any).mockResolvedValue({
      eventCoordinate: "31923:author:abc12345",
      authorPubkey: "author",
      kind: 31923,
      wrapId: "w1",
      receivedAt: 1,
    });
    (fetchCalendarEventByCoordinate as any).mockResolvedValue({ id: "abc12345", title: "Party" });
    const ingestSpy = vi
      .spyOn(useCalendarStore.getState(), "ingestEvent")
      .mockImplementation(() => {});

    await useInvitationsStore.getState().start();
    expect(nostrRuntime.subscribe).toHaveBeenCalled();

    await onEvent!({ id: "w1" });
    await onEvent!({ id: "w1" }); // duplicate wrap
    await new Promise((r) => setTimeout(r, 0));

    expect(ingestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc12345", isInvitation: true }),
    );
    expect(useInvitationsStore.getState().invitations).toHaveLength(1);
  });
});

describe("invitationsStore — NIP-65 inbox + kind-84 opt-outs", () => {
  it("subscribes on the invitation inbox relays (module ∪ user NIP-65)", async () => {
    let subscribedRelays: string[] | undefined;
    (nostrRuntime.subscribe as any).mockImplementation((relays: string[]) => {
      subscribedRelays = relays;
      return handle;
    });
    await useInvitationsStore.getState().start();
    expect(getInvitationInboxRelays).toHaveBeenCalledWith("me");
    expect(subscribedRelays).toContain("wss://me.inbox");
  });

  it("skips wraps the user already opted out of via kind-84", async () => {
    let onEvent: ((w: any) => void) | undefined;
    (nostrRuntime.subscribe as any).mockImplementation((_r: any, _f: any, opts: any) => {
      onEvent = opts.onEvent;
      return handle;
    });
    (fetchParticipantRemovals as any).mockResolvedValue({
      ids: new Set(["w-dismissed"]),
      coordinates: new Set<string>(),
    });
    (extractInvitationFromWrap as any).mockResolvedValue({
      eventCoordinate: "32678:author:abc",
      authorPubkey: "author",
      kind: 32678,
      wrapId: "w-dismissed",
      receivedAt: 1,
    });
    (fetchCalendarEventByCoordinate as any).mockResolvedValue(null);

    await useInvitationsStore.getState().start();
    await onEvent!({ id: "w-dismissed" });
    await new Promise((r) => setTimeout(r, 0));

    expect(useInvitationsStore.getState().invitations).toHaveLength(0);
    expect(extractInvitationFromWrap).not.toHaveBeenCalled();
  });

  it("dismiss publishes a kind-84 removal e-tagging the wrap id", () => {
    useInvitationsStore.setState({
      invitations: [
        { eventCoordinate: "c", authorPubkey: "a", kind: 32678, wrapId: "w1", receivedAt: 0 },
      ],
    });
    useInvitationsStore.getState().dismiss("w1");
    expect(useInvitationsStore.getState().invitations).toHaveLength(0);
    expect(publishParticipantRemovalEvent).toHaveBeenCalledWith({
      kinds: [CALENDAR_KINDS.giftWrap],
      eventIds: ["w1"],
    });
  });
});

describe("invitationsStore mutations", () => {
  it("markRsvp sets status; dismiss removes; stop unsubscribes", () => {
    useInvitationsStore.setState({
      invitations: [
        { eventCoordinate: "c", authorPubkey: "a", kind: 31923, wrapId: "w1", receivedAt: 0 },
      ],
      subscription: handle as any,
    });
    useInvitationsStore.getState().markRsvp("c", "accepted");
    expect(useInvitationsStore.getState().invitations[0].rsvp).toBe("accepted");
    expect(useInvitationsStore.getState().hasPending()).toBe(false);

    useInvitationsStore.getState().stop();
    expect(handle.unsub).toHaveBeenCalled();
    expect(useInvitationsStore.getState().invitations).toHaveLength(0);
  });
});
