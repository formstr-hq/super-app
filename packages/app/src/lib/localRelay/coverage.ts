import type { Filter } from "nostr-tools";

/** Tag constraints a filter can carry, as NIP-01 spells them. */
const tagKeys = (filter: Filter): string[] =>
  Object.keys(filter).filter((key) => key.startsWith("#"));

const isSubset = (inner: readonly string[] | undefined, outer: readonly string[]): boolean =>
  inner !== undefined && inner.length > 0 && inner.every((value) => outer.includes(value));

/**
 * Is `requested` answered by whatever `declared` keeps warm?
 *
 * Used to decide how patiently a one-shot read waits. A covered read is backed
 * by a standing interest the worker is actively updating, so it can settle on a
 * short grace instead of waiting out a full quiet window. Anything not provably
 * covered is treated as cold — being wrong in that direction costs latency,
 * while the other direction serves stale data.
 *
 * Coverage means: every field `declared` constrains, `requested` constrains at
 * least as narrowly. Time windows are never covered — a standing interest tracks
 * the live tail and promises nothing about a historical range.
 */
export function isCoveredBy(requested: Filter, declared: Filter): boolean {
  if (requested.since !== undefined || requested.until !== undefined) return false;

  if (declared.kinds) {
    if (!requested.kinds?.length) return false;
    if (!requested.kinds.every((kind) => declared.kinds!.includes(kind))) return false;
  }

  if (declared.authors && !isSubset(requested.authors, declared.authors)) return false;

  for (const key of tagKeys(declared)) {
    const declaredValues = (declared as Record<string, string[]>)[key];
    if (!isSubset((requested as Record<string, string[]>)[key], declaredValues)) return false;
  }

  return true;
}
