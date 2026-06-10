# @formstr/signer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the super-app's bespoke web login/identity with the published `@formstr/signer@0.1.0` (NIP-07/46/49, multi-account, encrypted-at-rest), bridged into the existing `@formstr/core` `signerManager` so all services and the MCP keep working unchanged.

**Architecture:** App-scoped bridge. `@formstr/signer` is added only to `packages/app` and owns identity/accounts/login/unlock. The app adapts its unlocked `ActiveSigner` to the core `NostrSigner` contract and injects it into `signerManager` via a new nullable `setActiveSigner`. Core's `NostrSigner`/`signerManager`/concrete signers are otherwise untouched (MCP-safe). Local keys become NIP-49 ncryptsec (passphrase); accounts re-hydrate locked and unlock on demand through the existing blocking-`getSigner` → login-modal mechanism.

**Tech Stack:** TypeScript, React 18 + MUI, zustand, `@formstr/signer`, `@formstr/core`, `nostr-tools`, vitest (app = jsdom, core = node).

**Spec:** `docs/superpowers/specs/2026-06-09-signer-package-integration-design.md`

**Deviation from spec §4.2 (intentional):** The bridge does **not** reuse `DeferredSigner`. A non-null `DeferredSigner` in `signerManager` would make `getSigner()` return it immediately and never trigger the unlock modal for a locked ncryptsec account. Instead, "locked" = `signerManager` has `pubkey`+`method` set but `signer === null`; the first blocking `getSigner()` opens the unlock modal. Instant render comes from the store's `pubkey`. `DeferredSigner` stays in core for the MCP/other internal use.

---

## File Structure

**Create:**

- `packages/app/src/auth/appSigner.ts` — the single `@formstr/signer` `Signer` instance.
- `packages/app/src/auth/toNostrSigner.ts` — `ActiveSigner` → core `NostrSigner` adapter.
- `packages/app/src/auth/toNostrSigner.test.ts`
- `packages/app/src/auth/legacySession.ts` — read/clear pre-integration localStorage session.
- `packages/app/src/auth/legacySession.test.ts`
- `packages/app/src/auth/methodMap.ts` — `@formstr/signer` `LoginMethod` → core `SignerMethod`.
- `packages/app/src/components/UnlockDialog.tsx` — passphrase / reconnect prompt for a locked account.

**Modify:**

- `packages/core/src/signer/SignerManager.ts` — add nullable `setActiveSigner`.
- `packages/core/src/signer/SignerManager.test.ts` — cover `setActiveSigner`.
- `packages/app/src/stores/authStore.ts` — rewritten as the bridge + modal controller + account actions.
- `packages/app/src/stores/authStore.test.ts` — rewritten against the new store.
- `packages/app/src/components/LoginDialog.tsx` — rebuilt: extension / create / import / bunker / QR.
- `packages/app/src/layout/AppShell.tsx` — render dialogs from store state; register login modal.
- `packages/app/src/layout/Header.tsx` — multi-account switcher in the avatar menu.
- `packages/app/package.json` — add `@formstr/signer`.

**Untouched (verified):** all `services/*`, `nip59`, `DriveSignerAdapter`, core's `LocalSigner`/`NIP07Signer`/`NIP46Signer`/`DeferredSigner`, MCP.

---

## Task 1: Add dependency + `appSigner` singleton

**Files:**

- Modify: `packages/app/package.json`
- Create: `packages/app/src/auth/appSigner.ts`

- [ ] **Step 1: Install the package**

Run: `pnpm --filter @formstr/app add @formstr/signer@^0.1.0`
Expected: adds `"@formstr/signer": "^0.1.0"` to `packages/app/package.json` dependencies; lockfile updates.

- [ ] **Step 2: Create the singleton**

`packages/app/src/auth/appSigner.ts`:

```ts
import { createSigner, type Signer } from "@formstr/signer";

/**
 * The app's single @formstr/signer instance — owns identity, accounts, and
 * persistence (localStorage under the "formstr:signer:" prefix). `appName` is
 * required for the nostrconnect (NIP-46 QR) flow; remote signers show it on the
 * consent screen.
 */
export const appSigner: Signer = createSigner({
  appName: "Formstr",
  appUrl: typeof window !== "undefined" ? window.location.origin : undefined,
  storageKeyPrefix: "formstr:signer:",
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @formstr/app exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/app/package.json pnpm-lock.yaml packages/app/src/auth/appSigner.ts
git commit -m "feat(app): add @formstr/signer dependency + appSigner singleton"
```

---

## Task 2: `SignerManager.setActiveSigner` (nullable, core)

**Files:**

- Modify: `packages/core/src/signer/SignerManager.ts`
- Test: `packages/core/src/signer/SignerManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("SignerManager", ...)` block in `SignerManager.test.ts`:

