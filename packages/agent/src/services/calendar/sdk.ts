import { CalendarSDK, type CalendarSigner } from "@formstr/calendar-sdk";
import { signerManager, nostrRuntime, relayManager, type NostrSigner } from "@formstr/core";

/**
 * `@formstr/calendar-sdk` 0.1.0 ships `toCalendarSigner` with a broken parameter
 * type (`signEvent(event: never): Promise<never>`), which no real signer
 * satisfies. Building the CalendarSigner here does the same job — bind every
 * method so a class signer keeps its receiver — and typechecks honestly.
 * Delete this when the SDK's own adapter is fixed (docs/sdk/calendar-sdk-followups.md item 7).
 */
// `NostrSigner` declares the NIP-44 methods optional; `CalendarSigner` requires
// them. This narrows the type without a cast. It does not probe capability —
// core's signers all define both methods and surface a missing extension or
// bunker capability later, from inside the call.
function toCalendarSigner(signer: NostrSigner): CalendarSigner {
  if (!signer.nip44Encrypt || !signer.nip44Decrypt) {
    throw new Error(
      "The active signer does not declare NIP-44 support, which every calendar operation requires.",
    );
  }
  const { nip44Encrypt, nip44Decrypt } = signer;
  return {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (event) => signer.signEvent(event),
    nip44Encrypt: (pubkey, plaintext) => nip44Encrypt.call(signer, pubkey, plaintext),
    nip44Decrypt: (pubkey, ciphertext) => nip44Decrypt.call(signer, pubkey, ciphertext),
  };
}

/**
 * One `CalendarSDK` per (signer instance, pubkey, relay set).
 *
 * The SDK takes a signer *instance*, not a resolver, so a cached instance
 * outlives an account switch unless we key the cache on the pubkey. Pubkey
 * alone is not enough, though: `signerManager` hands back a freshly adapted
 * signer object on every unlock, and installs `null` while locked, all under
 * the same pubkey — so the cache also requires the exact signer object back,
 * which covers lock/unlock/account-switch/logout in one comparison. The
 * runtime is injected rather than defaulted, so the SDK shares core's pool and
 * its `dispose()` leaves those sockets alone — core owns them.
 */
let cached: { signer: NostrSigner; pubkey: string; relayKey: string; sdk: CalendarSDK } | null =
  null;

export function calendarRelays(): string[] {
  return relayManager.getRelaysForModule("calendar");
}

export async function getCalendarSdk(): Promise<CalendarSDK> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();
  const relays = calendarRelays();
  const relayKey = relays.join(",");

  if (
    cached &&
    cached.signer === signer &&
    cached.pubkey === pubkey &&
    cached.relayKey === relayKey
  ) {
    return cached.sdk;
  }

  const sdk = new CalendarSDK({
    signer: toCalendarSigner(signer),
    runtime: nostrRuntime,
    relays,
  });
  cached = { signer, pubkey, relayKey, sdk };
  return sdk;
}

/** Drops the cached instance. Call on logout, and from tests. */
export function resetCalendarSdk(): void {
  cached = null;
}
