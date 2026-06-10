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
const { signerState, emit, mgr } = vi.hoisted(() => {
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
  return { signerState, emit, mgr };
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
vi.mock("@formstr/core", () => ({ signerManager: mgr }));

import { useAuthStore } from "./authStore";

beforeEach(() => {
  signerState.accounts = [];
  signerState.active = null;
  signerState.unlocked = false;
  signerState.listeners = [];
  localStorage.clear();
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
