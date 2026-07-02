import { getEventHash, nip13 } from "nostr-tools";
import type { Event, UnsignedEvent } from "nostr-tools";

/**
 * Highest PoW difficulty we are willing to mine. The difficulty comes from the
 * poll's own ["PoW"] tag — attacker-controlled data — and the miner below is a
 * synchronous loop, so an unbounded target (e.g. a poll claiming 60) would spin
 * this thread effectively forever. 20 (~1M hashes) keeps worst-case mining in
 * the seconds range and covers the difficulties real polls use.
 */
export const MAX_MINED_POW_DIFFICULTY = 20;

/**
 * NIP-13 proof-of-work miner for poll responses — a port of upstream
 * nostr-polls `utils/mining-worker.ts` (minePow): appends a
 * `["nonce", count, difficulty]` tag plus the `["W", difficulty]` query tag
 * (upstream filters vote queries by `#W` and rejects under-target ids), then
 * increments the nonce until the event id reaches the target difficulty.
 *
 * Synchronous CPU-bound loop — callers must reject difficulties above
 * MAX_MINED_POW_DIFFICULTY before mining; UIs should run it off the main thread.
 */
export function minePollEvent(unsigned: UnsignedEvent, difficulty: number): Omit<Event, "sig"> {
  const event = unsigned as Omit<Event, "sig">;
  const nonceTag = ["nonce", "0", difficulty.toString()];
  event.tags.push(nonceTag);
  event.tags.push(["W", difficulty.toString()]);

  let count = 0;
  for (;;) {
    // Re-anchor to the current second so the timestamp stays honest on long mines
    // (upstream resets the nonce whenever the clock ticks).
    const now = Math.floor(Date.now() / 1000);
    if (now !== event.created_at) {
      count = 0;
      event.created_at = now;
    }
    nonceTag[1] = (++count).toString();
    event.id = getEventHash(event);
    if (nip13.getPow(event.id) >= difficulty) return event;
  }
}

/** True when an event's id satisfies the poll's PoW target (NIP-13). */
export function hasValidPow(event: Pick<Event, "id">, difficulty: number): boolean {
  return nip13.getPow(event.id) >= difficulty;
}
