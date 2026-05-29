import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @formstr/core before importing the store.
vi.mock("@formstr/core", () => {
  const observers: Array<(state: unknown) => void> = [];
  const state: { signer: null; pubkey: string | null; method: string | null; ready: boolean } = {
    signer: null,
    pubkey: null,
    method: null,
    ready: false,
  };
  return {
    signerManager: {
      restore: vi.fn(async () => {
        state.ready = true;
        observers.forEach((cb) => cb({ ...state }));
      }),
      loginWithNsec: vi.fn(async () => {
        state.pubkey = "abc";
        state.method = "local";
        observers.forEach((cb) => cb({ ...state }));
      }),
      loginWithNip07: vi.fn(async () => {
        state.pubkey = "def";
        state.method = "nip07";
        observers.forEach((cb) => cb({ ...state }));
      }),
      createGuestAccount: vi.fn(async () => {
        state.pubkey = "ghi";
        state.method = "guest";
        observers.forEach((cb) => cb({ ...state }));
      }),
      logout: vi.fn(() => {
        state.pubkey = null;
        state.method = null;
        observers.forEach((cb) => cb({ ...state }));
      }),
      onChange: (cb: (state: unknown) => void) => {
        observers.push(cb);
        return () => {
          const i = observers.indexOf(cb);
          if (i >= 0) observers.splice(i, 1);
        };
      },
      getState: () => ({ ...state }),
    },
  };
});

import { useAuthStore } from "./authStore";

import { signerManager } from "@formstr/core";

describe("authStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ pubkey: null, method: null, isLoggedIn: false, isLoading: false });
    vi.clearAllMocks();
  });

  it("init() does not flip isLoading to true (app renders instantly)", async () => {
    const before = useAuthStore.getState().isLoading;
    expect(before).toBe(false);
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(signerManager.restore).toHaveBeenCalled();
  });

  it("loginWithNsec sets pubkey via onChange subscriber", async () => {
    await useAuthStore.getState().loginWithNsec("nsec1xxx");
    expect(useAuthStore.getState().pubkey).toBe("abc");
    expect(useAuthStore.getState().isLoggedIn).toBe(true);
  });

  it("loginAsGuest sets method=guest", async () => {
    await useAuthStore.getState().loginAsGuest();
    expect(useAuthStore.getState().method).toBe("guest");
  });

  it("logout clears state", async () => {
    await useAuthStore.getState().loginWithNip07();
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().pubkey).toBeNull();
    expect(useAuthStore.getState().isLoggedIn).toBe(false);
  });
});
