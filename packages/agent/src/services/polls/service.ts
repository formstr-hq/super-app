import { signerManager, nostrRuntime, relayManager } from "@formstr/core";
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

/** The poll's own `["relay"]` tags ∪ the module defaults — where votes are published/read. */
function withModuleRelays(pollRelays?: string[]): string[] {
  return Array.from(new Set([...(pollRelays ?? []), ...relayManager.getRelaysForModule("polls")]));
}

export async function submitPollResponse(
  pollId: string,
  pollAuthor: string,
  selectedOptionIds: string[],
  pollRelays?: string[],
): Promise<void> {
  const signer = await signerManager.getSigner();
  const relays = withModuleRelays(pollRelays);

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

// ── Delete / Clear (NIP-09) ─────────────────────────────

/** Author deletes their poll: kind-5 `["e", pollId]` + `["k","1068"]`. */
export async function deletePoll(pollId: string, pollRelays?: string[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", pollId],
      ["k", String(POLLS_KINDS.poll)],
    ],
    content: "",
  };
  const signed = await signer.signEvent(event);
  await nostrRuntime.publish(withModuleRelays(pollRelays), signed);
}

/** Voter retracts their own votes on a poll: NIP-09 kind-5 over their response events. */
export async function clearMyVotes(pollId: string, pollRelays?: string[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = withModuleRelays(pollRelays);

  const mine = await nostrRuntime.querySync(relays, {
    kinds: [POLLS_KINDS.response, POLLS_KINDS.responseLegacy],
    authors: [pubkey],
    "#e": [pollId],
  } as Filter);
  if (mine.length === 0) return;

  const kinds = Array.from(new Set(mine.map((e: Event) => e.kind)));
  const event: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [...mine.map((e: Event) => ["e", e.id]), ...kinds.map((k) => ["k", String(k)])],
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

/** Relays a poll's votes live on: the poll's own `["relay"]` tags ∪ the module defaults. */
function resultRelays(poll: Poll): string[] {
  return withModuleRelays(poll.relays);
}

/** Map voter → their latest, non-cleared selected option ids (latest wins by created_at). */
function latestResponsesByVoter(events: Event[], deleted: Set<string>): Map<string, string[]> {
  const latest = new Map<string, Event>();
  for (const e of events) {
    if (isPollDeleted(e, deleted)) continue;
    if (!e.tags.some((t) => t[0] === "response")) continue;
    const prev = latest.get(e.pubkey);
    if (!prev || e.created_at > prev.created_at) latest.set(e.pubkey, e);
  }
  const out = new Map<string, string[]>();
  for (const [pubkey, e] of latest) {
    out.set(
      pubkey,
      e.tags.filter((t) => t[0] === "response").map((t) => t[1]),
    );
  }
  return out;
}

/**
 * Tally a poll's votes. Reads kind-1018 (+ legacy 1070) `#e`=poll.id from the poll's
 * relays ∪ module defaults, bounded by `endsAt`; excludes cleared (NIP-09-deleted)
 * votes and keeps only each voter's latest response by `created_at`.
 */
export async function fetchPollResults(poll: Poll): Promise<PollResults> {
  const relays = resultRelays(poll);
  const events = await nostrRuntime.querySync(relays, {
    kinds: [POLLS_KINDS.response, POLLS_KINDS.responseLegacy],
    "#e": [poll.id],
    ...(poll.endsAt ? { until: poll.endsAt } : {}),
  } as Filter);

  const authors = Array.from(new Set(events.map((e: Event) => e.pubkey)));
  const deleted = await fetchDeletions(relays, authors);
  return computeResults(latestResponsesByVoter(events, deleted));
}

// ── Fetch Recent Polls ──────────────────────────────────

export async function fetchRecentPolls(limit = 20): Promise<Poll[]> {
  const relays = relayManager.getRelaysForModule("polls");
  const filter: Filter = {
    kinds: [POLLS_KINDS.poll],
    limit,
  };

  const events = await nostrRuntime.querySync(relays, filter);
  const authors = Array.from(new Set(events.map((e: Event) => e.pubkey)));
  const deleted = await fetchDeletions(relays, authors);
  return events
    .filter((e: Event) => !isPollDeleted(e, deleted))
    .map(parsePollEvent)
    .filter((p: Poll | null): p is Poll => p !== null);
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
  const deleted = await fetchDeletions(relays, [pubkey]);
  return events
    .filter((e: Event) => !isPollDeleted(e, deleted))
    .map(parsePollEvent)
    .filter((p: Poll | null): p is Poll => p !== null);
}

// ── Deletions (NIP-09) ──────────────────────────────────

/**
 * Set of `${pubkey}:${eventId}` for events deleted (kind-5) by their own author.
 * Keying by the deleting author enforces NIP-09's same-author rule for free: a
 * forged deletion of someone else's id keys under the forger and never matches.
 */
export async function fetchDeletions(relays: string[], authors: string[]): Promise<Set<string>> {
  const deleted = new Set<string>();
  if (authors.length === 0) return deleted;

  const events = await nostrRuntime.querySync(relays, { kinds: [5], authors } as Filter);
  for (const ev of events) {
    for (const tag of ev.tags) {
      if (tag[0] === "e" && tag[1]) deleted.add(`${ev.pubkey}:${tag[1]}`);
    }
  }
  return deleted;
}

/** True when this event's own author published a NIP-09 deletion for it. */
export function isPollDeleted(event: Event, deleted: Set<string>): boolean {
  return deleted.has(`${event.pubkey}:${event.id}`);
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
  // Question lives in content; some standalone polls carry it in a ["label"] tag instead.
  const question = event.content || event.tags.find((t) => t[0] === "label")?.[1] || "";

  return {
    id: event.id,
    content: question,
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

  // Count votes per option (a voter may select several in a multiple-choice poll).
  const counts = new Map<string, string[]>();
  for (const [pubkey, selected] of responses) {
    for (const optionId of selected) {
      const existing = counts.get(optionId) ?? [];
      existing.push(pubkey);
      counts.set(optionId, existing);
    }
  }

  // Percentage is each option's share of all selections (count / Σcounts) — matches
  // the standalone, so multiple-choice bars are identical across apps.
  const totalSelections = Array.from(counts.values()).reduce((sum, r) => sum + r.length, 0);
  for (const [optionId, responders] of counts) {
    results.set(optionId, {
      count: responders.length,
      percentage: totalSelections > 0 ? (responders.length / totalSelections) * 100 : 0,
      responders,
    });
  }

  return { results, totalVotes: totalVoters };
}
