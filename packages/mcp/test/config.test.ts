import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

import { type Credential } from "../src/auth/credential";
import { type Keystore } from "../src/auth/keystore";
import { type Cli } from "../src/cli";
import { resolveConfig, redact } from "../src/config";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

const baseCli = (over: Partial<Cli> = {}): Cli => ({ command: "run", allowWrites: false, ...over });

const emptyKeystore = (): Keystore => ({
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  list: async () => [],
});

const keystoreWith = (cred: Credential): Keystore => ({
  get: async () => cred,
  set: async () => {},
  remove: async () => {},
  list: async () => [cred.pubkey],
});

// A config dir guaranteed to contain no config.json, so the file path can't interfere.
const HERMETIC = { FORMSTR_MCP_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fmcp-")) };

describe("resolveConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("uses a plaintext nsec from env and warns loudly", async () => {
    const cfg = await resolveConfig(
      baseCli(),
      { ...HERMETIC, FORMSTR_NSEC: NSEC },
      emptyKeystore(),
    );
    expect(cfg.source).toBe("plaintext");
    expect(cfg.credential.method).toBe("local");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("PLAINTEXT"));
  });

  it("CLI nsec overrides env and enables writes", async () => {
    const cfg = await resolveConfig(
      baseCli({ nsec: NSEC, allowWrites: true }),
      { ...HERMETIC, FORMSTR_NSEC: "nsec1ignored" },
      emptyKeystore(),
    );
    expect(cfg.allowWrites).toBe(true);
    expect(cfg.source).toBe("plaintext");
  });

  it("parses comma-separated relays from env", async () => {
    const cfg = await resolveConfig(
      baseCli(),
      { ...HERMETIC, FORMSTR_NSEC: NSEC, FORMSTR_RELAYS: "wss://a.example , wss://b.example" },
      emptyKeystore(),
    );
    expect(cfg.relays).toEqual(["wss://a.example", "wss://b.example"]);
  });

  it("falls back to the keystore credential when no plaintext key is present", async () => {
    const cred: Credential = { method: "local", pubkey: "ab".repeat(32), nsec: NSEC };
    const cfg = await resolveConfig(baseCli(), { ...HERMETIC }, keystoreWith(cred));
    expect(cfg.source).toBe("keystore");
    expect(cfg.credential.pubkey).toBe(cred.pubkey);
  });

  it("uses the keystore nip46 relays when none are configured", async () => {
    const cred: Credential = {
      method: "nip46",
      pubkey: "ab".repeat(32),
      clientSecretKey: "00".repeat(32),
      remoteSignerPubkey: "cd".repeat(32),
      relays: ["wss://signer.example"],
    };
    const cfg = await resolveConfig(baseCli(), { ...HERMETIC }, keystoreWith(cred));
    expect(cfg.relays).toEqual(["wss://signer.example"]);
  });

  it("throws a clear 'login' error when nothing is available", async () => {
    await expect(resolveConfig(baseCli(), { ...HERMETIC }, emptyKeystore())).rejects.toThrow(
      /login/i,
    );
  });

  it("redact hides all but the prefix", () => {
    expect(redact(NSEC)).toBe("nsec1…");
    expect(redact(undefined)).toBe("(none)");
  });
});
