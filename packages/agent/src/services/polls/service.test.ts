import { signerManager, nostrRuntime, relayManager } from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: {
    publish: vi.fn(),
    fetchOne: vi.fn(),
    querySync: vi.fn(),
    subscribe: vi.fn(),
  },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.module"]) },
}));

import {
  fetchDeletions,
  isPollDeleted,
  fetchMyPolls,
  fetchRecentPolls,
  fetchPollResults,
  submitPollResponse,
  deletePoll,
  clearMyVotes,
  fetchPoll,
} from "./service";
import type { Poll } from "./types";

const AUTHOR = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue(AUTHOR),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "sid", sig: "sig", pubkey: AUTHOR }),
    ),
};

function ev(partial: Partial<Event>): Event {
  return {
    id: "x",
    pubkey: AUTHOR,
    created_at: 1000,
    kind: 1068,
    tags: [],
    content: "",
    sig: "",
    ...partial,
  } as Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
  (nostrRuntime.fetchOne as any).mockResolvedValue(null);
  (relayManager.getRelaysForModule as any).mockReturnValue(["wss://relay.module"]);
});

describe("fetchDeletions / isPollDeleted", () => {
  it("indexes deleted event ids per author; matches only same-author deletions", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        kind: 5,
        pubkey: AUTHOR,
        created_at: 2000,
        tags: [
          ["e", "poll1"],
          ["k", "1068"],
        ],
        content: "",
        id: "d1",
        sig: "",
      },
    ]);

    const deleted = await fetchDeletions(["wss://r"], [AUTHOR]);

    expect(isPollDeleted(ev({ id: "poll1", pubkey: AUTHOR }), deleted)).toBe(true);
    // A different author's event with the same id is NOT deleted (NIP-09 same-author rule).
    expect(isPollDeleted(ev({ id: "poll1", pubkey: "ffff" }), deleted)).toBe(false);
    expect(nostrRuntime.querySync).toHaveBeenCalledWith(
      ["wss://r"],
      expect.objectContaining({ kinds: [5], authors: [AUTHOR] }),
    );
  });

  it("returns empty and skips the query when there are no authors", async () => {
    const deleted = await fetchDeletions(["wss://r"], []);
    expect(deleted.size).toBe(0);
    expect(nostrRuntime.querySync).not.toHaveBeenCalled();
  });
});

function pollEvent(id: string, pubkey = AUTHOR): Event {
  return ev({ id, pubkey, kind: 1068, content: "Q?", tags: [["option", `${id}o`, "A"]] });
}

/** Dispatch querySync mock on the requested kind, so call order doesn't matter. */
function mockQuery(byKind: { polls?: Event[]; deletions?: Event[] }) {
  (nostrRuntime.querySync as any).mockImplementation((_relays: string[], f: any) =>
    Promise.resolve(f.kinds?.includes(5) ? (byKind.deletions ?? []) : (byKind.polls ?? [])),
  );
}

describe("fetchMyPolls / fetchRecentPolls — apply deletions on load", () => {
  it("fetchMyPolls drops polls the author deleted", async () => {
    mockQuery({
      polls: [pollEvent("p1"), pollEvent("p2")],
      deletions: [
        ev({
          id: "d",
          kind: 5,
          created_at: 2000,
          tags: [
            ["e", "p2"],
            ["k", "1068"],
          ],
        }),
      ],
    });
    const result = await fetchMyPolls();
    expect(result.map((p) => p.id)).toEqual(["p1"]);
  });

  it("fetchRecentPolls drops polls deleted by their own author, queried across those authors", async () => {
    const OTHER = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    mockQuery({
      polls: [pollEvent("a1", AUTHOR), pollEvent("b1", OTHER)],
      deletions: [ev({ id: "d", pubkey: AUTHOR, kind: 5, created_at: 2000, tags: [["e", "a1"]] })],
    });
    const result = await fetchRecentPolls();
    expect(result.map((p) => p.id)).toEqual(["b1"]);
    // deletions queried for the authors that appeared in the poll results
    const delCall = (nostrRuntime.querySync as any).mock.calls.find((c: any[]) =>
      c[1].kinds?.includes(5),
    );
    expect(delCall[1].authors).toEqual(expect.arrayContaining([AUTHOR, OTHER]));
  });
});

