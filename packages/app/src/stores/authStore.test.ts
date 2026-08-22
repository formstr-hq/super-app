import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

// ── Mock the @formstr/signer-backed appSigner ────────────────────────────────
// Hoisted so the (hoisted) vi.mock factories below can reference them safely.
type Account = { pubkey: string; npub: string; method: string; nip46?: any; ncryptsec?: string };
const { signerState, emit, mgr, signerPool, sessions } = vi.hoisted(() => {
  const signerState: {
    accounts: Account[];
    active: string | null;
    unlocked: boolean;
    listeners: Array<(e: any) => void>;
  } = { accounts: [], active: null, unlocked: false, listeners: [] };
  const emit = (e: any) => signerState.listeners.forEach((cb) => cb(e));
  const mgr = {
    setActiveSigner: vi.fn(),
    logout: vi.fn(),
    registerLoginModal: vi.fn(),
    getSignerIfAvailable: vi.fn(() => null),
  };
  // Stand-in for core's signerPool — the SimplePool the nip46 silent resume
  // (appSigner.unlock({ pool })) needs to subscribe for bunker responses. Signer
  // transport has its own pool precisely so swapping the app's network runtime
  // cannot take bunker logins down with it.
  const signerPool = { tag: "signer-pool" };
  // Local relay sessions need a Worker, which jsdom has not got. Record the
  // start/close calls instead — the behaviour under test is the store's, not
  // the worker's.
  const sessions: {
    started: string[];
    closed: string[];
    purged: string[];
    watched: Array<string | null>;
  } = {
    started: [],
    closed: [],
    purged: [],
    watched: [],
  };
  return { signerState, emit, mgr, signerPool, sessions };
});

vi.mock("../auth/appSigner", () => ({
  appSigner: {
    listAccounts: () => [...signerState.accounts],
    getActiveAccount: () =>
      signerState.accounts.find((a) => a.pubkey === signerState.active) ?? null,
    getActiveSigner: () =>
      signerState.unlocked
        ? { getPublicKey: async () => signerState.active, signEvent: async () => ({}) }
        : null,
    onChange: (cb: (e: any) => void) => {
      signerState.listeners.push(cb);
      return () => {};
    },
    loginWithExtension: vi.fn(async () => {
      const acc = { pubkey: "extPk", npub: "npub-ext", method: "extension" };
      signerState.accounts.push(acc);
      signerState.active = "extPk";
      signerState.unlocked = true;
      emit({ type: "login", account: acc });
    }),
    loginWithNcryptsec: vi.fn(async () => {
      signerState.unlocked = true;
      const acc = signerState.accounts.find((a) => a.pubkey === signerState.active);
      emit({ type: "switch", account: acc });
    }),
    // The legacy nip46 resume path (must NOT be used anymore — replaying a
    // nostrconnect:// pairing URI throws "invalid bunker URI").
    loginWithBunkerUri: vi.fn(async () => {
      signerState.unlocked = true;
      emit({
        type: "switch",
        account: signerState.accounts.find((a) => a.pubkey === signerState.active),
      });
    }),
    // The 0.2.x silent-resume path: rebuild the runtime signer from persisted
    // nip46 state using the relay pool. Returns the ActiveSigner (or null).
    unlock: vi.fn(async () => {
      signerState.unlocked = true;
      const acc = signerState.accounts.find((a) => a.pubkey === signerState.active);
      emit({ type: "switch", account: acc });
      return { getPublicKey: async () => signerState.active, signEvent: async () => ({}) };
    }),
    createAccount: vi.fn(async () => ({ npub: "npub-new", ncryptsec: "ncryptsec1new" })),
    switchAccount: vi.fn(async (pk: string) => {
      signerState.active = pk;
      signerState.unlocked = false;
      emit({ type: "switch", account: signerState.accounts.find((a) => a.pubkey === pk) });
    }),
    logout: vi.fn(async (pk?: string) => {
      const target = pk ?? signerState.active;
      signerState.accounts = signerState.accounts.filter((a) => a.pubkey !== target);
      if (signerState.active === target) {
        signerState.active = null;
        signerState.unlocked = false;
      }
      emit({ type: "logout", pubkey: target });
    }),
  },
}));

// ── Mock the core signerManager (capture injections) ─────────────────────────
vi.mock("@formstr/core", () => ({ signerManager: mgr, signerPool }));

vi.mock("../lib/localRelay/session", () => ({
  startLocalRelaySession: (pubkey: string) => {
    sessions.started.push(pubkey);
    return { dataLayer: {}, close: () => sessions.closed.push(pubkey) };
  },
}));

vi.mock("../lib/localRelay/purge", () => ({
  purgeAccountCache: (pubkey: string) => sessions.purged.push(pubkey),
}));

