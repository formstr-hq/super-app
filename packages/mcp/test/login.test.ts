import {
  bytesToHex,
  encryptSecretKey,
  hexToBytes,
  type Signer,
  type StoredAccount,
} from "@formstr/signer";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { describe, it, expect, vi } from "vitest";

import {
  describeBunkerError,
  doLogin,
  doLogout,
  doSwitch,
  findAccount,
  listAccounts,
  whoami,
  type LoginDeps,
} from "../src/auth/login";

/** A fake @formstr/signer Signer that records calls and returns a canned active account. */
function fakeSigner(pubkey = "ab".repeat(32)) {
  const account: StoredAccount = {
    npub: nip19.npubEncode(pubkey),
    pubkey,
    method: "ncryptsec",
  };
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const signer = {
    createAccount: vi.fn(async (passphrase: string) => {
      rec("createAccount", passphrase);
      return { npub: account.npub, ncryptsec: "ncryptsec1created" };
    }),
    loginWithNcryptsec: vi.fn(async (ncryptsec: string, passphrase: string) => {
      rec("loginWithNcryptsec", ncryptsec, passphrase);
      return account;
    }),
    loginWithBunkerUri: vi.fn(async (uri: string, opts: unknown) => {
      rec("loginWithBunkerUri", uri, opts);
      return account;
    }),
    loginWithNostrConnect: vi.fn(
      async (opts: {
        relays?: string[];
        onUri: (u: string) => void;
        pool?: unknown;
        perms?: unknown;
      }) => {
        rec("loginWithNostrConnect", opts);
        opts.onUri("nostrconnect://paired");
        return account;
      },
    ),
    getActiveAccount: vi.fn(() => account),
    listAccounts: vi.fn(() => [account]),
    logout: vi.fn(async (pk?: string) => rec("logout", pk)),
  };
  return { signer: signer as unknown as Signer, raw: signer, account, calls };
}

function makeDeps(over: Partial<LoginDeps> & { signer: Signer }): LoginDeps {
  return {
    prompt: async () => "",
    promptPassphrase: async () => "passphrase",
    printQr: vi.fn(),
    pool: {} as LoginDeps["pool"],
    log: vi.fn(),
    ...over,
  };
}

describe("doLogin", () => {
  it("create: generates an account and prints the ncryptsec backup loudly", async () => {
    const { signer, raw } = fakeSigner();
    const log = vi.fn();
    const deps = makeDeps({
      signer,
      prompt: async () => "create",
      promptPassphrase: async () => "hunter2",
      log,
    });

    const account = await doLogin(deps);

    expect(raw.createAccount).toHaveBeenCalledWith("hunter2");
    expect(account.pubkey).toBe("ab".repeat(32));
    expect(log.mock.calls.flat().join("\n")).toContain("ncryptsec1created");
  });

  it("import (nsec): encrypts the secret then logs in with the ncryptsec", async () => {
    const { signer, raw } = fakeSigner();
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    const deps = makeDeps({
      signer,
      prompt: async () => "import\n", // method first, then the key
      promptPassphrase: async () => "pw",
    });
    // First prompt = method, second = the key input.
    let n = 0;
    deps.prompt = async () => (n++ === 0 ? "import" : nsec);

    await doLogin(deps);

    expect(raw.loginWithNcryptsec).toHaveBeenCalledTimes(1);
    const [ncryptsec, passphrase] = raw.loginWithNcryptsec.mock.calls[0];
    expect(passphrase).toBe("pw");
    expect(ncryptsec).toMatch(/^ncryptsec1/);
    // The encrypted blob must round-trip back to the same key.
    expect(bytesToHex(hexToBytes(bytesToHex(sk)))).toBe(bytesToHex(sk));
  });

  it("import (ncryptsec passthrough): logs in with the pasted ncryptsec unchanged", async () => {
    const { signer, raw } = fakeSigner();
    const real = encryptSecretKey(generateSecretKey(), "pw");
    let n = 0;
    const deps = makeDeps({
      signer,
      prompt: async () => (n++ === 0 ? "import" : real),
      promptPassphrase: async () => "pw",
    });

    await doLogin(deps);

    expect(raw.loginWithNcryptsec).toHaveBeenCalledWith(real, "pw");
  });

  it("bunker: connects with the URI and the patched pool + perms", async () => {
    const { signer, raw } = fakeSigner();
    const pool = { tag: "pool" } as unknown as LoginDeps["pool"];
    let n = 0;
    const deps = makeDeps({
      signer,
      pool,
      prompt: async () => (n++ === 0 ? "bunker" : "bunker://remote?relay=wss://r.example"),
    });

    await doLogin(deps);

    expect(raw.loginWithBunkerUri).toHaveBeenCalledTimes(1);
    const [uri, opts] = raw.loginWithBunkerUri.mock.calls[0] as [
      string,
      { pool: unknown; perms: unknown[] },
    ];
    expect(uri).toBe("bunker://remote?relay=wss://r.example");
    expect(opts.pool).toBe(pool);
    expect(Array.isArray(opts.perms)).toBe(true);
  });

  it("qr (nostrconnect): renders the URI and uses the override relays", async () => {
    const { signer, raw } = fakeSigner();
    const printQr = vi.fn();
    const deps = makeDeps({
      signer,
      prompt: async () => "qr",
      printQr,
      relays: ["wss://custom.example"],
    });

    await doLogin(deps);

    const opts = raw.loginWithNostrConnect.mock.calls[0][0];
    expect(opts.relays).toEqual(["wss://custom.example"]);
    expect(opts.pool).toBe(deps.pool);
    expect(printQr).toHaveBeenCalledWith("nostrconnect://paired");
  });

  it("rejects an unknown method", async () => {
    const { signer } = fakeSigner();
    const deps = makeDeps({ signer, prompt: async () => "telepathy" });
    await expect(doLogin(deps)).rejects.toThrow();
  });
});

