import {
  signerManager,
  nostrRuntime,
  nip44SelfDecrypt,
  wrapEvent,
  unwrapEvent,
} from "@formstr/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), querySync: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  nip44SelfDecrypt: vi.fn(),
  wrapEvent: vi.fn(),
  unwrapEvent: vi.fn(),
}));

vi.mock("./service", () => ({
  publishPrivateCalendarEvent: vi.fn(),
  addEventToCalendarList: vi.fn(),
}));

vi.mock("./viewKey", () => ({ decryptWithViewKey: vi.fn() }));

import {
  approveBookingRequest,
  bookingLinkUrl,
  declineBookingRequest,
  fetchBookingRequests,
  fetchSchedulingPages,
  type BookingRequest,
} from "./booking";
import { publishPrivateCalendarEvent, addEventToCalendarList } from "./service";
import type { CalendarList } from "./types";
import { decryptWithViewKey } from "./viewKey";

const mockSigner = { getPublicKey: vi.fn().mockResolvedValue("host") };

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
});

describe("fetchSchedulingPages", () => {
  it("decrypts pages via the 32680 viewKey index", async () => {
    (nostrRuntime.querySync as any).mockImplementation((_r: unknown, filter: any) => {
      if (filter.kinds[0] === 32680) {
        return Promise.resolve([
          { id: "k1", pubkey: "host", content: "enc-key", tags: [["d", "p1"]] },
        ]);
      }
      // 31927 page
      return Promise.resolve([
        { id: "ev1", pubkey: "host", content: "enc-page", created_at: 10, tags: [["d", "p1"]] },
      ]);
    });
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify({ viewKey: "nsec1abc", dTag: "p1" }),
    );
    (decryptWithViewKey as any).mockResolvedValue(
      JSON.stringify([
        ["title", "Intro call"],
        ["description", "30m"],
      ]),
    );

    const pages = await fetchSchedulingPages();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ id: "p1", title: "Intro call", viewKey: "nsec1abc" });
  });

  it("skips pages whose viewKey is unknown", async () => {
    (nostrRuntime.querySync as any).mockImplementation((_r: unknown, filter: any) =>
      filter.kinds[0] === 32680
        ? Promise.resolve([]) // no key index
        : Promise.resolve([
            { id: "ev1", pubkey: "host", content: "enc", created_at: 1, tags: [["d", "p1"]] },
          ]),
    );
    expect(await fetchSchedulingPages()).toEqual([]);
  });
});

describe("bookingLinkUrl", () => {
  it("builds a calendar.formstr.app /schedule/<naddr> link", () => {
    const url = bookingLinkUrl({
      id: "p1",
      eventId: "e",
      user: "0".repeat(64),
      title: "X",
      description: "",
      createdAt: 0,
    });
    expect(url).toMatch(/^https:\/\/calendar\.formstr\.app\/schedule\/naddr1/);
  });
});

describe("fetchBookingRequests", () => {
  it("unwraps gift wraps into booking requests", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([{ id: "w1", created_at: 5 }]);
    (unwrapEvent as any).mockResolvedValue({
      kind: 57,
      pubkey: "booker",
      content: "",
      tags: [
        ["a", "31927:host:p1"],
        ["start", "100"],
        ["end", "200"],
        ["title", "Coffee"],
        ["d", "appt1"],
        ["viewKey", "nsec1view"],
      ],
    });
    const requests = await fetchBookingRequests();
    expect(requests[0]).toMatchObject({
      id: "w1",
      schedulingPageRef: "31927:host:p1",
      bookerPubkey: "booker",
      start: 100000,
      end: 200000,
      title: "Coffee",
      dTag: "appt1",
      viewKey: "nsec1view",
      status: "pending",
    });
  });

  it("drops wraps that are not booking-request rumors", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([{ id: "w1", created_at: 5 }]);
    (unwrapEvent as any).mockResolvedValue({ kind: 9, pubkey: "x", tags: [] });
    expect(await fetchBookingRequests()).toEqual([]);
  });
});

const calendar: CalendarList = {
  id: "c1",
  eventId: "e1",
  title: "Work",
  description: "",
  color: "#000",
  eventRefs: [],
  createdAt: 0,
  isVisible: true,
};

const request: BookingRequest = {
  id: "r1",
  giftWrapId: "r1",
  schedulingPageRef: "31927:host:p1",
  bookerPubkey: "booker",
  start: 100000,
  end: 200000,
  title: "Coffee",
  note: "hi",
  dTag: "appt1",
  viewKey: "nsec1view",
  receivedAt: 0,
  status: "pending",
};

describe("approveBookingRequest", () => {
  it("publishes the appointment with the booker's d-tag + viewKey and notifies the booker", async () => {
    (publishPrivateCalendarEvent as any).mockResolvedValue({
      id: "appt1",
      eventId: "ev",
      kind: 32678,
      user: "host",
      viewKey: "nsec1view",
    });
    (addEventToCalendarList as any).mockResolvedValue({
      ...calendar,
      eventRefs: [["32678:host:appt1", "", "nsec1view"]],
    });
    (wrapEvent as any).mockResolvedValue({ id: "wrap" });

    const result = await approveBookingRequest(request, calendar);

    expect(publishPrivateCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: "appt1",
        viewKey: "nsec1view",
        participants: ["booker"],
      }),
      "c1",
    );
    expect(addEventToCalendarList).toHaveBeenCalled();
    // The approval response gift wrap is published.
    expect(wrapEvent).toHaveBeenCalled();
    expect(nostrRuntime.publish).toHaveBeenCalled();
    expect(result.event.id).toBe("appt1");
  });
});

describe("declineBookingRequest", () => {
  it("sends a declined response with the reason", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap" });
    await declineBookingRequest(request, "unavailable");
    const rumor = (wrapEvent as any).mock.calls[0][0];
    expect(rumor.tags).toEqual(
      expect.arrayContaining([
        ["status", "declined"],
        ["reason", "unavailable"],
      ]),
    );
    expect(nostrRuntime.publish).toHaveBeenCalled();
  });
});