```ts
it("setActiveSigner sets state, persists method+pubkey (no secret), and notifies", () => {
  const mgr = new SignerManager();
  const fake = {
    getPublicKey: async () => "pk",
    signEvent: async () => ({}) as any,
  } as any;
  const seen: Array<{ pubkey: string | null; method: string | null }> = [];
  mgr.onChange((s) => seen.push({ pubkey: s.pubkey, method: s.method }));

  mgr.setActiveSigner(fake, "nip07", "pk123");

  expect(mgr.getSignerIfAvailable()).toBe(fake);
  expect(mgr.getState()).toMatchObject({ pubkey: "pk123", method: "nip07", ready: true });
  expect(localStorage.getItem("formstr:pubkey")).toBe("pk123");
  expect(localStorage.getItem("formstr:signer-method")).toBe("nip07");
  expect(localStorage.getItem("formstr:client-secret")).toBeNull();
  expect(seen.at(-1)).toEqual({ pubkey: "pk123", method: "nip07" });
});

it("setActiveSigner(null, …) is a locked state: pubkey set but no signer", () => {
  const mgr = new SignerManager();
  mgr.setActiveSigner(null, "local", "lockedPk");
  expect(mgr.getSignerIfAvailable()).toBeNull();
  expect(mgr.getState()).toMatchObject({ pubkey: "lockedPk", method: "local", ready: true });
});

it("locked getSigner() (signer null) routes to the registered login modal", async () => {
  const mgr = new SignerManager();
  const resolved = {
    getPublicKey: async () => "pk",
    signEvent: async () => ({}) as any,
  } as any;
  mgr.registerLoginModal(async () => resolved);
  mgr.setActiveSigner(null, "local", "lockedPk");
  await expect(mgr.getSigner()).resolves.toBe(resolved);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @formstr/core test -- SignerManager`
Expected: FAIL — `setActiveSigner is not a function`.

- [ ] **Step 3: Implement**

In `packages/core/src/signer/SignerManager.ts`, add this method to the `SignerManager` class (e.g. directly after `loginWithNip07`):