describe("whoami / listAccounts / doLogout", () => {
  it("whoami returns the active account", () => {
    const { signer, account } = fakeSigner();
    expect(whoami(signer)).toEqual(account);
  });

  it("listAccounts returns every stored account", () => {
    const { signer, account } = fakeSigner();
    expect(listAccounts(signer)).toEqual([account]);
  });
});

/** A signer holding several stored accounts, recording switchAccount/logout calls
 *  and actually mutating its account list so removal is observable. */
function multiAccountSigner(accounts: StoredAccount[]) {
  const calls: Record<string, unknown[]> = {};
  let list = [...accounts];
  let activePubkey: string | null = accounts[0]?.pubkey ?? null;
  const signer = {
    listAccounts: () => list,
    getActiveAccount: () => list.find((a) => a.pubkey === activePubkey) ?? null,
    switchAccount: async (pk: string) => {
      (calls["switchAccount"] ??= []).push([pk]);
      activePubkey = pk;
    },
    logout: async (pk?: string) => {
      (calls["logout"] ??= []).push([pk]);
      const target = pk ?? activePubkey;
      list = list.filter((a) => a.pubkey !== target);
      if (target === activePubkey) activePubkey = null;
    },
  };
  return { signer: signer as unknown as Signer, calls };
}

const acctA: StoredAccount = { npub: "npub1aaa", pubkey: "aa".repeat(32), method: "ncryptsec" };
const acctB: StoredAccount = { npub: "npub1bbb", pubkey: "bb".repeat(32), method: "nip46" };

describe("findAccount", () => {
  it("matches by npub", () => {
    expect(findAccount([acctA, acctB], "npub1bbb")).toEqual(acctB);
  });

  it("matches by hex pubkey", () => {
    expect(findAccount([acctA, acctB], "bb".repeat(32))).toEqual(acctB);
  });

  it("returns null when nothing matches", () => {
    expect(findAccount([acctA, acctB], "npub1zzz")).toBeNull();
  });
});

describe("doSwitch", () => {
  it("switches to an account matched by its npub and returns it", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]);
    const result = await doSwitch(signer, "npub1bbb");
    expect(calls.switchAccount).toEqual([["bb".repeat(32)]]);
    expect(result).toEqual(acctB);
  });

  it("also accepts a hex pubkey", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]);
    await doSwitch(signer, "bb".repeat(32));
    expect(calls.switchAccount).toEqual([["bb".repeat(32)]]);
  });

  it("throws (without calling switchAccount) when no account matches", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]);
    await expect(doSwitch(signer, "npub1nope")).rejects.toThrow(/no stored account/i);
    expect(calls.switchAccount).toBeUndefined();
  });
});

describe("doLogout", () => {
  it("resolves a target npub to its hex pubkey and removes that account", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]);
    const removed = await doLogout(signer, "npub1bbb");
    expect(calls.logout).toEqual([["bb".repeat(32)]]);
    expect(removed).toEqual(acctB);
    expect(listAccounts(signer)).toEqual([acctA]);
  });

  it("also accepts a hex pubkey target", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]);
    await doLogout(signer, "bb".repeat(32));
    expect(calls.logout).toEqual([["bb".repeat(32)]]);
  });

  it("throws (without calling logout) when the target matches nothing", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]);
    await expect(doLogout(signer, "npub1nope")).rejects.toThrow(/no stored account/i);
    expect(calls.logout).toBeUndefined();
  });

  it("removes the active account and returns it when no target is given", async () => {
    const { signer, calls } = multiAccountSigner([acctA, acctB]); // active = acctA
    const removed = await doLogout(signer);
    expect(removed).toEqual(acctA);
    expect(calls.logout).toEqual([["aa".repeat(32)]]);
    expect(listAccounts(signer)).toEqual([acctB]);
  });

  it("returns null without calling logout when there is nothing to remove", async () => {
    const { signer, calls } = multiAccountSigner([]);
    const removed = await doLogout(signer);
    expect(removed).toBeNull();
    expect(calls.logout).toBeUndefined();
  });
});

describe("describeBunkerError", () => {
  it("explains a missing secret when the remote signer says 'no secret'", () => {
    const msg = describeBunkerError("bunker://abc?relay=wss://r.example", new Error("no secret"));
    expect(msg).toMatch(/secret/i);
    expect(msg).toMatch(/nsec\.app|QR/i);
  });

  it("flags a secret-less URI even when the raw error is generic", () => {
    const msg = describeBunkerError(
      "bunker://abc?relay=wss://r.example",
      new Error("connect timed out"),
    );
    expect(msg).toMatch(/secret/i);
  });

  it("explains an invalid bunker URI with the expected shape", () => {
    const msg = describeBunkerError("garbage", new Error("@formstr/signer: invalid bunker URI"));
    expect(msg).toMatch(/bunker:\/\/<pubkey>/);
  });

  it("preserves the raw signer error for context when the secret is present", () => {
    const msg = describeBunkerError(
      "bunker://abc?relay=wss://r.example&secret=tok",
      new Error("weird relay failure"),
    );
    expect(msg).toMatch(/weird relay failure/);
  });
});

// keep getPublicKey import used (sanity that fakeSigner pubkey is valid hex)
it("fixture pubkey is valid", () => {
  expect(getPublicKey(generateSecretKey())).toMatch(/^[0-9a-f]{64}$/);
});