function makePoll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: "poll1",
    content: "Q?",
    options: [
      { id: "o1", label: "A" },
      { id: "o2", label: "B" },
    ],
    pollType: "multiplechoice",
    pubkey: AUTHOR,
    createdAt: 1000,
    relays: ["wss://poll.relay"],
    hashtags: [],
    event: ev({ id: "poll1" }),
    ...overrides,
  };
}

function resp(pubkey: string, optionIds: string[], created_at: number, id: string): Event {
  return ev({
    id,
    pubkey,
    kind: 1018,
    created_at,
    tags: [["e", "poll1"], ["p", AUTHOR], ...optionIds.map((o) => ["response", o])],
  });
}

/** querySync mock: kind-5 filter → deletions, otherwise → responses. */
function mockResultsQuery(responses: Event[], deletions: Event[] = []) {
  (nostrRuntime.querySync as any).mockImplementation((_relays: string[], f: any) =>
    Promise.resolve(f.kinds?.includes(5) ? deletions : responses),
  );
}

describe("fetchPollResults — tally", () => {
  it("keeps only each voter's latest response (by created_at)", async () => {
    mockResultsQuery([
      resp("v1", ["o1"], 1000, "r1"),
      resp("v1", ["o2"], 2000, "r2"), // newer supersedes
    ]);
    const res = await fetchPollResults(makePoll({ pollType: "singlechoice" }));
    expect(res.totalVotes).toBe(1);
    expect(res.results.get("o2")?.count).toBe(1);
    expect(res.results.get("o1")?.count ?? 0).toBe(0);
  });

  it("excludes votes the voter has cleared (NIP-09)", async () => {
    mockResultsQuery(
      [resp("v1", ["o1"], 1000, "r1"), resp("v2", ["o1"], 1000, "r2")],
      [ev({ id: "d", pubkey: "v2", kind: 5, created_at: 1500, tags: [["e", "r2"]] })],
    );
    const res = await fetchPollResults(makePoll());
    expect(res.totalVotes).toBe(1);
    expect(res.results.get("o1")?.count).toBe(1);
  });

  it("computes multiple-choice percentage as count / sum-of-all-counts", async () => {
    mockResultsQuery([resp("v1", ["o1", "o2"], 1000, "r1"), resp("v2", ["o1"], 1000, "r2")]);
    const res = await fetchPollResults(makePoll()); // counts o1=2, o2=1, Σ=3
    expect(res.totalVotes).toBe(2);
    expect(res.results.get("o1")?.count).toBe(2);
    expect(Math.round(res.results.get("o1")!.percentage)).toBe(67);
    expect(Math.round(res.results.get("o2")!.percentage)).toBe(33);
  });

  it("reads poll.relays ∪ module relays and bounds the query by endsAt", async () => {
    mockResultsQuery([]);
    await fetchPollResults(makePoll({ relays: ["wss://poll.relay"], endsAt: 5000 }));
    const call = (nostrRuntime.querySync as any).mock.calls.find((c: any[]) =>
      c[1].kinds?.includes(1018),
    );
    expect(call[0]).toEqual(expect.arrayContaining(["wss://poll.relay", "wss://relay.module"]));
    expect(call[1].until).toBe(5000);
    expect(call[1]["#e"]).toEqual(["poll1"]);
  });
});

describe("submitPollResponse — wire format & relay targeting", () => {
  it("publishes a kind-1018 vote to the poll's relays ∪ module relays", async () => {
    await submitPollResponse("poll1", AUTHOR, ["o1"], ["wss://poll.relay"]);
    const [relays, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(relays).toEqual(expect.arrayContaining(["wss://poll.relay", "wss://relay.module"]));
    expect(event.kind).toBe(1018);
    expect(event.content).toBe("");
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ["e", "poll1"],
        ["p", AUTHOR],
        ["response", "o1"],
      ]),
    );
  });
});

describe("deletePoll", () => {
  it("publishes a NIP-09 kind-5 for the poll id + kind to poll.relays ∪ module", async () => {
    await deletePoll("poll1", ["wss://poll.relay"]);
    const [relays, event] = (nostrRuntime.publish as any).mock.calls[0];
    expect(event.kind).toBe(5);
    expect(event.tags).toEqual(
      expect.arrayContaining([
        ["e", "poll1"],
        ["k", "1068"],
      ]),
    );
    expect(relays).toEqual(expect.arrayContaining(["wss://poll.relay", "wss://relay.module"]));
  });
});

