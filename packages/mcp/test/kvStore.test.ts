import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createKeystoreStorage, keystoreFileMode, keystoreFilePath } from "../src/auth/kvStore";

const SAVED = { ...process.env };

beforeEach(() => {
  // Force the encrypted-file backend into an isolated temp dir (no keychain in tests).
  process.env.FORMSTR_MCP_KEYSTORE = "file";
  process.env.FORMSTR_MCP_PASSPHRASE = "test-pass";
  process.env.FORMSTR_MCP_CONFIG_DIR = mkdtempSync(join(tmpdir(), "fmcp-kv-"));
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("createKeystoreStorage (encrypted-file backend)", () => {
  it("round-trips set/get/remove synchronously", async () => {
    const kv = await createKeystoreStorage();
    expect(kv.get("missing")).toBeNull();
    kv.set("accounts", '[{"pubkey":"ab"}]');
    expect(kv.get("accounts")).toBe('[{"pubkey":"ab"}]');
    kv.remove("accounts");
    expect(kv.get("accounts")).toBeNull();
  });

  it("persists across a reopen", async () => {
    const first = await createKeystoreStorage();
    first.set("active-pubkey", "deadbeef");
    const second = await createKeystoreStorage();
    expect(second.get("active-pubkey")).toBe("deadbeef");
  });

  it("writes the encrypted keystore file with 0600 perms and never in plaintext", async () => {
    const kv = await createKeystoreStorage();
    kv.set("active-pubkey", "deadbeef");
    expect(existsSync(keystoreFilePath())).toBe(true);
    expect(keystoreFileMode()).toBe(0o600);
    expect(readFileSync(keystoreFilePath(), "utf8")).not.toContain("deadbeef");
  });

  it("requires a passphrase to save on the file backend", async () => {
    delete process.env.FORMSTR_MCP_PASSPHRASE;
    const kv = await createKeystoreStorage();
    expect(() => kv.set("k", "v")).toThrow(/passphrase|FORMSTR_MCP_PASSPHRASE/i);
  });
});
