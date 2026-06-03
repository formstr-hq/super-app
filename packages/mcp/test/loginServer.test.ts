import { generateSecretKey, getPublicKey } from "nostr-tools";
import { decode, nsecEncode } from "nostr-tools/nip19";
import { describe, it, expect } from "vitest";

import { runLoginServer } from "../src/auth/loginServer";

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for server");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function tokenFor(base: string): Promise<string> {
  const html = await (await fetch(base)).text();
  const m = /const TOKEN = "([0-9a-f]+)"/.exec(html);
  if (!m) throw new Error("token not found in page");
  return m[1];
}

function post(base: string, body: unknown): Promise<Response> {
  return fetch(base + "submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const noBrowser = { open: () => {}, makeQr: async () => null };

describe("loginServer", () => {
  it("rejects a bad token, then accepts a valid nsec submit", async () => {
    const sk = generateSecretKey();
    const nsec = nsecEncode(sk);
    const expectedPk = getPublicKey(sk);

    let base = "";
    const credP = runLoginServer({ ...noBrowser, onListening: (u) => (base = u) });
    await waitFor(() => base !== "");
    const token = await tokenFor(base);

    const bad = await post(base, { token: "wrong", method: "nsec", nsec });
    expect(bad.status).toBe(403);

    const good = await post(base, { token, method: "nsec", nsec });
    expect(good.status).toBe(200);
    expect((await good.json()).pubkey).toBe(expectedPk);

    expect(await credP).toEqual({ method: "local", pubkey: expectedPk, nsec });
  });

  it("generates a guest credential", async () => {
    let base = "";
    const credP = runLoginServer({ ...noBrowser, onListening: (u) => (base = u) });
    await waitFor(() => base !== "");
    const token = await tokenFor(base);

    const res = await post(base, { token, method: "guest" });
    expect(res.status).toBe(200);

    const cred = await credP;
    expect(cred.method).toBe("local");
    expect(cred.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(decode((cred as { nsec: string }).nsec).type).toBe("nsec");
  });
});