describe("clearMyVotes", () => {
  it("queries and NIP-09-deletes the signer's own responses to the poll", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      resp(AUTHOR, ["o1"], 1000, "r1"),
      ev({ id: "r2", pubkey: AUTHOR, kind: 1070, created_at: 1000, tags: [["e", "poll1"]] }),
    ]);
    await clearMyVotes("poll1", ["wss://poll.relay"]);

    const q = (nostrRuntime.querySync as any).mock.calls[0];
    expect(q[1]).toEqual(
      expect.objectContaining({ kinds: [1018, 1070], authors: [AUTHOR], "#e": ["poll1"] }),
    );
    const [, del] = (nostrRuntime.publish as any).mock.calls[0];
    expect(del.kind).toBe(5);
    const eTags = del.tags.filter((t: string[]) => t[0] === "e").map((t: string[]) => t[1]);
    expect(eTags).toEqual(expect.arrayContaining(["r1", "r2"]));
  });

  it("does nothing when the user has no votes on the poll", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([]);
    await clearMyVotes("poll1");
    expect(nostrRuntime.publish).not.toHaveBeenCalled();
  });
});

describe("parsePollEvent — label fallback", () => {
  it("uses the label tag as the question when content is empty", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue(
      ev({
        id: "p",
        content: "",
        tags: [
          ["option", "o1", "A"],
          ["label", "From label"],
        ],
      }),
    );
    const poll = await fetchPoll("p");
    expect(poll?.content).toBe("From label");
  });

  it("prefers content when it is present", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue(
      ev({
        id: "p",
        content: "Real Q",
        tags: [
          ["option", "o1", "A"],
          ["label", "ignored"],
        ],
      }),
    );
    const poll = await fetchPoll("p");
    expect(poll?.content).toBe("Real Q");
  });
});

describe("PoW polls (NIP-13) — upstream parity", () => {
  const D = 8; // 8 leading zero bits — fast to mine in tests (~256 hashes)

  it('submitPollResponse mines the vote: nonce + ["W", difficulty] tags, id meets target', async () => {
    const { getEventHash, nip13 } = await import("nostr-tools");
    await submitPollResponse("poll1", AUTHOR, ["o1"], [], D);
    const tmpl = (mockSigner.signEvent as any).mock.calls[0][0];
    const nonce = tmpl.tags.find((t: string[]) => t[0] === "nonce");
    expect(nonce?.[2]).toBe(String(D));
    expect(tmpl.tags).toContainEqual(["W", String(D)]);
    // The mined id (over the voter's pubkey) satisfies the difficulty.
    expect(nip13.getPow(getEventHash({ ...tmpl, pubkey: AUTHOR }))).toBeGreaterThanOrEqual(D);
  });

  it("does NOT add nonce/W tags when the poll has no PoW requirement", async () => {
    await submitPollResponse("poll1", AUTHOR, ["o1"], []);
    const tmpl = (mockSigner.signEvent as any).mock.calls[0][0];
    expect(tmpl.tags.find((t: string[]) => t[0] === "nonce")).toBeUndefined();
    expect(tmpl.tags.find((t: string[]) => t[0] === "W")).toBeUndefined();
  });

  it("fetchPollResults filters by #W and drops under-target votes", async () => {
    const minedId = "00" + "f".repeat(62); // pow = 8
    const weakId = "f".repeat(64); // pow = 0
    mockResultsQuery([
      { ...resp("v1", ["o1"], 1000, minedId), id: minedId },
      { ...resp("v2", ["o2"], 1000, weakId), id: weakId },
    ]);
    const res = await fetchPollResults(makePoll({ powDifficulty: D }));
    expect(res.totalVotes).toBe(1);
    expect(res.results.get("o1")?.count).toBe(1);
    expect(res.results.get("o2")?.count ?? 0).toBe(0);
    const call = (nostrRuntime.querySync as any).mock.calls.find((c: any[]) =>
      c[1].kinds?.includes(1018),
    );
    expect(call[1]["#W"]).toEqual([String(D)]);
  });

  it("counts duplicate response tags for the same option once (upstream dedup)", async () => {
    mockResultsQuery([resp("v1", ["o1", "o1"], 1000, "r1")]);
    const res = await fetchPollResults(makePoll());
    expect(res.results.get("o1")?.count).toBe(1);
  });
});
