import type { SignerState, SignerMethod } from "@formstr/core";
import { signerManager } from "@formstr/core";
import { create } from "zustand";

interface AuthStore {
  pubkey: string | null;
  method: SignerMethod | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  init(): Promise<void>;
  loginWithNsec(nsec: string): Promise<void>;
  loginWithNip07(): Promise<void>;
  loginAsGuest(): Promise<void>;
  logout(): void;
}

export const useAuthStore = create<AuthStore>((set) => {
  // Mirror SignerManager state into the store — single source of truth.
  signerManager.onChange((state: SignerState) => {
    set({
      pubkey: state.pubkey,
      method: state.method,
      isLoggedIn: state.pubkey !== null,
      isLoading: false,
    });
  });

  return {
    pubkey: null,
    method: null,
    isLoggedIn: false,
    isLoading: false, // App renders instantly; identity restores in background.

    async init() {
      // Don't set isLoading: true — proposal requires instant render.
      await signerManager.restore();
      // onChange has already pushed state — no manual getState() needed.
    },

    async loginWithNsec(nsec: string) {
      set({ isLoading: true });
      try {
        await signerManager.loginWithNsec(nsec);
      } finally {
        set({ isLoading: false });
      }
    },

    async loginWithNip07() {
      set({ isLoading: true });
      try {
        await signerManager.loginWithNip07();
      } finally {
        set({ isLoading: false });
      }
    },

    async loginAsGuest() {
      set({ isLoading: true });
      try {
        await signerManager.createGuestAccount();
      } finally {
        set({ isLoading: false });
      }
    },

    logout() {
      signerManager.logout();
    },
  };
});
