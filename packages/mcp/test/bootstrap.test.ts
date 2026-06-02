import { signerManager } from "@formstr/core";
import { describe, it, expect, beforeEach } from "vitest";

import { bootstrap } from "../src/bootstrap";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

describe("bootstrap", () => {
  beforeEach(() => {
    // @ts-expect-error reset shim between tests
    delete globalThis.localStorage;
  });

  it("installs a localStorage shim and logs the signer in from nsec", async () => {
    await bootstrap({ nsec: NSEC });
    expect(typeof globalThis.localStorage?.getItem).toBe("function");
    const pk = signerManager.getPublicKey();
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an invalid nsec", async () => {
    await expect(bootstrap({ nsec: "not-an-nsec" })).rejects.toThrow();
  });
});
