import { signerManager, nostrRuntime, wrapEvent, unwrapEvent } from "@formstr/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), querySync: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  wrapEvent: vi.fn(),
  unwrapEvent: vi.fn(),
}));

import { rsvpToEvent, fetchRsvpsForEvent, extractInvitationFromWrap } from "./rsvp";
import { CALENDAR_KINDS } from "./types";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("me"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) => Promise.resolve({ ...e, id: "eid", sig: "s", pubkey: "me" })),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
});

describe("rsvpToEvent", () => {
  it("publishes a public RSVP with status + coordinate", async () => {
    await rsvpToEvent("31923:author:abc12345", "accepted", false);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(CALENDAR_KINDS.publicRsvp);
    expect(e.tags).toContainEqual(["a", "31923:author:abc12345"]);
    expect(e.tags).toContainEqual(["status", "accepted"]);
  });

  it("throws on a malformed coordinate", async () => {
    await expect(rsvpToEvent("bad", "accepted")).rejects.toThrow();
  });

  it("wraps a private RSVP and publishes a gift-wrap", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap1", kind: CALENDAR_KINDS.rsvpGiftWrap });
    await rsvpToEvent("31923:author:abc12345", "declined", true);
    expect(wrapEvent).toHaveBeenCalledTimes(1);
    expect((nostrRuntime.publish as any).mock.calls[0][1]).toMatchObject({
      kind: CALENDAR_KINDS.rsvpGiftWrap,
    });
  });
});

describe("rsvpToEvent wire format (suggested time + note)", () => {
  it("adds start/end tags and puts the comment in content (public)", async () => {
    await rsvpToEvent("31923:author:abc12345", "accepted", false, {
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "running late",
    });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags).toContainEqual(["start", "1000"]);
    expect(e.tags).toContainEqual(["end", "2000"]);
    expect(e.content).toBe("running late");
  });

  it("omits start/end and uses empty content when no extras are given", async () => {
    await rsvpToEvent("31923:author:abc12345", "accepted", false);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags.find((t: string[]) => t[0] === "start")).toBeUndefined();
    expect(e.tags.find((t: string[]) => t[0] === "end")).toBeUndefined();
    expect(e.content).toBe("");
  });

  it("carries the questionnaire into the wrapped rumor for a private RSVP", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap1", kind: CALENDAR_KINDS.rsvpGiftWrap });
    await rsvpToEvent("32678:author:abc12345", "tentative", true, {
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "maybe",
    });
    const rumor = (wrapEvent as any).mock.calls[0][0];
    expect(rumor.tags).toContainEqual(["start", "1000"]);
    expect(rumor.tags).toContainEqual(["end", "2000"]);
    expect(rumor.content).toBe("maybe");
  });
});

describe("fetchRsvpsForEvent", () => {
  it("returns deduplicated RSVPs keyed by pubkey", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "p1",
        kind: CALENDAR_KINDS.publicRsvp,
        created_at: 10,
        sig: "s",
        content: "",
        tags: [["status", "accepted"]],
      },
      {
        id: "r2",
        pubkey: "p1",
        kind: CALENDAR_KINDS.publicRsvp,
        created_at: 20,
        sig: "s",
        content: "",
        tags: [["status", "declined"]],
      },
      {
        id: "r3",
        pubkey: "p2",
        kind: CALENDAR_KINDS.publicRsvp,
        created_at: 5,
        sig: "s",
        content: "",
        tags: [["status", "tentative"]],
      },
    ]);
    const rsvps = await fetchRsvpsForEvent("31923:author:abc");
    expect(rsvps).toHaveLength(2);
    const p1rsvp = rsvps.find((r) => r.pubkey === "p1");
    expect(p1rsvp?.status).toBe("declined");
  });

  it("skips events with no status tag", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "p1",
        kind: CALENDAR_KINDS.publicRsvp,
        created_at: 10,
        sig: "s",
        content: "",
        tags: [],
      },
    ]);
    const rsvps = await fetchRsvpsForEvent("31923:author:abc");
    expect(rsvps).toHaveLength(0);
  });

  it("parses suggested times and the comment", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "r1",
        pubkey: "u1",
        kind: CALENDAR_KINDS.publicRsvp,
        created_at: 9,
        sig: "s",
        content: "ok?",
        tags: [
          ["status", "tentative"],
          ["start", "1000"],
          ["end", "2000"],
        ],
      },
    ]);
    const rsvps = await fetchRsvpsForEvent("31923:author:abc");
    expect(rsvps[0]).toMatchObject({
      pubkey: "u1",
      status: "tentative",
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "ok?",
    });
  });
});

describe("extractInvitationFromWrap", () => {
  it("returns the invitation coordinate from an unwrapped calendar rumor", async () => {
    (unwrapEvent as any).mockResolvedValue({
      kind: CALENDAR_KINDS.rumor,
      pubkey: "author",
      content: JSON.stringify({ eventId: "abc12345" }),
    });
    const inv = await extractInvitationFromWrap({ id: "w1", created_at: 5 } as any);
    expect(inv).not.toBeNull();
    expect(inv!.eventCoordinate).toBe(`${CALENDAR_KINDS.privateEvent}:author:abc12345`);
    expect(inv!.wrapId).toBe("w1");
  });

  it("returns null when the unwrapped rumor is not a calendar kind", async () => {
    (unwrapEvent as any).mockResolvedValue({ kind: 1, pubkey: "x", content: "{}" });
    expect(await extractInvitationFromWrap({ id: "w" } as any)).toBeNull();
  });

  it("reads the standalone invitation rumor shape (a + viewKey tags)", async () => {
    (unwrapEvent as any).mockResolvedValue({
      kind: CALENDAR_KINDS.rumor,
      pubkey: "author",
      content: "",
      tags: [
        ["a", "32678:author:d9", "wss://r"],
        ["viewKey", "nsec1xyz"],
      ],
    });
    const inv = await extractInvitationFromWrap({ id: "w1", created_at: 7 } as any);
    expect(inv?.eventCoordinate).toBe("32678:author:d9");
    expect(inv?.kind).toBe(32678);
    expect(inv?.authorPubkey).toBe("author");
    expect(inv?.viewKey).toBe("nsec1xyz");
  });
});
