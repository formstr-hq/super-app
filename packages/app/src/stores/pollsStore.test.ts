import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/agent/services/polls/service", () => ({
  fetchMyPolls: vi.fn(),
  fetchRecentPolls: vi.fn(),
  fetchPoll: vi.fn(),
  fetchPollResults: vi.fn(),
  createPoll: vi.fn(),
  submitPollResponse: vi.fn(),
  deletePoll: vi.fn(),
  clearMyVotes: vi.fn(),
}));

import type { Poll } from "@formstr/agent/services/polls";
import * as pollsService from "@formstr/agent/services/polls/service";

import { usePollsStore } from "./pollsStore";

const poll: Poll = {
  id: "poll1",
  content: "Q?",
  options: [{ id: "o1", label: "A" }],
  pollType: "singlechoice",
  pubkey: "author1",
  createdAt: 1000,
  relays: ["wss://poll.relay"],
  hashtags: [],
  event: {} as Poll["event"],
};

beforeEach(() => {
  vi.clearAllMocks();
  usePollsStore.setState({
    myPolls: [],
    recentPolls: [],
    currentPoll: null,
    currentResults: null,
    isLoadingMine: false,
    isLoadingRecent: false,
    isLoadingDetail: false,
    error: null,
  });
});

describe("pollsStore", () => {
  it("submitResponse votes with the poll's author + relays", async () => {
    await usePollsStore.getState().submitResponse(poll, ["o1"]);
    expect(pollsService.submitPollResponse).toHaveBeenCalledWith(
      "poll1",
      "author1",
      ["o1"],
      ["wss://poll.relay"],
    );
  });

  it("loadResults stores the tally computed from the poll", async () => {
    (pollsService.fetchPollResults as any).mockResolvedValue({ results: new Map(), totalVotes: 3 });
    await usePollsStore.getState().loadResults(poll);
    expect(pollsService.fetchPollResults).toHaveBeenCalledWith(poll);
    expect(usePollsStore.getState().currentResults?.totalVotes).toBe(3);
  });

  it("deletePoll removes it from myPolls and clears the current poll", async () => {
    usePollsStore.setState({
      myPolls: [poll],
      currentPoll: poll,
      currentResults: { results: new Map(), totalVotes: 0 },
    });
    await usePollsStore.getState().deletePoll(poll);
    expect(pollsService.deletePoll).toHaveBeenCalledWith("poll1", ["wss://poll.relay"]);
    expect(usePollsStore.getState().myPolls).toEqual([]);
    expect(usePollsStore.getState().currentPoll).toBeNull();
  });

  it("clearMyVotes clears the user's votes then reloads results", async () => {
    (pollsService.fetchPollResults as any).mockResolvedValue({ results: new Map(), totalVotes: 0 });
    await usePollsStore.getState().clearMyVotes(poll);
    expect(pollsService.clearMyVotes).toHaveBeenCalledWith("poll1", ["wss://poll.relay"]);
    expect(pollsService.fetchPollResults).toHaveBeenCalledWith(poll);
  });
});
