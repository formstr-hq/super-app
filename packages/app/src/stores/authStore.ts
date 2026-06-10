import { fetchProfile, type NostrProfile } from "@formstr/agent/services/profile";
import type { NostrSigner, SignerMethod } from "@formstr/core";
import { signerManager } from "@formstr/core";
import { encryptSecretKey, hexToBytes, type StoredAccount } from "@formstr/signer";
import { nip19 } from "nostr-tools";
import { create } from "zustand";

import { appSigner } from "../auth/appSigner";
import {
  clearLegacySession,
  legacyNeedsMigration,
  readLegacySession,
  type LegacySession,
} from "../auth/legacySession";
import { mapMethod } from "../auth/methodMap";
import { toNostrSigner } from "../auth/toNostrSigner";

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
  /** Kind-0 profile of the active account (best-effort; null when logged out). */
  profile: NostrProfile | null;

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

export const useAuthStore = create<AuthStore>((set, get) => {
  let profileLoadedFor: string | null = null;

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
      if (active.pubkey !== profileLoadedFor) {
        profileLoadedFor = active.pubkey;
        void fetchProfile(active.pubkey)
          .then((profile) => {
            if (get().pubkey === active.pubkey) set({ profile });
          })
          .catch(() => {});
      }
    } else {
      signerManager.logout();
      profileLoadedFor = null;
      set({
        accounts,
        pubkey: null,
        method: null,
        isLoggedIn: false,
        locked: false,
        profile: null,
      });
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
    profile: null,

    async init() {
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

      const legacy = readLegacySession();
      if (legacyNeedsMigration(legacy)) {
        // Surface a one-time prompt; completeLegacyMigration() finishes it. The
        // secret is captured in state here, before sync()/logout wipes localStorage.
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
      return appSigner.createAccount(passphrase);
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
