import { signerManager } from "@formstr/core";
import { describe, it, expect, beforeEach } from "vitest";

import { type Credential } from "../src/auth/credential";
import { bootstrap } from "../src/bootstrap";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const localCred = (nsec: string): Credential => ({
  method: "local",
  pubkey: "00".repeat(32),
  nsec,
});

describe("bootstrap", () => {
  beforeEach(() => {
    // @ts-expect-error reset shim between tests
    delete globalThis.localStorage;
  });

  it("installs a localStorage shim and logs the signer in from a local credential", async () => {
    await bootstrap({ credential: localCred(NSEC) });
    expect(typeof globalThis.localStorage?.getItem).toBe("function");
    const pk = signerManager.getPublicKey();
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an invalid nsec", async () => {
    await expect(bootstrap({ credential: localCred("not-an-nsec") })).rejects.toThrow();
  });
});
