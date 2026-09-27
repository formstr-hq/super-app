import { LocalSigner } from "@formstr/core";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

/**
 * A device-local key used ONLY by the Nostr transport.
 *
 * The transport signs every wire frame as its own Nostr event. Doing that with
 * the user's real signer (NIP-07 / NIP-46) would fire a signing prompt per
 * frame — unusable. So each device gets its own throwaway key, generated once
 * and persisted in localStorage: signing is instant and silent, and this is the
 * npub you whitelist on the home node (one key per edge device, by design).
 *
 * This key is NOT the user's identity and carries no reputation — it's purely a
 * transport credential, like an SSH key for the tunnel.
 */
const STORAGE_KEY = "formstr:transport-nsec";

let cached: { signer: LocalSigner; pubkey: string; npub: string } | null = null;

function loadOrCreateSecret(): Uint8Array {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { type, data } = nip19.decode(stored);
      if (type === "nsec") return data as Uint8Array;
    }
  } catch {
    /* corrupt/unavailable — regenerate */
  }
  const sk = generateSecretKey();
  try {
    localStorage.setItem(STORAGE_KEY, nip19.nsecEncode(sk));
  } catch {
    /* private mode / storage full — key just won't persist across reloads */
  }
  return sk;
}

/** The device's transport identity (memoized). */
export function getTransportIdentity(): { signer: LocalSigner; pubkey: string; npub: string } {
  if (cached) return cached;
  const sk = loadOrCreateSecret();
  const pubkey = getPublicKey(sk);
  cached = { signer: new LocalSigner(sk), pubkey, npub: nip19.npubEncode(pubkey) };
  return cached;
}

/** The npub to whitelist on the home node for this device. */
export function getTransportNpub(): string {
  return getTransportIdentity().npub;
}
