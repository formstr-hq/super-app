import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  polls: {
    fetchMyPolls: vi.fn(),
    fetchRecentPolls: vi.fn(),
    fetchPoll: vi.fn(),
    fetchPollResults: vi.fn(),
    createPoll: vi.fn(),
    submitPollResponse: vi.fn(),
    deletePoll: vi.fn(),
    clearMyVotes: vi.fn(),
  },
}));

import { polls } from "@formstr/app/services";

import { registerPolls } from "../src/tools/polls";

function fakeServer() {
  const tools = new Map<string, { handler: (a: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (a: any) => Promise<any>) =>
      tools.set(name, { handler }),
  } as any;
  return { server, tools };
}

const POLL = {
  id: "p1",
  pubkey: "author",
  content: "Q",
  options: [],
  pollType: "singlechoice",
  createdAt: 0,
  relays: ["wss://poll.relay"],
  hashtags: [],
};

describe("polls tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (polls.fetchPoll as any).mockResolvedValue(POLL);
  });

  it("read + constructive tools available without writes; destructive ones gated", () => {
    const ro = fakeServer();
    registerPolls(ro.server, { allowWrites: false });
    for (const t of [
      "list_polls",
      "list_recent_polls",
      "get_poll",
      "fetch_poll_results",
      "create_poll",
    ]) {
      expect(ro.tools.has(t)).toBe(true);
    }
    expect(ro.tools.has("submit_poll_response")).toBe(false);
    expect(ro.tools.has("delete_poll")).toBe(false);
    expect(ro.tools.has("clear_my_vote")).toBe(false);

    const rw = fakeServer();
    registerPolls(rw.server, { allowWrites: true });
    expect(rw.tools.has("submit_poll_response")).toBe(true);
    expect(rw.tools.has("delete_poll")).toBe(true);
    expect(rw.tools.has("clear_my_vote")).toBe(true);
  });

  it("submit_poll_response requires confirm, then votes with the poll author + relays", async () => {
    const { server, tools } = fakeServer();
    registerPolls(server, { allowWrites: true });

    const blocked = await tools
      .get("submit_poll_response")!
      .handler({ pollEventId: "p1", optionIds: ["o1"] });
    expect(blocked.isError).toBe(true);
    expect(polls.submitPollResponse).not.toHaveBeenCalled();

    const okRes = await tools
      .get("submit_poll_response")!
      .handler({ pollEventId: "p1", optionIds: ["o1"], confirm: true });
    expect(polls.submitPollResponse).toHaveBeenCalledWith(
      "p1",
      "author",
      ["o1"],
      ["wss://poll.relay"],
    );
    expect(okRes.isError).toBeFalsy();
  });

  it("fetch_poll_results fetches the poll then serializes the option map", async () => {
    (polls.fetchPollResults as any).mockResolvedValue({
      results: new Map([["o1", { count: 3, percentage: 75, responders: [] }]]),
      totalVotes: 4,
    });
    const { server, tools } = fakeServer();
    registerPolls(server, { allowWrites: false });
    const res = await tools.get("fetch_poll_results")!.handler({ pollEventId: "p1" });
    expect(polls.fetchPollResults).toHaveBeenCalledWith(POLL);
    expect(res.structuredContent.totalVotes).toBe(4);
    expect(res.structuredContent.options).toEqual([{ optionId: "o1", count: 3, percentage: 75 }]);
  });

  it("list_recent_polls lists discoverable polls", async () => {
    (polls.fetchRecentPolls as any).mockResolvedValue([
      { id: "r1", content: "Q1", pollType: "singlechoice", createdAt: 1, endsAt: undefined },
    ]);
    const { server, tools } = fakeServer();
    registerPolls(server, { allowWrites: false });
    const res = await tools.get("list_recent_polls")!.handler({});
    expect(res.structuredContent.polls[0]).toMatchObject({ id: "r1", question: "Q1" });
  });

  it("delete_poll requires confirm, then deletes via the poll's relays", async () => {
    const { server, tools } = fakeServer();
    registerPolls(server, { allowWrites: true });

    const blocked = await tools.get("delete_poll")!.handler({ pollEventId: "p1" });
    expect(blocked.isError).toBe(true);
    expect(polls.deletePoll).not.toHaveBeenCalled();

    await tools.get("delete_poll")!.handler({ pollEventId: "p1", confirm: true });
    expect(polls.deletePoll).toHaveBeenCalledWith("p1", ["wss://poll.relay"]);
  });

  it("clear_my_vote requires confirm, then clears via the poll's relays", async () => {
    const { server, tools } = fakeServer();
    registerPolls(server, { allowWrites: true });

    const blocked = await tools.get("clear_my_vote")!.handler({ pollEventId: "p1" });
    expect(blocked.isError).toBe(true);
    expect(polls.clearMyVotes).not.toHaveBeenCalled();

    await tools.get("clear_my_vote")!.handler({ pollEventId: "p1", confirm: true });
    expect(polls.clearMyVotes).toHaveBeenCalledWith("p1", ["wss://poll.relay"]);
  });
});
