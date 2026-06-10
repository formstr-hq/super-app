import { signerManager, nostrRuntime, relayManager } from "@formstr/core";
import type { Event, EventTemplate, Filter } from "nostr-tools";

import { CALENDAR_KINDS } from "./types";

/**
 * Public busy lists (kind 31926) — upstream `calendar.formstr.app` parity.
 *
 * One parameterized-replaceable event per (user, month):
 *
 *   tags: [["d","YYYY-MM"], ["t","YYYY-MM"], ["t","busy"],
 *          ["block", startSec, endSec], ...]
 *   content: ""   (intentionally empty — no titles/descriptions leaked)
 *
 * The hosted BookingPage computes slot availability from these, so a user who
 * never publishes them appears fully free to bookers (double-booking risk).
 */

export interface BusyRange {
  /** ms timestamps */
  start: number;
  end: number;
}

export interface BusyList {
  user: string;
  /** Month partition key, `YYYY-MM`. */
  monthKey: string;
  /** Blocked ranges (deduped, sorted), ms timestamps. */
  ranges: BusyRange[];
  eventId: string;
  createdAt: number;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/** `YYYY-MM` month key (UTC) for a timestamp, matching upstream. */
export function busyListMonthKey(value: number | Date): string {
  const d = typeof value === "number" ? new Date(value) : value;
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}`;
}

/**
 * Every `YYYY-MM` key the absolute range `[startMs, endMs]` touches,
 * inclusive. Multi-month ranges keep the full [start,end] pair in each
 * month's list so removal can match by exact pair (upstream behavior).
 */
export function busyListMonthKeysForRange(startMs: number, endMs: number): string[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const start = Math.min(startMs, endMs);
  const end = Math.max(startMs, endMs);

  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), 1),
  );
  const endMonth = new Date(
    Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), 1),
  );
  while (cursor.getTime() <= endMonth.getTime()) {
    keys.push(busyListMonthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/** BusyList → kind-31926 tags (block rows in unix seconds). */
export function busyListToTags(list: BusyList): string[][] {
  const tags: string[][] = [
    ["d", list.monthKey],
    ["t", list.monthKey],
    ["t", "busy"],
  ];
  for (const r of list.ranges) {
    tags.push(["block", String(Math.floor(r.start / 1000)), String(Math.floor(r.end / 1000))]);
  }
  return tags;
}

/** Kind-31926 event → BusyList (sorted, exact-pair deduped); null if malformed. */
export function parseBusyListEvent(event: Event): BusyList | null {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  if (!MONTH_KEY_RE.test(dTag)) return null;

  const ranges: BusyRange[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "block") continue;
    const start = Number(tag[1]) * 1000;
    const end = Number(tag[2]) * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const deduped: BusyRange[] = [];
  for (const r of ranges) {
    const last = deduped[deduped.length - 1];
    if (last && last.start === r.start && last.end === r.end) continue;
    deduped.push(r);
  }

  return {
    user: event.pubkey,
    monthKey: dTag,
    ranges: deduped,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

/**
 * Fetch a user's busy lists for the given months, newest wins per month
 * (addressable events diverge across relays).
 */
export async function fetchBusyListsForUser(
  pubkey: string,
  monthKeys: string[],
): Promise<BusyList[]> {
  if (monthKeys.length === 0) return [];
  const relays = relayManager.getRelaysForModule("calendar");
  const events = await nostrRuntime.querySync(relays, {
    kinds: [CALENDAR_KINDS.publicBusyList],
    authors: [pubkey],
    "#d": monthKeys,
  } as Filter);

  const newestPerMonth = new Map<string, BusyList>();
  for (const event of events) {
    const list = parseBusyListEvent(event);
    if (!list) continue;
    const prev = newestPerMonth.get(list.monthKey);
    if (!prev || list.createdAt > prev.createdAt) newestPerMonth.set(list.monthKey, list);
  }
  return [...newestPerMonth.values()];
}

async function publishBusyList(list: BusyList): Promise<void> {
  const signer = await signerManager.getSigner();
  const event: EventTemplate = {
    kind: CALENDAR_KINDS.publicBusyList,
    created_at: Math.floor(Date.now() / 1000),
    tags: busyListToTags(list),
    content: "",
  };
  const signed = await signer.signEvent(event);
  const relays = relayManager.getRelaysForModule("calendar");
  await nostrRuntime.publish(relays, signed);
}

const sameRange = (a: BusyRange, b: BusyRange) => a.start === b.start && a.end === b.end;

/**
 * Append a busy range to the signed-in user's lists, republishing each month
 * the range touches. Idempotent: an exact existing [start,end] pair is left
 * alone.
 */
export async function addBusyRange(range: BusyRange): Promise<void> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const monthKeys = busyListMonthKeysForRange(range.start, range.end);
  const existing = new Map(
    (await fetchBusyListsForUser(pubkey, monthKeys)).map((l) => [l.monthKey, l]),
  );

  for (const monthKey of monthKeys) {
    const list = existing.get(monthKey) ?? {
      user: pubkey,
      monthKey,
      ranges: [],
      eventId: "",
      createdAt: 0,
    };
    if (list.ranges.some((r) => sameRange(r, range))) continue;
    const ranges = [...list.ranges, { start: range.start, end: range.end }].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    await publishBusyList({ ...list, ranges });
  }
}

/**
 * Remove a busy range previously added via {@link addBusyRange} (matched by
 * exact start/end pair) and republish each touched month. No-op when absent.
 */
export async function removeBusyRange(range: BusyRange): Promise<void> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const monthKeys = busyListMonthKeysForRange(range.start, range.end);
  const lists = await fetchBusyListsForUser(pubkey, monthKeys);

  for (const list of lists) {
    if (!list.ranges.some((r) => sameRange(r, range))) continue;
    const ranges = list.ranges.filter((r) => !sameRange(r, range));
    await publishBusyList({ ...list, ranges });
  }
}
