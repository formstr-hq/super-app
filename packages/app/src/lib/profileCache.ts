import { fetchProfile, type NostrProfile } from "@formstr/agent/services/profile";
import { useEffect, useState } from "react";

import { formatNpub } from "./npub";

/**
 * Resolved kind-0 profiles, keyed by hex pubkey. `null` records a pubkey that
 * has no profile (or whose lookup failed) so a member list of strangers does
 * not re-query the relays on every render.
 */
const resolved = new Map<string, NostrProfile | null>();
/** In-flight lookups, so N rows for one pubkey make one request. */
const pending = new Map<string, Promise<NostrProfile | null>>();
/** Subscribers, so a lookup started by one row repaints every other. */
const listeners = new Set<() => void>();

function load(pubkey: string): Promise<NostrProfile | null> {
  const existing = pending.get(pubkey);
  if (existing) return existing;

  const request = fetchProfile(pubkey)
    .catch(() => null)
    .then((profile) => {
      resolved.set(pubkey, profile);
      pending.delete(pubkey);
      for (const notify of listeners) notify();
      return profile;
    });

  pending.set(pubkey, request);
  return request;
}

/** The best name we hold for a pubkey right now, without triggering a lookup. */
export function profileName(pubkey: string): string {
  const profile = resolved.get(pubkey);
  return profile?.displayName || profile?.name || formatNpub(pubkey);
}

/**
 * A pubkey's display name, fetched once per session.
 *
 * Renders the short npub immediately and swaps in the kind-0 name when it
 * arrives, so a member list is legible on first paint and never blocks on a
 * relay that is slow or has nothing to say.
 */
export function useProfileName(pubkey: string | null): string {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!pubkey) return;
    const notify = () => bump((n) => n + 1);
    listeners.add(notify);
    if (!resolved.has(pubkey)) void load(pubkey);
    return () => {
      listeners.delete(notify);
    };
  }, [pubkey]);

  return pubkey ? profileName(pubkey) : "";
}

/** Test seam — the cache is module-level and would otherwise leak across tests. */
export function resetProfileCache(): void {
  resolved.clear();
  pending.clear();
  listeners.clear();
}
