import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSigner } from "@formstr/signer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it, expect, beforeAll } from "vitest";

import { createKeystoreStorage } from "../src/auth/kvStore";
import { buildServer } from "../src/server";

// The server now boots from the encrypted keystore (no plaintext nsec). Seed a
// temp keystore with an ncryptsec account and unlock it at boot via the passphrase
// envs — the same headless path operators use.
const NCRYPTSEC_PASS = "ncryptsec-boot-pass";
const bootEnv: Record<string, string> = {
  FORMSTR_MCP_KEYSTORE: "file",
  FORMSTR_MCP_CONFIG_DIR: mkdtempSync(join(tmpdir(), "fmcp-smoke-")),
  FORMSTR_MCP_PASSPHRASE: "file-backend-pass",
  FORMSTR_MCP_NCRYPTSEC_PASSPHRASE: NCRYPTSEC_PASS,
};

beforeAll(async () => {
  Object.assign(process.env, bootEnv);
  const signer = createSigner({ storage: await createKeystoreStorage(), appName: "smoke-test" });
  await signer.createAccount(NCRYPTSEC_PASS);
});

function spawnEnv(): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  return { ...base, ...bootEnv };
}

async function toolNames(args: string[]): Promise<Set<string>> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js", ...args],
    env: spawnEnv(),
  });
  const client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return new Set(tools.map((t) => t.name));
}

describe("smoke: stdio handshake", () => {
  it("read-only mode hides gated tools", async () => {
    const names = await toolNames([]);
    expect(names.has("list_forms")).toBe(true);
    expect(names.has("create_form")).toBe(true);
    expect(names.has("import_form_from_naddr")).toBe(true); // writes only to your own list
    expect(names.has("delete_form")).toBe(false);
    expect(names.has("submit_form_response")).toBe(false);
    expect(names.has("update_form")).toBe(false);
    expect(names.has("share_form")).toBe(false);
  }, 30_000);

  it("--allow-writes exposes gated tools", async () => {
    const names = await toolNames(["--allow-writes"]);
    expect(names.has("delete_form")).toBe(true);
    expect(names.has("update_form")).toBe(true);
    expect(names.has("share_form")).toBe(true);
    expect(names.has("rsvp_event")).toBe(true);
    expect(names.has("submit_poll_response")).toBe(true);
  }, 30_000);
});

describe("buildServer", () => {
  const count = (s: ReturnType<typeof buildServer>): number =>
    Object.keys(
      (s as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {},
    ).length;

  it("registers fewer tools in read-only mode than with writes", () => {
    const ro = buildServer({ allowWrites: false });
    const rw = buildServer({ allowWrites: true });
    expect(count(rw)).toBeGreaterThan(count(ro));
  });

  it("registers all 51 tools with writes enabled", () => {
    expect(count(buildServer({ allowWrites: true }))).toBe(51);
  });
});
