import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it, expect } from "vitest";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

// process.env has string|undefined values; StdioClientTransport requires Record<string,string>
const safeEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

async function toolNames(args: string[]): Promise<Set<string>> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js", ...args],
    env: { ...safeEnv, FORMSTR_NSEC: NSEC },
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