// Live sync opens real subscriptions through the runtime; record the retargets
// instead. What the store owes it is the account changes, nothing more.
vi.mock("../lib/live/controller", () => ({
  retargetLiveSync: (pubkey: string | null) => sessions.watched.push(pubkey),
}));

vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn(async (pubkey: string) => ({
    pubkey,
    displayName: "Naman",
    picture: "https://example.com/p.jpg",
    createdAt: 1,
  })),
}));

import * as profileService from "@formstr/agent/services/profile";

import { useAuthStore } from "./authStore";

beforeEach(() => {
  signerState.accounts = [];
  signerState.active = null;
  signerState.unlocked = false;
  signerState.listeners = [];
  localStorage.clear();
  sessions.started.length = 0;
  sessions.closed.length = 0;
  sessions.watched.length = 0;
  sessions.purged.length = 0;
  vi.clearAllMocks();
  useAuthStore.setState({
    accounts: [],
    pubkey: null,
    method: null,
    isLoggedIn: false,
    locked: false,
    isLoading: false,
    legacyMigration: null,
    authModalOpen: false,
    authModalMode: "login",
    profile: null,
  });
});

describe("authStore bridge", () => {
  it("init with no accounts → logged out, registers the login modal", async () => {
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().isLoggedIn).toBe(false);
    expect(mgr.registerLoginModal).toHaveBeenCalledTimes(1);
  });

  it("init with a locked ncryptsec account → shown but locked (null signer injected)", async () => {
    signerState.accounts = [
      { pubkey: "ncPk", npub: "npub-nc", method: "ncryptsec", ncryptsec: "ncryptsec1x" },
    ];
    signerState.active = "ncPk";
    signerState.unlocked = false;
    await useAuthStore.getState().init();
    const s = useAuthStore.getState();
    expect(s.isLoggedIn).toBe(true);
    expect(s.pubkey).toBe("ncPk");
    expect(s.locked).toBe(true);
    expect(mgr.setActiveSigner).toHaveBeenCalledWith(null, "local", "ncPk");
  });

  it("loginWithExtension injects an adapted signer and marks unlocked", async () => {
    await useAuthStore.getState().init();
    await useAuthStore.getState().loginWithExtension();
    const s = useAuthStore.getState();
    expect(s.pubkey).toBe("extPk");
    expect(s.method).toBe("nip07");
    expect(s.locked).toBe(false);
    const lastCall = mgr.setActiveSigner.mock.calls.at(-1)!;
    expect(lastCall[0]).not.toBeNull();
    expect(lastCall[1]).toBe("nip07");
    expect(lastCall[2]).toBe("extPk");
  });

  it("unlock(pubkey, passphrase) calls loginWithNcryptsec and injects the signer", async () => {
    signerState.accounts = [
      { pubkey: "ncPk", npub: "npub-nc", method: "ncryptsec", ncryptsec: "ncryptsec1x" },
    ];
    signerState.active = "ncPk";
    await useAuthStore.getState().init();
    await useAuthStore.getState().unlock("ncPk", "pw");
    const { appSigner } = await import("../auth/appSigner");
    expect(appSigner.loginWithNcryptsec).toHaveBeenCalledWith("ncryptsec1x", "pw");
    expect(useAuthStore.getState().locked).toBe(false);
  });

  // A nip46 account whose stored URI is a `nostrconnect://` (QR) pairing URI —
  // deliberately NOT a `bunker://` URI. Resuming it must use unlock({ pool }),
  // never loginWithBunkerUri (which re-parses the URI and throws "invalid bunker URI").
  const nip46Account = {
    pubkey: "rsPk",
    npub: "npub-rs",
    method: "nip46",
    nip46: {
      uri: "nostrconnect://abcd?relay=wss://r.example&secret=xyz",
      remoteSignerPubkey: "cd".repeat(32),
      relays: ["wss://r.example"],
      clientSecretKey: "00".repeat(32),
    },
  };

  const localAccount = (pubkey: string) => ({
    pubkey,
    npub: `npub-${pubkey}`,
    method: "ncryptsec",
    ncryptsec: "ncryptsec1x",
  });

  it("puts the app on a local relay session for the account that signs in", async () => {
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;

    await useAuthStore.getState().init();

    expect(sessions.started).toEqual(["aPk"]);
  });

  it("closes the previous account's session before opening the next", async () => {
    // Each account has its own cache namespace, so the worker cannot be shared.
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;
    await useAuthStore.getState().init();

    signerState.accounts = [localAccount("bPk")];
    signerState.active = "bPk";
    emit({ type: "login" });

    // Tail-relative: the store is a module singleton, so a session opened by an
    // earlier test may still be current when this one starts (and re-targeting
    // to the same account is deliberately a no-op).
    expect(sessions.closed.at(-1)).toBe("aPk");
    expect(sessions.started.at(-1)).toBe("bPk");
  });

  it("points live sync at the account, and at the next one on a switch", async () => {
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;
    await useAuthStore.getState().init();
    expect(sessions.watched.at(-1)).toBe("aPk");

    signerState.accounts = [localAccount("bPk")];
    signerState.active = "bPk";
    emit({ type: "login" });
    expect(sessions.watched.at(-1)).toBe("bPk");
  });

  it("stops live sync on logout", async () => {
    // Left running, it would keep refetching stores for an account that is no
    // longer signed in — and with no signer, every private read would fail.
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;
    await useAuthStore.getState().init();

    signerState.accounts = [];
    signerState.active = null;
    emit({ type: "logout" });

    expect(sessions.watched.at(-1)).toBeNull();
  });

  it("closes the session on logout", async () => {
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;
    await useAuthStore.getState().init();

    signerState.accounts = [];
    signerState.active = null;
    emit({ type: "logout" });

    expect(sessions.closed.at(-1)).toBe("aPk");
  });

  it("clears the signed-out account's cached events", async () => {
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;
    await useAuthStore.getState().init();

    signerState.accounts = [];
    signerState.active = null;
    emit({ type: "logout" });

    expect(sessions.purged).toEqual(["aPk"]);
  });

  it("keeps the other account's cache when switching between them", async () => {
    // Switching is not signing out: the account being left keeps its warm cache
    // so switching back is still instant.
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;
    await useAuthStore.getState().init();

    signerState.accounts = [localAccount("bPk")];
    signerState.active = "bPk";
    emit({ type: "login" });

    expect(sessions.purged).toEqual([]);
  });

  it("stays on the default runtime when the kill switch is off", async () => {
    localStorage.setItem("formstr.localRelay", "off");
    signerState.accounts = [localAccount("aPk")];
    signerState.active = "aPk";
    signerState.unlocked = true;

    await useAuthStore.getState().init();

    expect(sessions.started).toEqual([]);
  });

  it("init auto-unlocks a nip46 account via appSigner.unlock({ pool }) — not loginWithBunkerUri", async () => {
    signerState.accounts = [{ ...nip46Account }];
    signerState.active = "rsPk";
    signerState.unlocked = false;
    await useAuthStore.getState().init();
    const { appSigner } = await import("../auth/appSigner");
    expect(appSigner.unlock).toHaveBeenCalledTimes(1);
    expect(appSigner.unlock).toHaveBeenCalledWith({ pool: signerPool });
    expect(appSigner.loginWithBunkerUri).not.toHaveBeenCalled();
    expect(useAuthStore.getState().locked).toBe(false);
  });

  it("unlock(pubkey) resumes a nip46 account via appSigner.unlock({ pool }) — not loginWithBunkerUri", async () => {
    signerState.accounts = [{ ...nip46Account }];
    signerState.active = null; // not active at boot → no auto-unlock; isolate the manual call
    await useAuthStore.getState().init();
    await useAuthStore.getState().unlock("rsPk", "");
    const { appSigner } = await import("../auth/appSigner");
    expect(appSigner.unlock).toHaveBeenCalledTimes(1);
    expect(appSigner.unlock).toHaveBeenCalledWith({ pool: signerPool });
    expect(appSigner.loginWithBunkerUri).not.toHaveBeenCalled();
  });

  it("logout clears the active account and core signer", async () => {
    await useAuthStore.getState().init();
    await useAuthStore.getState().loginWithExtension();
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().isLoggedIn).toBe(false);
    expect(mgr.logout).toHaveBeenCalled();
  });

  it("init detects a legacy local key and surfaces a migration prompt", async () => {
    localStorage.setItem("formstr:signer-method", "guest");
    localStorage.setItem("formstr:pubkey", "oldPk");
    localStorage.setItem("formstr:client-secret", "deadbeef");
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().legacyMigration).toMatchObject({ method: "guest" });
  });
});

describe("kind-0 profile in authStore", () => {
  it("loads the active account's profile after login and clears it on logout", async () => {
    await useAuthStore.getState().init();
    await useAuthStore.getState().loginWithExtension();
    await new Promise((r) => setTimeout(r, 0));

    expect(profileService.fetchProfile).toHaveBeenCalledWith("extPk");
    expect(useAuthStore.getState().profile?.displayName).toBe("Naman");

    signerState.accounts = [];
    signerState.active = null;
    signerState.unlocked = false;
    emit({ type: "logout" });
    expect(useAuthStore.getState().profile).toBeNull();
  });

  it("does not refetch the profile on a sync that keeps the same pubkey", async () => {
    await useAuthStore.getState().init();
    await useAuthStore.getState().loginWithExtension();
    await new Promise((r) => setTimeout(r, 0));
    (profileService.fetchProfile as any).mockClear();

    emit({ type: "unlock" });
    await new Promise((r) => setTimeout(r, 0));
    expect(profileService.fetchProfile).not.toHaveBeenCalled();
  });
});
