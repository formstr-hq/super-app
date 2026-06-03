import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { type Credential } from "../src/auth/credential";
import { createKeystore, credentialsFileMode, credentialsFilePath } from "../src/auth/keystore";

const A: Credential = { method: "local", pubkey: "aa".repeat(32), nsec: "nsec1a" };
const B: Credential = { method: "local", pubkey: "bb".repeat(32), nsec: "nsec1b" };

const SAVED = { ...process.env };

beforeEach(() => {
  // Force the encrypted-file backend into an isolated temp dir (no keychain in tests).
  process.env.FORMSTR_MCP_KEYSTORE = "file";
  process.env.FORMSTR_MCP_PASSPHRASE = "test-pass";
  process.env.FORMSTR_MCP_CONFIG_DIR = mkdtempSync(join(tmpdir(), "fmcp-ks-"));
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("keystore (encrypted-file backend)", () => {
  it("round-trips set/get and tracks the default", async () => {
    const ks = createKeystore();
    await ks.set(A);
    expect(await ks.get()).toEqual(A); // default
    expect(await ks.get(A.pubkey)).toEqual(A);
    expect(await ks.list()).toEqual([A.pubkey]);
  });

  it("a second set switches the default; remove falls back to a remaining account", async () => {
    const ks = createKeystore();
    await ks.set(A);
    await ks.set(B);
    expect((await ks.get())!.pubkey).toBe(B.pubkey);
    await ks.remove(B.pubkey);
    expect((await ks.get())!.pubkey).toBe(A.pubkey);
    expect(await ks.list()).toEqual([A.pubkey]);
  });

  it("removing the last credential leaves get() null", async () => {
    const ks = createKeystore();
    await ks.set(A);
    await ks.remove(A.pubkey);
    expect(await ks.get()).toBeNull();
    expect(await ks.list()).toEqual([]);
  });

  it("writes the encrypted credentials file with 0600 perms", async () => {
    const ks = createKeystore();
    await ks.set(A);
    expect(existsSync(credentialsFilePath())).toBe(true);
    expect(credentialsFileMode()).toBe(0o600);
  });
});
