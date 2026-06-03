import { describe, it, expect } from "vitest";

import { type Credential, parseCredential, serializeCredential } from "../src/auth/credential";

describe("credential", () => {
  it("round-trips a local credential", () => {
    const cred: Credential = { method: "local", pubkey: "ab".repeat(32), nsec: "nsec1xyz" };
    expect(parseCredential(serializeCredential(cred))).toEqual(cred);
  });

  it("round-trips a nip46 credential", () => {
    const cred: Credential = {
      method: "nip46",
      pubkey: "ab".repeat(32),
      clientSecretKey: "00".repeat(32),
      remoteSignerPubkey: "cd".repeat(32),
      relays: ["wss://signer.example"],
      secret: "s3cret",
    };
    expect(parseCredential(serializeCredential(cred))).toEqual(cred);
  });

  it("rejects malformed JSON / unknown method", () => {
    expect(() => parseCredential("{}")).toThrow();
    expect(() => parseCredential(JSON.stringify({ method: "wat" }))).toThrow();
  });
});
