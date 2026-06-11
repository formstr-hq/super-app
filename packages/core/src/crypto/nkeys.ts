/**
 * nkeys encoding — shared between Forms and Pages.
 * Bech32 + TLV encoding for passing encryption keys via URL hash fragments.
 *
 * Wire format (MUST match the standalone apps byte-for-byte — formstr.app and
 * nostr-docs ship an identical `utils/nkeys.ts`; see
 * `upstream/nostr-forms/packages/formstr-app/src/utils/nkeys.ts`):
 *
 *   TLV row:   [type (1 byte), length (1 byte), value (`length` bytes)]
 *   Type 0:    key name  (UTF-8 string)
 *   Type 1:    key value (UTF-8 string, e.g. hex-encoded 32-byte key)
 *   Layout:    ALL type-0 rows first, then ALL type-1 rows; decode pairs
 *              names[i] ↔ values[i] by index.
 *
 * Format: nkeys1... (bech32, max 2048 chars — same limit as naddr)
 * Design: URL hash fragments (#nkeys1...) never sent to server — keys stay client-only.
 */

const PREFIX = "nkeys";
const BECH32_LIMIT = 2048;

export function encodeNKeys(keys: Record<string, string>): string {
  const encoder = new TextEncoder();
  const names: Uint8Array[] = [];
  const values: Uint8Array[] = [];

  for (const [name, value] of Object.entries(keys)) {
    const nameBytes = encoder.encode(name);
    const valueBytes = encoder.encode(value);
    if (nameBytes.length > 255) throw new Error(`nkeys: key name too long (${name.length})`);
    if (valueBytes.length > 255) throw new Error(`nkeys: value too long for key "${name}"`);
    names.push(nameBytes);
    values.push(valueBytes);
  }

  // Grouped layout: all names (type 0) before all values (type 1).
  const tlvBytes: number[] = [];
  for (const nameBytes of names) {
    tlvBytes.push(0, nameBytes.length, ...nameBytes);
  }
  for (const valueBytes of values) {
    tlvBytes.push(1, valueBytes.length, ...valueBytes);
  }

  const words = bech32ToWords(new Uint8Array(tlvBytes));
  const encoded = bech32Encode(PREFIX, words);
  if (encoded.length > BECH32_LIMIT) {
    throw new Error(`nkeys: encoded length ${encoded.length} exceeds ${BECH32_LIMIT}`);
  }
  return encoded;
}

export function decodeNKeys(encoded: string): Record<string, string> {
  if (!encoded.startsWith(PREFIX + "1")) {
    throw new Error("Invalid nkeys encoding");
  }

  const { words } = bech32Decode(encoded);
  const data = bech32FromWords(words);
  const decoder = new TextDecoder();

  const names: string[] = [];
  const values: string[] = [];
  let i = 0;
  while (i + 2 <= data.length) {
    const type = data[i];
    const length = data[i + 1];
    const value = decoder.decode(data.slice(i + 2, i + 2 + length));
    i += 2 + length;
    if (type === 0) names.push(value);
    else if (type === 1) values.push(value);
  }

  const result: Record<string, string> = {};
  names.forEach((name, idx) => {
    result[name] = values[idx] ?? "";
  });
  return result;
}

// ── Bech32 helpers ──────────────────────────────────────

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Encode(prefix: string, words: number[]): string {
  const checksum = createChecksum(prefix, words);
  const combined = [...words, ...checksum];
  return prefix + "1" + combined.map((w) => CHARSET[w]).join("");
}

function bech32Decode(str: string): { prefix: string; words: number[] } {
  const sepIdx = str.lastIndexOf("1");
  const prefix = str.slice(0, sepIdx);
  const dataStr = str.slice(sepIdx + 1);
  const words = [...dataStr].map((c) => CHARSET.indexOf(c));
  // Strip 6-char checksum
  return { prefix, words: words.slice(0, -6) };
}

function bech32ToWords(data: Uint8Array): number[] {
  const words: number[] = [];
  let value = 0;
  let bits = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((value >> bits) & 0x1f);
    }
  }
  if (bits > 0) {
    words.push((value << (5 - bits)) & 0x1f);
  }
  return words;
}

function bech32FromWords(words: number[]): Uint8Array {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const word of words) {
    value = (value << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) ret.push((mod >> (5 * (5 - i))) & 31);
  return ret;
}
