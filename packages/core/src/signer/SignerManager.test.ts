import { generateSecretKey } from "nostr-tools";
import { nsecEncode } from "nostr-tools/nip19";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignerUnavailableError } from "./errors";
import { SignerManager } from "./SignerManager";

describe("SignerManager", () => {
  beforeEach(() => {
    // jsdom isn't loaded; provide a minimal localStorage shim
    if (typeof localStorage === "undefined") {
      const store = new Map<string, string>();

      (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      };
    }
    localStorage.clear();
  });

  it("restore() with no saved state resolves to ready with no pubkey", async () => {
    const mgr = new SignerManager();
    await mgr.restore();
    expect(mgr.getState()).toEqual({
      signer: null,
      pubkey: null,
      method: null,
      ready: true,
    });
  });

  it("loginWithNip46 sets signer + pubkey + method from the injected builder", async () => {
    const mgr = new SignerManager();
    const fakeSigner = {
      getPublicKey: async () => "remotePk",
      signEvent: async () => ({}) as any,
    } as any;
    const build = vi.fn().mockResolvedValue(fakeSigner);

    await mgr.loginWithNip46(
      { clientSecretKey: "00".repeat(32), remoteSignerPubkey: "rs", relays: ["wss://r"] },
      build,
    );

    expect(build).toHaveBeenCalledOnce();
    expect(mgr.getState().method).toBe("nip46");
    expect(mgr.getPublicKey()).toBe("remotePk");
    expect(mgr.getSignerIfAvailable()).toBe(fakeSigner);
  });

  it("loginWithNsec persists method+pubkey and notifies observers", async () => {
    const mgr = new SignerManager();
    const observer = vi.fn();
    mgr.onChange(observer);

    const sk = generateSecretKey();
    const nsec = nsecEncode(sk);
    await mgr.loginWithNsec(nsec);

    expect(mgr.getPublicKey()).toBeTypeOf("string");
    expect(localStorage.getItem("formstr:signer-method")).toBe("local");
    expect(localStorage.getItem("formstr:pubkey")).toBe(mgr.getPublicKey());
    expect(observer).toHaveBeenCalled();
  });

  it("logout() clears state and zeros LocalSigner secret", async () => {
    const mgr = new SignerManager();
    await mgr.loginWithNsec(nsecEncode(generateSecretKey()));
    const before = mgr.getPublicKey();
    expect(before).toBeTruthy();

    mgr.logout();
    expect(mgr.getState()).toEqual({
      signer: null,
      pubkey: null,
      method: null,
      ready: true,
    });
    expect(localStorage.getItem("formstr:client-secret")).toBeNull();
  });

  it("getSigner() throws typed SignerUnavailableError when no signer + no modal", async () => {
    const mgr = new SignerManager();
    await mgr.restore();
    await expect(mgr.getSigner()).rejects.toBeInstanceOf(SignerUnavailableError);
    await expect(mgr.getSigner()).rejects.toMatchObject({ code: "no-modal" });
  });

  it("restore() does not load a secret if method is missing", async () => {
    localStorage.setItem("formstr:client-secret", "00".repeat(32));
    // intentionally no method/pubkey
    const mgr = new SignerManager();
    await mgr.restore();
    expect(mgr.getState().signer).toBeNull();
  });

  it("getSignerIfAvailable() returns null when no signer", async () => {
    const mgr = new SignerManager();
    await mgr.restore();
    expect(mgr.getSignerIfAvailable()).toBeNull();
  });

  it("getSignerIfAvailable() returns signer after login", async () => {
    const mgr = new SignerManager();
    await mgr.loginWithNsec(nsecEncode(generateSecretKey()));
    expect(mgr.getSignerIfAvailable()).not.toBeNull();
  });

  it("getSigner() returns signer when logged in", async () => {
    const mgr = new SignerManager();
    await mgr.loginWithNsec(nsecEncode(generateSecretKey()));
    const signer = await mgr.getSigner();
    expect(signer).not.toBeNull();
    expect(await signer.getPublicKey()).toBe(mgr.getPublicKey());
  });

  it("getSigner() uses loginModalCallback when no signer", async () => {
    const mgr = new SignerManager();
    await mgr.restore();
    const mockSigner = {
      getPublicKey: async () => "bb".repeat(32),
      signEvent: async () => {
        throw new Error("not used");
      },
    };
    mgr.registerLoginModal(async () => mockSigner as never);
    const signer = await mgr.getSigner();
    expect(await signer.getPublicKey()).toBe("bb".repeat(32));
  });

  it("onChange() returns an unsubscribe function", async () => {
    const mgr = new SignerManager();
    const observer = vi.fn();
    const unsub = mgr.onChange(observer);
    await mgr.restore();
    const callsBefore = observer.mock.calls.length;
    unsub();
    mgr.logout(); // would notify if still subscribed
    expect(observer.mock.calls.length).toBe(callsBefore);
  });

  it("createGuestAccount() sets method=guest", async () => {
    const mgr = new SignerManager();
    await mgr.createGuestAccount();
    expect(mgr.getState().method).toBe("guest");
    expect(mgr.getPublicKey()).toBeTypeOf("string");
  });
});
