import { signerManager, nostrRuntime, relayManager } from "@formstr/core";
import type { SubscriptionHandle } from "@formstr/core";
import type { EventTemplate, Event, Filter } from "nostr-tools";

import {
  POLLS_KINDS,
  type Poll,
  type PollDraft,
  type PollResults,
  type OptionResult,
  type PollOption,
} from "./types";

// ── Create Poll ─────────────────────────────────────────

export async function createPoll(draft: PollDraft): Promise<Poll> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("polls");

  const tags: string[][] = [["polltype", draft.pollType]];

  const options: PollOption[] = draft.options.map((o) => ({
    id: crypto.randomUUID().slice(0, 8),
    label: o.label,
  }));

  for (const option of options) {
    tags.push(["option", option.id, option.label]);
  }

  for (const relay of relays) {
    tags.push(["relay", relay]);
  }

  for (const tag of draft.hashtags ?? []) {
    tags.push(["t", tag]);
  }

  if (draft.endsAt) {
    tags.push(["endsAt", String(Math.floor(draft.endsAt.getTime() / 1000))]);
  }

  const event: EventTemplate = {
    kind: POLLS_KINDS.poll,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: draft.question,
  };

  const signed = await signer.signEvent(event);
  await nostrRuntime.publish(relays, signed);

  return {
    id: signed.id,
    content: draft.question,
    options,
    pollType: draft.pollType,
    pubkey,
    createdAt: signed.created_at,
    endsAt: draft.endsAt ? Math.floor(draft.endsAt.getTime() / 1000) : undefined,
    relays,
    hashtags: draft.hashtags ?? [],
    event: signed,
  };
}

// ── Submit Response ─────────────────────────────────────

export async function submitPollResponse(
  pollId: string,
  pollAuthor: string,
  selectedOptionIds: string[],
): Promise<void> {
  const signer = await signerManager.getSigner();
  const relays = relayManager.getRelaysForModule("polls");

  const tags: string[][] = [
    ["e", pollId],
    ["p", pollAuthor],
  ];

  for (const optionId of selectedOptionIds) {
    tags.push(["response", optionId]);
  }

  const event: EventTemplate = {
    kind: POLLS_KINDS.response,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  const signed = await signer.signEvent(event);
  await nostrRuntime.publish(relays, signed);
}

// ── Fetch Poll ──────────────────────────────────────────

export async function fetchPoll(eventId: string): Promise<Poll | null> {
  const relays = relayManager.getRelaysForModule("polls");
  const filter: Filter = { ids: [eventId], limit: 1 };

  const event = await nostrRuntime.fetchOne(relays, filter);
  if (!event) return null;

  return parsePollEvent(event);
}

// ── Fetch Results ───────────────────────────────────────

export function subscribeToPollResults(
  pollId: string,
  onResults: (results: PollResults) => void,
  onEose?: () => void,
): SubscriptionHandle {
  const relays = relayManager.getRelaysForModule("polls");
  const responses = new Map<string, string[]>(); // pubkey → selectedOptionIds

  const filter: Filter = {
    kinds: [POLLS_KINDS.response, POLLS_KINDS.responseLegacy],
    "#e": [pollId],
  };

  return nostrRuntime.subscribe(relays, [filter], {
    onEvent: (event: Event) => {
      const selected = event.tags
        .filter((t: string[]) => t[0] === "response")
        .map((t: string[]) => t[1]);

      if (selected.length > 0) {
        responses.set(event.pubkey, selected);
        onResults(computeResults(responses));
      }
    },
    onEose,
  });
}

export async function fetchPollResults(pollId: string): Promise<PollResults> {
  const relays = relayManager.getRelaysForModule("polls");
  const filter: Filter = {
    kinds: [POLLS_KINDS.response, POLLS_KINDS.responseLegacy],
    "#e": [pollId],
  };

  const events = await nostrRuntime.querySync(relays, filter);
  const responses = new Map<string, string[]>();

  for (const event of events) {
    const selected = event.tags
      .filter((t: string[]) => t[0] === "response")
      .map((t: string[]) => t[1]);

    if (selected.length > 0) {
      // Latest response per pubkey wins
      const existing = responses.get(event.pubkey);
      if (!existing) {
        responses.set(event.pubkey, selected);
      }
    }
  }

  return computeResults(responses);
}

// ── Fetch Recent Polls ──────────────────────────────────

export async function fetchRecentPolls(limit = 20): Promise<Poll[]> {
  const relays = relayManager.getRelaysForModule("polls");
  const filter: Filter = {
    kinds: [POLLS_KINDS.poll],
    limit,
  };

  const events = await nostrRuntime.querySync(relays, filter);
  return events.map(parsePollEvent).filter((p: Poll | null): p is Poll => p !== null);
}

export async function fetchMyPolls(): Promise<Poll[]> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = relayManager.getRelaysForModule("polls");

  const filter: Filter = {
    kinds: [POLLS_KINDS.poll],
    authors: [pubkey],
  };

  const events = await nostrRuntime.querySync(relays, filter);
  return events.map(parsePollEvent).filter((p: Poll | null): p is Poll => p !== null);
}

// ── Helpers ─────────────────────────────────────────────

function parsePollEvent(event: Event): Poll | null {
  const options: PollOption[] = event.tags
    .filter((t) => t[0] === "option")
    .map((t) => ({ id: t[1], label: t[2] }));

  if (options.length === 0) return null;

  const pollType = event.tags.find((t) => t[0] === "polltype")?.[1] ?? "singlechoice";
  const endsAt = event.tags.find((t) => t[0] === "endsAt")?.[1];
  const relays = event.tags.filter((t) => t[0] === "relay").map((t) => t[1]);
  const hashtags = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
  const pow = event.tags.find((t) => t[0] === "PoW")?.[1];

  return {
    id: event.id,
    content: event.content,
    options,
    pollType: pollType as Poll["pollType"],
    pubkey: event.pubkey,
    createdAt: event.created_at,
    endsAt: endsAt ? Number(endsAt) : undefined,
    powDifficulty: pow ? Number(pow) : undefined,
    relays,
    hashtags,
    event,
  };
}

function computeResults(responses: Map<string, string[]>): PollResults {
  const results = new Map<string, OptionResult>();
  const totalVoters = responses.size;

  // Count votes per option
  const counts = new Map<string, string[]>();
  for (const [pubkey, selected] of responses) {
    for (const optionId of selected) {
      const existing = counts.get(optionId) ?? [];
      existing.push(pubkey);
      counts.set(optionId, existing);
    }
  }

  for (const [optionId, responders] of counts) {
    results.set(optionId, {
      count: responders.length,
      percentage: totalVoters > 0 ? (responders.length / totalVoters) * 100 : 0,
      responders,
    });
  }

  return { results, totalVotes: totalVoters };
}
