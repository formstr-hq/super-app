import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildMcpSigner } from "../src/auth/mcpSigner";

const SAVED = { ...process.env };

beforeEach(() => {
  process.env.FORMSTR_MCP_KEYSTORE = "file";
  process.env.FORMSTR_MCP_PASSPHRASE = "test-pass";
  process.env.FORMSTR_MCP_CONFIG_DIR = mkdtempSync(join(tmpdir(), "fmcp-signer-"));
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("buildMcpSigner", () => {
  it("persists a created account to the keystore and re-hydrates it locked on reopen", async () => {
    const signer = await buildMcpSigner();
    const { npub } = await signer.createAccount("hunter2");
    expect(npub).toMatch(/^npub1/);
    expect(signer.listAccounts()).toHaveLength(1);
    expect(signer.getActiveSigner()).not.toBeNull();
    const pubkey = signer.getActiveAccount()!.pubkey;

    // A fresh process-equivalent: the account survives but starts locked.
    const reopened = await buildMcpSigner();
    const accounts = reopened.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].pubkey).toBe(pubkey);
    expect(accounts[0].method).toBe("ncryptsec");
    expect(reopened.getActiveAccount()!.pubkey).toBe(pubkey);
    expect(reopened.getActiveSigner()).toBeNull();
  });
});
