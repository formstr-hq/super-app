import { signerManager } from "@formstr/core";
import { type ActiveSigner, type Signer, type StoredAccount } from "@formstr/signer";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { bootstrap, type BootstrapDeps } from "../src/bootstrap";

const PUBKEY = "ab".repeat(32);

function fakeActiveSigner(): ActiveSigner {
  return {
    getPublicKey: async () => PUBKEY,
    signEvent: async (e) => ({ ...e, id: "id", pubkey: PUBKEY, sig: "sig" }),
    nip04Encrypt: async () => "x",
    nip04Decrypt: async () => "x",
    nip44Encrypt: async () => "x",
    nip44Decrypt: async () => "x",
  };
}

/** A fake @formstr/signer that starts locked and unlocks on the matching loginWith*. */
function fakeSigner(account: StoredAccount | null) {
  let active: ActiveSigner | null = null;
  const accounts = account ? [account] : [];
  const calls: Record<string, unknown[]> = {};
  const rec = (n: string, ...a: unknown[]) => void (calls[n] ??= []).push(a);
  const signer = {
    listAccounts: () => accounts,
    getActiveAccount: () => account,
    getActiveSigner: () => active,
    switchAccount: async (pk: string) => {
      rec("switchAccount", pk);
      active = null;
    },
    loginWithNcryptsec: async (ncryptsec: string, passphrase: string) => {
      rec("loginWithNcryptsec", ncryptsec, passphrase);
      active = fakeActiveSigner();
      return account!;
    },
    loginWithBunkerUri: async (uri: string, opts: unknown) => {
      rec("loginWithBunkerUri", uri, opts);
      active = fakeActiveSigner();
      return account!;
    },
    // The 0.2.x silent-resume path. Reconstructs the runtime signer from the
    // persisted nip46 fields (remoteSignerPubkey/relays/clientSecretKey) without
    // re-parsing the pairing URI or re-sending `connect`.
    unlock: async (opts: unknown) => {
      rec("unlock", opts);
      if (!account || account.method === "ncryptsec") return null;
      active = fakeActiveSigner();
      return active;
    },
  };
  return { signer: signer as unknown as Signer, calls };
}

const ncryptsecAccount: StoredAccount = {
  npub: "npub1x",
  pubkey: PUBKEY,
  method: "ncryptsec",
  ncryptsec: "ncryptsec1abc",
};

const nip46Account: StoredAccount = {
  npub: "npub1y",
  pubkey: PUBKEY,
  method: "nip46",
  nip46: {
    // A `nostrconnect://` (QR pairing) URI — deliberately NOT a `bunker://` URI.
    // Resuming must NOT feed this back through loginWithBunkerUri (which would
    // throw "invalid bunker URI"); it must use the stored fields via unlock().
    uri: "nostrconnect://abcd?relay=wss://r.example&secret=xyz",
    remoteSignerPubkey: "cd".repeat(32),
    relays: ["wss://r.example"],
    clientSecretKey: "00".repeat(32),
  },
};

let setActiveSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // @ts-expect-error reset the shim between tests
  delete globalThis.localStorage;
  setActiveSpy = vi.spyOn(signerManager, "setActiveSigner").mockImplementation(() => {});
});

afterEach(() => {
  setActiveSpy.mockRestore();
});

function depsFor(signer: Signer, over: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return { buildSigner: async () => signer, pool: {} as BootstrapDeps["pool"], ...over };
}

