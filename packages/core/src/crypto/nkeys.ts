/**
 * nkeys encoding — shared between Forms and Pages.
 * Bech32 + TLV encoding for passing encryption keys via URL hash fragments.
 *
 * TLV Structure:
 *   Type 0: key name (UTF-8 string)
 *   Type 1: key value (hex-encoded 32-byte key)
 *
 * Format: nkeys1... (bech32, max 2048 chars)
 * Design: URL hash fragments (#nkeys1...) never sent to server — keys stay client-only.
 */

const PREFIX = "nkeys";

export function encodeNKeys(keys: Record<string, string>): string {
  const tlvBytes: number[] = [];

  for (const [name, value] of Object.entries(keys)) {
    // Type 0: key name
    const nameBytes = new TextEncoder().encode(name);
    tlvBytes.push(0); // type
    tlvBytes.push(nameBytes.length >> 8, nameBytes.length & 0xff); // length (2 bytes)
    tlvBytes.push(...nameBytes);

    // Type 1: key value (hex string as bytes)
    const valueBytes = new TextEncoder().encode(value);
    tlvBytes.push(1); // type
    tlvBytes.push(valueBytes.length >> 8, valueBytes.length & 0xff); // length (2 bytes)
    tlvBytes.push(...valueBytes);
  }

  const data = new Uint8Array(tlvBytes);
  // Convert to 5-bit groups for bech32
  const words = bech32ToWords(data);
  return bech32Encode(PREFIX, words);
}

export function decodeNKeys(encoded: string): Record<string, string> {
  if (!encoded.startsWith(PREFIX + "1")) {
    throw new Error("Invalid nkeys encoding");
  }

  const { words } = bech32Decode(encoded);
  const data = bech32FromWords(words);
  const result: Record<string, string> = {};

  let i = 0;
  let currentName = "";

  while (i < data.length) {
    const type = data[i];
    const length = (data[i + 1] << 8) | data[i + 2];
    i += 3;

    const valueBytes = data.slice(i, i + length);
    const value = new TextDecoder().decode(valueBytes);
    i += length;

    if (type === 0) {
      currentName = value;
    } else if (type === 1) {
      result[currentName] = value;
    }
  }

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
