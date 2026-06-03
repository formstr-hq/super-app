import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  polls: {
    fetchMyPolls: vi.fn(),
    fetchPoll: vi.fn(),
    fetchPollResults: vi.fn(),
    createPoll: vi.fn(),
    submitPollResponse: vi.fn(),
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

describe("polls tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates submit_poll_response behind allowWrites", () => {
    const ro = fakeServer();
    registerPolls(ro.server, { allowWrites: false });
    expect(ro.tools.has("list_polls")).toBe(true);
    expect(ro.tools.has("create_poll")).toBe(true);
    expect(ro.tools.has("submit_poll_response")).toBe(false);

    const rw = fakeServer();
    registerPolls(rw.server, { allowWrites: true });
    expect(rw.tools.has("submit_poll_response")).toBe(true);
  });

  it("submit_poll_response requires confirm, then votes with the poll author", async () => {
    (polls.fetchPoll as any).mockResolvedValue({
      id: "p1",
      pubkey: "author",
      content: "Q",
      options: [],
      pollType: "singlechoice",
      createdAt: 0,
      relays: [],
      hashtags: [],
    });
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
    expect(polls.submitPollResponse).toHaveBeenCalledWith("p1", "author", ["o1"]);
    expect(okRes.isError).toBeFalsy();
  });

  it("fetch_poll_results serializes the option map", async () => {
    (polls.fetchPollResults as any).mockResolvedValue({
      results: new Map([["o1", { count: 3, percentage: 75, responders: [] }]]),
      totalVotes: 4,
    });
    const { server, tools } = fakeServer();
    registerPolls(server, { allowWrites: false });
    const res = await tools.get("fetch_poll_results")!.handler({ pollEventId: "p1" });
    expect(res.structuredContent.totalVotes).toBe(4);
    expect(res.structuredContent.options).toEqual([{ optionId: "o1", count: 3, percentage: 75 }]);
  });
});