describe("bootstrap", () => {
  it("unlocks an ncryptsec account with the env passphrase and injects as 'local'", async () => {
    const { signer, calls } = fakeSigner(ncryptsecAccount);
    await bootstrap({}, depsFor(signer, { passphrase: "pw" }));

    expect(calls.loginWithNcryptsec[0]).toEqual(["ncryptsec1abc", "pw"]);
    expect(setActiveSpy).toHaveBeenCalledTimes(1);
    const [, method, pubkey] = setActiveSpy.mock.calls[0];
    expect(method).toBe("local");
    expect(pubkey).toBe(PUBKEY);
  });

  it("resumes a nip46 session via signer.unlock({ pool }) and injects as 'nip46'", async () => {
    const { signer, calls } = fakeSigner(nip46Account);
    const pool = { tag: "pool" } as unknown as BootstrapDeps["pool"];
    await bootstrap({}, depsFor(signer, { pool }));

    // Resume goes through unlock() with the pool — NOT loginWithBunkerUri, which
    // would re-parse the nostrconnect:// pairing URI and throw "invalid bunker URI".
    expect(calls.unlock).toBeDefined();
    const [opts] = calls.unlock[0] as [{ pool: unknown }];
    expect(opts.pool).toBe(pool);
    expect(calls.loginWithBunkerUri).toBeUndefined();
    expect(setActiveSpy.mock.calls[0][1]).toBe("nip46");
  });

  it("throws a re-pair hint when a nip46 session can't be resumed (incomplete keys)", async () => {
    const incomplete: StoredAccount = {
      ...nip46Account,
      nip46: { ...nip46Account.nip46!, clientSecretKey: "" },
    };
    const { signer } = fakeSigner(incomplete);
    // Make unlock report failure the way the real signer does for missing fields.
    (signer as unknown as { unlock: () => Promise<null> }).unlock = async () => null;
    const pool = { tag: "pool" } as unknown as BootstrapDeps["pool"];
    await expect(bootstrap({}, depsFor(signer, { pool }))).rejects.toThrow(/re-?pair|login/i);
  });

  it("throws when an ncryptsec account has no boot passphrase and no prompt", async () => {
    const { signer } = fakeSigner(ncryptsecAccount);
    delete process.env.FORMSTR_MCP_NCRYPTSEC_PASSPHRASE;
    await expect(bootstrap({}, depsFor(signer))).rejects.toThrow(
      /FORMSTR_MCP_NCRYPTSEC_PASSPHRASE/,
    );
  });

  it("prompts for the passphrase interactively when none is configured", async () => {
    const { signer, calls } = fakeSigner(ncryptsecAccount);
    delete process.env.FORMSTR_MCP_NCRYPTSEC_PASSPHRASE;
    const promptPassphrase = vi.fn(async () => "typed-pw");
    await bootstrap({}, depsFor(signer, { promptPassphrase }));

    expect(promptPassphrase).toHaveBeenCalledTimes(1);
    // The prompted passphrase (not the env var) unlocks the ncryptsec account.
    expect(calls.loginWithNcryptsec[0]).toEqual(["ncryptsec1abc", "typed-pw"]);
  });

  it("prefers the env passphrase over prompting", async () => {
    const { signer, calls } = fakeSigner(ncryptsecAccount);
    const promptPassphrase = vi.fn(async () => "typed-pw");
    await bootstrap({}, depsFor(signer, { passphrase: "env-pw", promptPassphrase }));

    expect(promptPassphrase).not.toHaveBeenCalled();
    expect(calls.loginWithNcryptsec[0]).toEqual(["ncryptsec1abc", "env-pw"]);
  });

  it("throws a friendly error when no account exists", async () => {
    const { signer } = fakeSigner(null);
    await expect(bootstrap({}, depsFor(signer))).rejects.toThrow(/login/i);
  });

  it("selects the requested --account via switchAccount", async () => {
    const { signer, calls } = fakeSigner(ncryptsecAccount);
    await bootstrap({ account: PUBKEY }, depsFor(signer, { passphrase: "pw" }));
    expect(calls.switchAccount[0]).toEqual([PUBKEY]);
  });

  it("throws when --account matches no stored account", async () => {
    const { signer } = fakeSigner(ncryptsecAccount);
    await expect(
      bootstrap({ account: "ff".repeat(32) }, depsFor(signer, { passphrase: "pw" })),
    ).rejects.toThrow(/account/i);
  });
});
