/**
 * A UUID that also works in a NON-secure context.
 *
 * `crypto.randomUUID()` is only defined on secure origins (HTTPS or localhost),
 * so it's `undefined` when the app is served over plain http on a LAN/mesh
 * address (e.g. Yggdrasil). `crypto.getRandomValues()` has no such restriction,
 * so we fall back to a v4 UUID built from it.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch {
      /* non-secure context — fall through */
    }
  }
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