```ts
  /**
   * Inject an externally-managed active signer. The web app drives identity via
   * `@formstr/signer` and pushes the unlocked signer in here. Pass `null` for a
   * locked account: `pubkey`/`method` are set (so the UI shows the account) but
   * `getSigner()` will route to the login/unlock modal. Persists method+pubkey
   * only — never any secret.
   */
  setActiveSigner(signer: NostrSigner | null, method: SignerMethod, pubkey: string): void {
    this.signer = signer;
    this.method = method;
    this.pubkey = pubkey;
    this.ready = true;
    this.persist();
    this.notify();
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @formstr/core test -- SignerManager`
Expected: PASS (all, including the three new cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/signer/SignerManager.ts packages/core/src/signer/SignerManager.test.ts
git commit -m "feat(core): SignerManager.setActiveSigner (nullable = locked) for app injection"
```

---

## Task 3: `toNostrSigner` adapter (app)

**Files:**

- Create: `packages/app/src/auth/toNostrSigner.ts`
- Test: `packages/app/src/auth/toNostrSigner.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/app/src/auth/toNostrSigner.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { toNostrSigner } from "./toNostrSigner";

function fakeActive() {
  const calls: string[] = [];
  const active = {
    getPublicKey: async () => "pk",
    signEvent: async (e: any) => ({ ...e, id: "id", sig: "sig", pubkey: "pk" }),
    nip04Encrypt: async (p: string, t: string) => {
      calls.push(`04e:${p}:${t}`);
      return "c04";
    },
    nip04Decrypt: async () => {
      calls.push("04d");
      return "p04";
    },
    nip44Encrypt: async () => {
      calls.push("44e");
      return "c44";
    },
    nip44Decrypt: async () => {
      calls.push("44d");
      return "p44";
    },
  };
  return { active, calls };
}

describe("toNostrSigner", () => {
  it("passes through getPublicKey + signEvent", async () => {
    const { active } = fakeActive();
    const s = toNostrSigner(active as any);
    expect(await s.getPublicKey()).toBe("pk");
    const signed = await s.signEvent({ kind: 1, content: "x", tags: [], created_at: 0 });
    expect(signed.id).toBe("id");
  });

  it("maps NIP-04 encrypt/decrypt onto the package's nip04* names", async () => {
    const { active, calls } = fakeActive();
    const s = toNostrSigner(active as any);
    expect(await s.encrypt!("peer", "hi")).toBe("c04");
    expect(await s.decrypt!("peer", "c")).toBe("p04");
    expect(calls).toContain("04e:peer:hi");
    expect(calls).toContain("04d");
  });

  it("passes NIP-44 through unchanged", async () => {
    const { active, calls } = fakeActive();
    const s = toNostrSigner(active as any);
    expect(await s.nip44Encrypt!("peer", "hi")).toBe("c44");
    expect(await s.nip44Decrypt!("peer", "c")).toBe("p44");
    expect(calls).toEqual(expect.arrayContaining(["44e", "44d"]));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @formstr/app test -- toNostrSigner`
Expected: FAIL — cannot find `./toNostrSigner`.

- [ ] **Step 3: Implement**

`packages/app/src/auth/toNostrSigner.ts`:

```ts
import type { NostrSigner } from "@formstr/core";
import type { ActiveSigner } from "@formstr/signer";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";

/**
 * Adapt a `@formstr/signer` `ActiveSigner` to the super-app's `NostrSigner`
 * contract. Two gaps to close:
 *  - NIP-04 is named `nip04Encrypt/Decrypt` there vs `encrypt/decrypt` here.
 *  - `ActiveSigner.signEvent` returns a complete `NostrEvent`; our interface
 *    types it as `VerifiedEvent`. The signer finalized/relayed a full event, so
 *    the boundary cast is safe.
 */
export function toNostrSigner(active: ActiveSigner): NostrSigner {
  return {
    getPublicKey: () => active.getPublicKey(),
    signEvent: (event: EventTemplate) => active.signEvent(event) as Promise<VerifiedEvent>,
    encrypt: (pubkey: string, plaintext: string) => active.nip04Encrypt(pubkey, plaintext),
    decrypt: (pubkey: string, ciphertext: string) => active.nip04Decrypt(pubkey, ciphertext),
    nip44Encrypt: (pubkey: string, plaintext: string) => active.nip44Encrypt(pubkey, plaintext),
    nip44Decrypt: (pubkey: string, ciphertext: string) => active.nip44Decrypt(pubkey, ciphertext),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @formstr/app test -- toNostrSigner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/auth/toNostrSigner.ts packages/app/src/auth/toNostrSigner.test.ts
git commit -m "feat(app): ActiveSigner -> NostrSigner adapter"
```

---

## Task 4: Legacy session module + method map (app)

**Files:**

- Create: `packages/app/src/auth/methodMap.ts`
- Create: `packages/app/src/auth/legacySession.ts`
- Test: `packages/app/src/auth/legacySession.test.ts`

- [ ] **Step 1: Create the method map (no test needed — exhaustive switch)**

`packages/app/src/auth/methodMap.ts`:

```ts
import type { SignerMethod } from "@formstr/core";
import type { LoginMethod } from "@formstr/signer";

/** Map a `@formstr/signer` LoginMethod to the core SignerMethod the app/UI uses. */
export function mapMethod(method: LoginMethod): SignerMethod {
  switch (method) {
    case "extension":
      return "nip07";
    case "nip46":
      return "nip46";
    case "ncryptsec":
      return "local";
    case "android":
      return "nip55";
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/app/src/auth/legacySession.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";

import { readLegacySession, clearLegacySession, legacyNeedsMigration } from "./legacySession";

describe("legacySession", () => {
  beforeEach(() => localStorage.clear());

  it("readLegacySession returns null when nothing is stored", () => {
    expect(readLegacySession()).toBeNull();
  });

  it("readLegacySession reads method/pubkey/secret", () => {
    localStorage.setItem("formstr:signer-method", "guest");
    localStorage.setItem("formstr:pubkey", "pk1");
    localStorage.setItem("formstr:client-secret", "deadbeef");
    expect(readLegacySession()).toEqual({
      method: "guest",
      pubkey: "pk1",
      secretHex: "deadbeef",
    });
  });

  it("legacyNeedsMigration is true only for local/guest with a stored secret", () => {
    expect(legacyNeedsMigration({ method: "guest", pubkey: "p", secretHex: "ab" })).toBe(true);
    expect(legacyNeedsMigration({ method: "local", pubkey: "p", secretHex: "ab" })).toBe(true);
    expect(legacyNeedsMigration({ method: "nip07", pubkey: "p", secretHex: null })).toBe(false);
    expect(legacyNeedsMigration({ method: "guest", pubkey: "p", secretHex: null })).toBe(false);
    expect(legacyNeedsMigration(null)).toBe(false);
  });

  it("clearLegacySession removes all three keys", () => {
    localStorage.setItem("formstr:signer-method", "guest");
    localStorage.setItem("formstr:pubkey", "pk1");
    localStorage.setItem("formstr:client-secret", "deadbeef");
    clearLegacySession();
    expect(localStorage.getItem("formstr:signer-method")).toBeNull();
    expect(localStorage.getItem("formstr:pubkey")).toBeNull();
    expect(localStorage.getItem("formstr:client-secret")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @formstr/app test -- legacySession`
Expected: FAIL — cannot find `./legacySession`.

- [ ] **Step 4: Implement**

`packages/app/src/auth/legacySession.ts`:

```ts
/**
 * Pre-@formstr/signer session keys written by the old SignerManager web path.
 * `client-secret` held the raw identity key in plaintext for local/guest — the
 * exact thing we're migrating away from.
 */
const KEY_METHOD = "formstr:signer-method";
const KEY_PUBKEY = "formstr:pubkey";
const KEY_SECRET = "formstr:client-secret";

export interface LegacySession {
  method: string;
  pubkey: string | null;
  secretHex: string | null;
}

/** Read a legacy session from localStorage, or null if there isn't one. */
export function readLegacySession(): LegacySession | null {
  if (typeof localStorage === "undefined") return null;
  const method = localStorage.getItem(KEY_METHOD);
  if (!method) return null;
  return {
    method,
    pubkey: localStorage.getItem(KEY_PUBKEY),
    secretHex: localStorage.getItem(KEY_SECRET),
  };
}

/** True when the session holds a raw key that must be encrypted (local/guest). */
export function legacyNeedsMigration(session: LegacySession | null): boolean {
  return (
    !!session && (session.method === "local" || session.method === "guest") && !!session.secretHex
  );
}

/** Remove all legacy signer keys. Idempotent. */
export function clearLegacySession(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY_METHOD);
  localStorage.removeItem(KEY_PUBKEY);
  localStorage.removeItem(KEY_SECRET);
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @formstr/app test -- legacySession`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/auth/methodMap.ts packages/app/src/auth/legacySession.ts packages/app/src/auth/legacySession.test.ts
git commit -m "feat(app): legacy-session reader + method map for signer migration"
```

---

## Task 5: Rewrite `authStore` as the bridge

**Files:**

- Modify: `packages/app/src/stores/authStore.ts`
- Test: `packages/app/src/stores/authStore.test.ts` (replace contents)

The store owns: zustand UI state (accounts, active pubkey/method, locked, isLoggedIn, migration + modal state), all login/account actions on top of `appSigner`, a `signerManager.onChange`→nothing (we push, not mirror) and an `appSigner.onChange`→`sync()` subscription, the `registerLoginModal` blocking-`getSigner` resolver, and one-time legacy migration in `init()`.

- [ ] **Step 1: Write the failing tests**

Replace the contents of `packages/app/src/stores/authStore.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the @formstr/signer-backed appSigner ────────────────────────────────
type Account = { pubkey: string; npub: string; method: string; nip46?: any; ncryptsec?: string };
const signerState: {
  accounts: Account[];
  active: string | null;
  unlocked: boolean;
  listeners: Array<(e: any) => void>;
} = { accounts: [], active: null, unlocked: false, listeners: [] };

function emit(e: any) {
  signerState.listeners.forEach((cb) => cb(e));
}

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
const mgr = {
  setActiveSigner: vi.fn(),
  logout: vi.fn(),
  registerLoginModal: vi.fn(),
  getSignerIfAvailable: vi.fn(() => null),
};
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
    // last setActiveSigner call carries a real (non-null) signer
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @formstr/app test -- authStore`
Expected: FAIL — the store has no `accounts`/`locked`/`init`-with-bridge behavior yet.

- [ ] **Step 3: Implement the store**

Replace the entire contents of `packages/app/src/stores/authStore.ts` with:

```ts
import type { NostrSigner, SignerMethod } from "@formstr/core";
import { signerManager } from "@formstr/core";
import { encryptSecretKey, hexToBytes, type StoredAccount } from "@formstr/signer";
import { nip19 } from "nostr-tools";
import { create } from "zustand";

import { appSigner } from "../auth/appSigner";
import { clearLegacySession, legacyNeedsMigration, readLegacySession } from "../auth/legacySession";
import { mapMethod } from "../auth/methodMap";
import { toNostrSigner } from "../auth/toNostrSigner";
import type { LegacySession } from "../auth/legacySession";

export interface AccountView {
  pubkey: string;
  npub: string;
  method: SignerMethod;
  locked: boolean;
}

interface AuthStore {
  accounts: AccountView[];
  pubkey: string | null;
  method: SignerMethod | null;
  isLoggedIn: boolean;
  locked: boolean;
  isLoading: boolean;
  legacyMigration: LegacySession | null;
  authModalOpen: boolean;
  authModalMode: "login" | "unlock";

  init(): Promise<void>;
  loginWithExtension(): Promise<void>;
  createAccount(passphrase: string): Promise<{ npub: string; ncryptsec: string }>;
  importKey(input: string, passphrase: string): Promise<void>;
  loginWithBunkerUri(uri: string): Promise<void>;
  loginWithNostrConnect(opts: { relays: string[]; onUri: (uri: string) => void }): Promise<void>;
  switchAccount(pubkey: string): Promise<void>;
  unlock(pubkey: string, passphrase: string): Promise<void>;
  logout(pubkey?: string): Promise<void>;
  completeLegacyMigration(passphrase: string): Promise<void>;
  dismissLegacyMigration(): void;
  openAuthModal(mode: "login" | "unlock"): void;
  closeAuthModal(): void;
}

// Resolvers for blocking signerManager.getSigner() calls waiting on an unlock.
let pendingResolvers: Array<(signer: NostrSigner) => void> = [];
let subscribed = false;

export const useAuthStore = create<AuthStore>((set, get) => {
  /** Push appSigner's current account/signer state into the store + signerManager. */
  function sync(): void {
    const active = appSigner.getActiveAccount();
    const activeSigner = appSigner.getActiveSigner();
    const accounts: AccountView[] = appSigner.listAccounts().map((a: StoredAccount) => ({
      pubkey: a.pubkey,
      npub: a.npub,
      method: mapMethod(a.method),
      locked: !(active && a.pubkey === active.pubkey && activeSigner !== null),
    }));

    if (active) {
      const method = mapMethod(active.method);
      if (activeSigner) {
        const adapted = toNostrSigner(activeSigner);
        signerManager.setActiveSigner(adapted, method, active.pubkey);
        const waiters = pendingResolvers;
        pendingResolvers = [];
        waiters.forEach((r) => r(adapted));
      } else {
        // Locked: show the account, but signing routes to the unlock modal.
        signerManager.setActiveSigner(null, method, active.pubkey);
      }
      set({
        accounts,
        pubkey: active.pubkey,
        method,
        isLoggedIn: true,
        locked: activeSigner === null,
        authModalOpen: activeSigner === null ? get().authModalOpen : false,
      });
    } else {
      signerManager.logout();
      set({ accounts, pubkey: null, method: null, isLoggedIn: false, locked: false });
    }
  }

  return {
    accounts: [],
    pubkey: null,
    method: null,
    isLoggedIn: false,
    locked: false,
    isLoading: false,
    legacyMigration: null,
    authModalOpen: false,
    authModalMode: "login",

    async init() {
      if (!subscribed) {
        subscribed = true;
        appSigner.onChange(() => sync());
        // Blocking write/read paths call signerManager.getSigner(); when locked,
        // open the unlock/login modal and resolve once a signer becomes available.
        signerManager.registerLoginModal(
          () =>
            new Promise<NostrSigner>((resolve) => {
              const existing = signerManager.getSignerIfAvailable();
              if (existing) {
                resolve(existing);
                return;
              }
              pendingResolvers.push(resolve);
              set({ authModalOpen: true, authModalMode: get().pubkey ? "unlock" : "login" });
            }),
        );
      }

      const legacy = readLegacySession();
      if (legacyNeedsMigration(legacy)) {
        // Surface a one-time prompt; completeLegacyMigration() finishes it.
        set({ legacyMigration: legacy });
      } else if (legacy) {
        // nip07 / nothing to encrypt — drop the old keys; user re-logs in.
        clearLegacySession();
      }

      sync();
      // Background auto-unlock for methods that don't need a passphrase.
      const active = appSigner.getActiveAccount();
      if (active && !appSigner.getActiveSigner()) {
        try {
          if (active.method === "extension") {
            await appSigner.loginWithExtension();
          } else if (active.method === "nip46" && active.nip46) {
            await appSigner.loginWithBunkerUri(active.nip46.uri, {
              clientSecretKey: hexToBytes(active.nip46.clientSecretKey),
            });
          }
        } catch {
          // Stay locked; the user can unlock manually.
        }
      }
    },

    async loginWithExtension() {
      await appSigner.loginWithExtension();
    },

    async createAccount(passphrase: string) {
      const result = await appSigner.createAccount(passphrase);
      return result;
    },

    async importKey(input: string, passphrase: string) {
      const trimmed = input.trim();
      let ncryptsec: string;
      if (trimmed.startsWith("ncryptsec1")) {
        ncryptsec = trimmed;
      } else {
        const secret = trimmed.startsWith("nsec1")
          ? (nip19.decode(trimmed).data as Uint8Array)
          : hexToBytes(trimmed);
        ncryptsec = encryptSecretKey(secret, passphrase);
      }
      await appSigner.loginWithNcryptsec(ncryptsec, passphrase);
    },

    async loginWithBunkerUri(uri: string) {
      await appSigner.loginWithBunkerUri(uri);
    },

    async loginWithNostrConnect(opts) {
      await appSigner.loginWithNostrConnect({ relays: opts.relays, onUri: opts.onUri });
    },

    async switchAccount(pubkey: string) {
      await appSigner.switchAccount(pubkey);
    },

    async unlock(pubkey: string, passphrase: string) {
      const account = appSigner.listAccounts().find((a) => a.pubkey === pubkey);
      if (!account) throw new Error("Account not found");
      if (appSigner.getActiveAccount()?.pubkey !== pubkey) {
        await appSigner.switchAccount(pubkey);
      }
      if (account.method === "ncryptsec" && account.ncryptsec) {
        await appSigner.loginWithNcryptsec(account.ncryptsec, passphrase);
      } else if (account.method === "extension") {
        await appSigner.loginWithExtension();
      } else if (account.method === "nip46" && account.nip46) {
        await appSigner.loginWithBunkerUri(account.nip46.uri, {
          clientSecretKey: hexToBytes(account.nip46.clientSecretKey),
        });
      }
    },

    async logout(pubkey?: string) {
      await appSigner.logout(pubkey);
    },

    async completeLegacyMigration(passphrase: string) {
      const legacy = get().legacyMigration;
      if (!legacy?.secretHex) return;
      const ncryptsec = encryptSecretKey(hexToBytes(legacy.secretHex), passphrase);
      await appSigner.loginWithNcryptsec(ncryptsec, passphrase);
      clearLegacySession();
      set({ legacyMigration: null });
    },

    dismissLegacyMigration() {
      clearLegacySession();
      set({ legacyMigration: null });
    },

    openAuthModal(mode) {
      set({ authModalOpen: true, authModalMode: mode });
    },

    closeAuthModal() {
      set({ authModalOpen: false });
    },
  };
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @formstr/app test -- authStore`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @formstr/app exec tsc --noEmit`
Expected: PASS. (If `nip19.decode(...).data` widens to a union, the `as Uint8Array` cast already narrows it.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/stores/authStore.ts packages/app/src/stores/authStore.test.ts
git commit -m "feat(app): authStore bridges @formstr/signer into signerManager (multi-account, locked/unlock)"
```

---

## Task 6: Rebuild `LoginDialog`

**Files:**

- Modify: `packages/app/src/components/LoginDialog.tsx` (replace contents)

This is UI (no component test per the standing directive); verify by typecheck + build. The dialog wires to the new `authStore` actions. Uses MUI + lucide, monochrome.

- [ ] **Step 1: Replace the component**

Replace the entire contents of `packages/app/src/components/LoginDialog.tsx` with:

```tsx
import { Box, Button, Dialog, DialogContent, Divider, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import QRCode from "qrcode";
import { Key, Puzzle, Radio, ScanLine, UserPlus } from "lucide-react";
import { useState } from "react";

import { useAuthStore } from "../stores";

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = null | "create" | "import" | "bunker" | "qr";

const NOSTRCONNECT_RELAY = "wss://relay.nsec.app";

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const {
    loginWithExtension,
    createAccount,
    importKey,
    loginWithBunkerUri,
    loginWithNostrConnect,
  } = useAuthStore();
  const theme = useTheme();

  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // create/import fields
  const [passphrase, setPassphrase] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [bunkerUri, setBunkerUri] = useState("");
  const [createdNcryptsec, setCreatedNcryptsec] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const reset = () => {
    setMode(null);
    setBusy(false);
    setError(null);
    setPassphrase("");
    setKeyInput("");
    setBunkerUri("");
    setCreatedNcryptsec(null);
    setQrDataUrl(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      PaperProps={{ sx: { width: "100%", maxWidth: 400, borderRadius: 2, overflow: "hidden" } }}
    >
      <Box
        sx={{
          bgcolor: "background.paper",
          borderBottom: `1px solid ${theme.palette.divider}`,
          px: 3,
          py: 2.5,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            bgcolor: "text.primary",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Radio size={16} style={{ color: theme.palette.background.default }} />
        </Box>
        <Typography variant="body1" fontWeight={600}>
          Sign in to Formstr
        </Typography>
      </Box>

      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {error && (
          <Box
            sx={{
              bgcolor: "error.main",
              color: "error.contrastText",
              borderRadius: 1,
              px: 2,
              py: 1,
              fontSize: 13,
            }}
          >
            {error}
          </Box>
        )}

        {/* Post-create backup panel */}
        {createdNcryptsec ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography variant="body2" fontWeight={600}>
              Save your encrypted key
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              This <strong>ncryptsec</strong> + your passphrase are the only way back into this
              account on another device. Store it somewhere safe.
            </Typography>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={createdNcryptsec}
              InputProps={{ readOnly: true, sx: { fontFamily: "monospace", fontSize: 12 } }}
            />
            <Button variant="contained" size="small" onClick={close}>
              Done
            </Button>
          </Box>
        ) : mode === null ? (
          <>
            {/* Extension — primary */}
            <RowButton
              icon={<Puzzle size={20} />}
              title={busy ? "Connecting…" : "Browser Extension"}
              subtitle="NIP-07 (Alby, nos2x, …)"
              primary
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await loginWithExtension();
                  close();
                })
              }
            />
            <Divider />
            <RowButton
              icon={<UserPlus size={20} />}
              title="Create new account"
              subtitle="Encrypted with a passphrase (NIP-49)"
              disabled={busy}
              onClick={() => {
                setMode("create");
                setError(null);
              }}
            />
            <RowButton
              icon={<Key size={20} />}
              title="Import private key"
              subtitle="nsec / hex / ncryptsec + passphrase"
              disabled={busy}
              onClick={() => {
                setMode("import");
                setError(null);
              }}
            />
            <RowButton
              icon={<Radio size={20} />}
              title="Remote signer (bunker)"
              subtitle="NIP-46 bunker:// URI"
              disabled={busy}
              onClick={() => {
                setMode("bunker");
                setError(null);
              }}
            />
            <RowButton
              icon={<ScanLine size={20} />}
              title="Remote signer (QR)"
              subtitle="nostrconnect:// pairing"
              disabled={busy}
              onClick={() => {
                setMode("qr");
                setError(null);
              }}
            />
          </>
        ) : mode === "create" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              type="password"
              label="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
            />
            <Button
              variant="contained"
              size="small"
              disabled={!passphrase || busy}
              onClick={() =>
                run(async () => {
                  const { ncryptsec } = await createAccount(passphrase);
                  setCreatedNcryptsec(ncryptsec);
                })
              }
            >
              {busy ? "Creating…" : "Create account"}
            </Button>
            <BackLink onClick={reset} />
          </Box>
        ) : mode === "import" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              label="nsec / hex / ncryptsec"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              inputProps={{ style: { fontFamily: "monospace", fontSize: 12 } }}
              autoFocus
            />
            <TextField
              size="small"
              fullWidth
              type="password"
              label="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              helperText="Encrypts the key at rest (and decrypts an ncryptsec)."
            />
            <Button
              variant="contained"
              size="small"
              disabled={!keyInput.trim() || !passphrase || busy}
              onClick={() =>
                run(async () => {
                  await importKey(keyInput, passphrase);
                  close();
                })
              }
            >
              {busy ? "Importing…" : "Import"}
            </Button>
            <BackLink onClick={reset} />
          </Box>
        ) : mode === "bunker" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              label="bunker:// URI"
              value={bunkerUri}
              onChange={(e) => setBunkerUri(e.target.value)}
              inputProps={{ style: { fontFamily: "monospace", fontSize: 12 } }}
              autoFocus
            />
            <Button
              variant="contained"
              size="small"
              disabled={!bunkerUri.trim() || busy}
              onClick={() =>
                run(async () => {
                  await loginWithBunkerUri(bunkerUri);
                  close();
                })
              }
            >
              {busy ? "Connecting…" : "Connect"}
            </Button>
            <BackLink onClick={reset} />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "center" }}>
            {qrDataUrl ? (
              <>
                <Box
                  component="img"
                  src={qrDataUrl}
                  alt="nostrconnect QR"
                  sx={{ width: 220, height: 220 }}
                />
                <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
                  Scan with your remote signer (Amber, …). Waiting for pairing…
                </Typography>
              </>
            ) : (
              <Button
                variant="contained"
                size="small"
                fullWidth
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await loginWithNostrConnect({
                      relays: [NOSTRCONNECT_RELAY],
                      onUri: async (uri) => setQrDataUrl(await QRCode.toDataURL(uri)),
                    });
                    close();
                  })
                }
              >
                {busy ? "Generating…" : "Generate pairing QR"}
              </Button>
            )}
            <BackLink onClick={reset} />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RowButton(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <Box
      onClick={props.disabled ? undefined : props.onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        border: `${props.primary ? 2 : 1}px solid ${props.primary ? theme.palette.text.primary : theme.palette.divider}`,
        borderRadius: 1.5,
        px: 2,
        py: 1.5,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{ color: "text.primary", flexShrink: 0, display: "flex" }}>{props.icon}</Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" fontWeight={500}>
          {props.title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.subtitle}
        </Typography>
      </Box>
    </Box>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Typography
      variant="caption"
      onClick={onClick}
      sx={{
        color: "text.secondary",
        cursor: "pointer",
        textAlign: "center",
        "&:hover": { color: "text.primary" },
      }}
    >
      ← Back
    </Typography>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @formstr/app exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `pnpm --filter @formstr/app build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/LoginDialog.tsx
git commit -m "feat(app): rebuild LoginDialog (extension / create / import / bunker / QR)"
```

---

## Task 7: `UnlockDialog` + AppShell modal wiring + registerLoginModal

**Files:**

- Create: `packages/app/src/components/UnlockDialog.tsx`
- Modify: `packages/app/src/layout/AppShell.tsx`

- [ ] **Step 1: Create UnlockDialog**

`packages/app/src/components/UnlockDialog.tsx`:

```tsx
import { Box, Button, Dialog, DialogContent, TextField, Typography } from "@mui/material";
import { useState } from "react";

import { useAuthStore } from "../stores";

interface UnlockDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Re-authenticate the locked active account. ncryptsec needs a passphrase;
 *  extension/nip46 just reconnect. */
export function UnlockDialog({ open, onClose }: UnlockDialogProps) {
  const { pubkey, method, unlock } = useAuthStore();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = pubkey ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : "";

  const run = async () => {
    if (!pubkey) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pubkey, passphrase);
      setPassphrase("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wrong passphrase");
    } finally {
      setBusy(false);
    }
  };

  const needsPassphrase = method === "local";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: "100%", maxWidth: 360, borderRadius: 2 } }}
    >
      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body1" fontWeight={600}>
          Unlock account
        </Typography>
        <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
          {short}
        </Typography>
        {error && (
          <Box
            sx={{
              bgcolor: "error.main",
              color: "error.contrastText",
              borderRadius: 1,
              px: 2,
              py: 1,
              fontSize: 13,
            }}
          >
            {error}
          </Box>
        )}
        {needsPassphrase && (
          <TextField
            size="small"
            fullWidth
            type="password"
            label="Passphrase"
            value={passphrase}
            autoFocus
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
        )}
        <Button
          variant="contained"
          size="small"
          disabled={busy || (needsPassphrase && !passphrase)}
          onClick={() => void run()}
        >
          {busy ? "Unlocking…" : needsPassphrase ? "Unlock" : "Reconnect signer"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire AppShell to store-driven modals**

In `packages/app/src/layout/AppShell.tsx`:

Add the import near the other component imports:

```tsx
import { UnlockDialog } from "../components/UnlockDialog";
```

Replace the local `loginOpen` state and the bottom `<LoginDialog .../>` usage. Change:

```tsx
const [loginOpen, setLoginOpen] = useState(false);
```

to read the modal state from the store:

```tsx
const authModalOpen = useAuthStore((s) => s.authModalOpen);
const authModalMode = useAuthStore((s) => s.authModalMode);
const openAuthModal = useAuthStore((s) => s.openAuthModal);
const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
```

Replace every `setLoginOpen(true)` with `openAuthModal("login")` (there are three: `sidebarContent`'s `onLoginClick`, `Header`'s `onLoginClick`, and `CommandPalette`'s `onLoginClick`). Replace the dialog block:

```tsx
<LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
```

with:

```tsx
      <LoginDialog
        open={authModalOpen && authModalMode === "login"}
        onClose={closeAuthModal}
      />
      <UnlockDialog
        open={authModalOpen && authModalMode === "unlock"}
        onClose={closeAuthModal}
      />
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @formstr/app exec tsc --noEmit && pnpm --filter @formstr/app build`
Expected: PASS. (If `useState` is now unused in AppShell, remove it from the React import to satisfy eslint/tsc.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/UnlockDialog.tsx packages/app/src/layout/AppShell.tsx
git commit -m "feat(app): UnlockDialog + store-driven auth modals (locked accounts re-auth on demand)"
```

---

## Task 8: Header multi-account switcher

**Files:**

- Modify: `packages/app/src/layout/Header.tsx`

- [ ] **Step 1: Update the avatar menu**

In `packages/app/src/layout/Header.tsx`:

Update the store hook line:

```tsx
const { pubkey, isLoggedIn, method, logout } = useAuthStore();
```

to:

```tsx
const { pubkey, isLoggedIn, accounts, logout, switchAccount, openAuthModal } = useAuthStore();
```

Update the lucide import to add `Plus` and `Lock`:

```tsx
import {
  Lock,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
```

Replace the contents of the `<Menu>...</Menu>` (the block currently holding the "Signed in via" box, Settings, and Logout) with:

```tsx
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Accounts
                </Typography>
              </Box>
              {accounts.map((acc) => (
                <MenuItem
                  key={acc.pubkey}
                  dense
                  selected={acc.pubkey === pubkey}
                  onClick={() => {
                    if (acc.pubkey !== pubkey) void switchAccount(acc.pubkey);
                    setAnchorEl(null);
                  }}
                  sx={{ gap: 1, fontSize: 12.5, fontFamily: "monospace" }}
                >
                  {acc.locked && <Lock size={12} />}
                  {`${acc.pubkey.slice(0, 8)}…${acc.pubkey.slice(-4)}`}
                </MenuItem>
              ))}
              <Divider />
              <MenuItem
                dense
                onClick={() => {
                  openAuthModal("login");
                  setAnchorEl(null);
                }}
                sx={{ gap: 1.5, fontSize: 13 }}
              >
                <Plus size={14} />
                Add account
              </MenuItem>
              <MenuItem
                dense
                onClick={() => {
                  navigate("/settings");
                  setAnchorEl(null);
                }}
                sx={{ gap: 1.5, fontSize: 13 }}
              >
                <Settings size={14} />
                Settings
              </MenuItem>
              <Divider />
              <MenuItem
                dense
                onClick={() => {
                  void logout();
                  setAnchorEl(null);
                }}
                sx={{ gap: 1.5, fontSize: 13, color: "error.main" }}
              >
                <LogOut size={14} />
                Log out
              </MenuItem>
```

(The `method` variable is no longer used; remove any now-dead reference. `shortPubkey` is still used for nothing here — if it becomes unused, delete its declaration to satisfy tsc.)

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @formstr/app exec tsc --noEmit && pnpm --filter @formstr/app build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/layout/Header.tsx
git commit -m "feat(app): multi-account switcher in the avatar menu"
```

---

## Task 9: Legacy-migration prompt UI

**Files:**

- Create: `packages/app/src/components/MigrationDialog.tsx`
- Modify: `packages/app/src/layout/AppShell.tsx`

- [ ] **Step 1: Create MigrationDialog**

`packages/app/src/components/MigrationDialog.tsx`:

```tsx
import { Box, Button, Dialog, DialogContent, TextField, Typography } from "@mui/material";
import { useState } from "react";

import { useAuthStore } from "../stores";

/** One-time prompt for users upgrading from the old plaintext-key storage:
 *  encrypt the existing key with a passphrase (NIP-49). */
export function MigrationDialog() {
  const { legacyMigration, completeLegacyMigration, dismissLegacyMigration } = useAuthStore();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = legacyMigration !== null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeLegacyMigration(passphrase);
      setPassphrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} PaperProps={{ sx: { width: "100%", maxWidth: 380, borderRadius: 2 } }}>
      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body1" fontWeight={600}>
          Secure your key
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Formstr now stores keys encrypted. Set a passphrase to protect your existing key — you'll
          enter it after each reload. Your unprotected key will be removed.
        </Typography>
        {error && (
          <Box
            sx={{
              bgcolor: "error.main",
              color: "error.contrastText",
              borderRadius: 1,
              px: 2,
              py: 1,
              fontSize: 13,
            }}
          >
            {error}
          </Box>
        )}
        <TextField
          size="small"
          fullWidth
          type="password"
          label="New passphrase"
          value={passphrase}
          autoFocus
          onChange={(e) => setPassphrase(e.target.value)}
        />
        <Button
          variant="contained"
          size="small"
          disabled={busy || !passphrase}
          onClick={() => void run()}
        >
          {busy ? "Securing…" : "Secure key"}
        </Button>
        <Typography
          variant="caption"
          onClick={() => dismissLegacyMigration()}
          sx={{ color: "text.secondary", cursor: "pointer", textAlign: "center" }}
        >
          Discard this key and sign in differently
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Render it in AppShell**

In `packages/app/src/layout/AppShell.tsx` add the import:

```tsx
import { MigrationDialog } from "../components/MigrationDialog";
```

and render it alongside the other dialogs (next to `<UnlockDialog .../>`):

```tsx
<MigrationDialog />
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @formstr/app exec tsc --noEmit && pnpm --filter @formstr/app build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/MigrationDialog.tsx packages/app/src/layout/AppShell.tsx
git commit -m "feat(app): one-time plaintext-key -> ncryptsec migration prompt"
```

---

## Task 10: Whole-repo green gate + manual QA

- [ ] **Step 1: Full test + typecheck + build**

Run: `pnpm -r test && pnpm -r typecheck && pnpm -r build`
Expected: all packages PASS. App test count increases by the new `toNostrSigner`/`legacySession`/`authStore` suites; core test count increases by the `setActiveSigner` cases. MCP/agent/core counts unchanged otherwise.

- [ ] **Step 2: Manual QA checklist (dev server)**

Run: `pnpm --filter @formstr/app dev`, then in the browser verify:

- Extension login (with Alby/nos2x) → signed in; reload → still signed in (silent re-grant).
- Create account → passphrase → ncryptsec backup shown → can create a form. Reload → account shown, **locked**; performing a write/opening own encrypted content → UnlockDialog → passphrase → proceeds.
- Import nsec + passphrase → signed in. Import ncryptsec + passphrase → signed in.
- Bunker URI connect; Remote QR generates a scannable code and pairs.
- Avatar menu: multiple accounts listed, lock icon on locked ones, switch works (new account starts locked), Add account opens LoginDialog, Log out removes the active account.
- Migration: with old `formstr:client-secret` present in localStorage (simulate via devtools), first load shows MigrationDialog; setting a passphrase encrypts + clears the plaintext key.
- No `formstr:client-secret` is ever written by the new paths (check Application → Local Storage).

- [ ] **Step 3: Final commit (if QA required fixes)**

```bash
git add -A
git commit -m "fix(app): signer integration QA fixes"
```

---

## Self-Review

**Spec coverage:** §3 decisions → Tasks 1–9 (full adoption ncryptsec: Task 5/6; multi-account: Task 8; app-scoped bridge: Tasks 1–5; React UI: Tasks 6–9; Android dropped: not built). §4 architecture/bridge → Tasks 2 (`setActiveSigner`), 3 (`toNostrSigner`), 5 (`authStore` wiring + auto-unlock + modal). §4.3 method map → Task 4. §5 UI → Tasks 6 (LoginDialog), 7 (UnlockDialog), 8 (switcher). §6 migration → Tasks 4 (logic) + 5 (`completeLegacyMigration`) + 9 (UI). §7 dependency → Task 1. §8 testing → Tasks 2–5 + Task 10 gate.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `setActiveSigner(signer: NostrSigner | null, method, pubkey)` used identically in Task 2 (def) and Task 5 (calls). `toNostrSigner(active): NostrSigner` consistent Tasks 3/5. `mapMethod(LoginMethod): SignerMethod` consistent Tasks 4/5. `AccountView { pubkey, npub, method, locked }` defined Task 5, consumed Task 8. Store actions (`openAuthModal`, `closeAuthModal`, `unlock`, `switchAccount`, `logout`, `completeLegacyMigration`, `dismissLegacyMigration`) defined Task 5, consumed Tasks 6–9.

**Deviation noted:** no `DeferredSigner` in the bridge (see header) — locked = `setActiveSigner(null, …)`.
