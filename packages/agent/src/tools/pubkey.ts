import { nip19 } from "nostr-tools";

/**
 * Pubkey normalization shared by the MCP tools. Accepts either an `npub1…`
 * (decoded to hex) or a 64-char hex pubkey; returns null for anything else.
 * Kept dependency-free (only nostr-tools) so tools can import it without
 * pulling in `../services` — the calendar test mocks that module, and a
 * transitive `AnswerType` import from there would break the mock.
 */
export function normalizePubkey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      // ignore
    }
  }
  return null;
}

export function normalizePubkeyList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? normalizePubkey(v) : null))
    .filter((p): p is string => !!p);
}
