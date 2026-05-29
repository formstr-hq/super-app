import { create } from "zustand";
import type { Poll, PollDraft, PollResults } from "../services/polls";
import * as pollsService from "../services/polls/service";

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
  loadResults(pollId: string): Promise<void>;
  createPoll(draft: PollDraft): Promise<Poll>;
  submitResponse(pollId: string, pollAuthor: string, selectedOptionIds: string[]): Promise<void>;
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

  async loadResults(pollId) {
    try {
      const results = await pollsService.fetchPollResults(pollId);
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

  async submitResponse(pollId, pollAuthor, selectedOptionIds) {
    try {
      await pollsService.submitPollResponse(pollId, pollAuthor, selectedOptionIds);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to submit response" });
      throw e;
    }
  },

  clearCurrent() {
    set({ currentPoll: null, currentResults: null });
  },
}));
