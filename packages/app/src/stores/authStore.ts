import { create } from "zustand";
import type { SignerState, SignerMethod } from "@formstr/core";
import { signerManager } from "@formstr/core";

interface AuthStore {
  pubkey: string | null;
  method: SignerMethod | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  // Actions
  init(): Promise<void>;
  loginWithNsec(nsec: string): Promise<void>;
  loginWithNip07(): Promise<void>;
  loginAsGuest(): Promise<void>;
  logout(): void;
}

export const useAuthStore = create<AuthStore>((set) => {
  // Subscribe to signer state changes
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
    isLoading: true,

    async init() {
      set({ isLoading: true });
      await signerManager.restoreFromStorage();
      const state = signerManager.getState();
      set({
        pubkey: state.pubkey,
        method: state.method,
        isLoggedIn: state.pubkey !== null,
        isLoading: false,
      });
    },

    async loginWithNsec(nsec: string) {
      set({ isLoading: true });
      await signerManager.loginWithNsec(nsec);
    },

    async loginWithNip07() {
      set({ isLoading: true });
      await signerManager.loginWithNip07();
    },

    async loginAsGuest() {
      set({ isLoading: true });
      await signerManager.createGuestAccount();
    },

    logout() {
      signerManager.logout();
      set({ pubkey: null, method: null, isLoggedIn: false });
    },
  };
});
