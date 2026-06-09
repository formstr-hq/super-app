import type { Event } from "nostr-tools";

// ── Event Kinds ─────────────────────────────────────────
export const POLLS_KINDS = {
  poll: 1068,
  response: 1018,
  responseLegacy: 1070,
  rating: 34259,
} as const;

// ── Data Structures ─────────────────────────────────────

export type PollType = "singlechoice" | "multiplechoice";

export interface PollOption {
  id: string;
  label: string;
}

export interface Poll {
  id: string;
  content: string; // Poll question
  options: PollOption[];
  pollType: PollType;
  pubkey: string;
  createdAt: number;
  endsAt?: number; // Unix timestamp
  powDifficulty?: number;
  relays: string[];
  hashtags: string[];
  event: Event;
}

export interface PollResponseData {
  pollId: string;
  selectedOptionIds: string[];
}

export interface OptionResult {
  count: number;
  percentage: number;
  responders: string[];
}

export interface PollResults {
  results: Map<string, OptionResult>;
  totalVotes: number;
}

export interface PollDraft {
  question: string;
  options: { label: string }[];
  pollType: PollType;
  endsAt?: Date;
  hashtags?: string[];
}
