import { signerManager, nostrRuntime } from "@formstr/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { subscribe: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
}));
vi.mock("../services/calendar/rsvp", () => ({ extractInvitationFromWrap: vi.fn() }));
vi.mock("../services/calendar/service", () => ({ fetchCalendarEventByCoordinate: vi.fn() }));

import { extractInvitationFromWrap } from "../services/calendar/rsvp";
import { fetchCalendarEventByCoordinate } from "../services/calendar/service";

import { useCalendarStore } from "./calendarStore";
import { useInvitationsStore } from "./invitationsStore";

const handle = { unsub: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  useInvitationsStore.setState({ invitations: [], isSubscribing: false, subscription: null });
  (signerManager.getSigner as any).mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue("me"),
  });
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
