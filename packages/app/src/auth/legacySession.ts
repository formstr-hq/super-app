/**
 * Pre-@formstr/signer session keys written by the old SignerManager web path.
 * `client-secret` held the raw identity key in plaintext for local/guest — the
 * exact thing we're migrating away from.
 */
const KEY_METHOD = "formstr:signer-method";
const KEY_PUBKEY = "formstr:pubkey";
const KEY_SECRET = "formstr:client-secret";

export interface LegacySession {
  method: string;
  pubkey: string | null;
  secretHex: string | null;
}

/** Read a legacy session from localStorage, or null if there isn't one. */
export function readLegacySession(): LegacySession | null {
  if (typeof localStorage === "undefined") return null;
  const method = localStorage.getItem(KEY_METHOD);
  if (!method) return null;
  return {
    method,
    pubkey: localStorage.getItem(KEY_PUBKEY),
    secretHex: localStorage.getItem(KEY_SECRET),
  };
}

/** True when the session holds a raw key that must be encrypted (local/guest). */
export function legacyNeedsMigration(session: LegacySession | null): boolean {
  return (
    !!session && (session.method === "local" || session.method === "guest") && !!session.secretHex
  );
}

/** Remove all legacy signer keys. Idempotent. */
export function clearLegacySession(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY_METHOD);
  localStorage.removeItem(KEY_PUBKEY);
  localStorage.removeItem(KEY_SECRET);
}
