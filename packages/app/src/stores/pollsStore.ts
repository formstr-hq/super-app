import type { Poll, PollDraft, PollResults } from "@formstr/agent/services/polls";
import * as pollsService from "@formstr/agent/services/polls/service";
import { create } from "zustand";

interface PollsStore {
  myPolls: Poll[];
  recentPolls: Poll[];
  currentPoll: Poll | null;
  currentResults: PollResults | null;
  isLoadingMine: boolean;
  isLoadingRecent: boolean;
  isLoadingDetail: boolean;
  error: string | null;

  fetchMyPolls(): Promise<void>;
  fetchRecentPolls(): Promise<void>;
  loadPoll(eventId: string): Promise<void>;
  loadResults(poll: Poll): Promise<void>;
  createPoll(draft: PollDraft): Promise<Poll>;
  submitResponse(poll: Poll, selectedOptionIds: string[]): Promise<void>;
  deletePoll(poll: Poll): Promise<void>;
  clearMyVotes(poll: Poll): Promise<void>;
  clearCurrent(): void;
}

export const usePollsStore = create<PollsStore>((set) => ({
  myPolls: [],
  recentPolls: [],
  currentPoll: null,
  currentResults: null,
  isLoadingMine: false,
  isLoadingRecent: false,
  isLoadingDetail: false,
  error: null,

  async fetchMyPolls() {
    set({ isLoadingMine: true, error: null });
    try {
      const polls = await pollsService.fetchMyPolls();
      set({ myPolls: polls, isLoadingMine: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to fetch polls",
        isLoadingMine: false,
      });
    }
  },

  async fetchRecentPolls() {
    set({ isLoadingRecent: true, error: null });
    try {
      const polls = await pollsService.fetchRecentPolls();
      set({ recentPolls: polls, isLoadingRecent: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to fetch polls",
        isLoadingRecent: false,
      });
    }
  },

  async loadPoll(eventId) {
    set({ isLoadingDetail: true, error: null, currentPoll: null });
    try {
      const poll = await pollsService.fetchPoll(eventId);
      set({ currentPoll: poll, isLoadingDetail: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load poll",
        isLoadingDetail: false,
      });
    }
  },

  async loadResults(poll) {
    try {
      const results = await pollsService.fetchPollResults(poll);
      set({ currentResults: results });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load results" });
    }
  },

  async createPoll(draft) {
    try {
      const poll = await pollsService.createPoll(draft);
      set((state) => ({ myPolls: [...state.myPolls, poll] }));
      return poll;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create poll" });
      throw e;
    }
  },

  async submitResponse(poll, selectedOptionIds) {
    try {
      await pollsService.submitPollResponse(
        poll.id,
        poll.pubkey,
        selectedOptionIds,
        poll.relays,
        poll.powDifficulty,
      );
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to submit response" });
      throw e;
    }
  },

  async deletePoll(poll) {
    try {
      await pollsService.deletePoll(poll.id, poll.relays);
      set((state) => ({
        myPolls: state.myPolls.filter((p) => p.id !== poll.id),
        recentPolls: state.recentPolls.filter((p) => p.id !== poll.id),
        currentPoll: state.currentPoll?.id === poll.id ? null : state.currentPoll,
        currentResults: state.currentPoll?.id === poll.id ? null : state.currentResults,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete poll" });
      throw e;
    }
  },

  async clearMyVotes(poll) {
    try {
      await pollsService.clearMyVotes(poll.id, poll.relays);
      const results = await pollsService.fetchPollResults(poll);
      set({ currentResults: results });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to clear votes" });
    }
  },

  clearCurrent() {
    set({ currentPoll: null, currentResults: null });
  },
}));
