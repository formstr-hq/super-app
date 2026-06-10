import { describe, it, expect } from "vitest";

import { type Cli } from "../src/cli";
import { resolveConfig } from "../src/config";

const baseCli = (over: Partial<Cli> = {}): Cli => ({ command: "run", allowWrites: false, ...over });

describe("resolveConfig", () => {
  it("passes the --account selector through (undefined by default)", () => {
    expect(resolveConfig(baseCli(), {}).account).toBeUndefined();
    expect(resolveConfig(baseCli({ account: "ab".repeat(32) }), {}).account).toBe("ab".repeat(32));
  });

  it("resolves relays from --relays over FORMSTR_RELAYS", () => {
    const cfg = resolveConfig(baseCli({ relays: ["wss://cli.example"] }), {
      FORMSTR_RELAYS: "wss://env.example",
    });
    expect(cfg.relays).toEqual(["wss://cli.example"]);
  });

  it("parses comma-separated relays from FORMSTR_RELAYS when no flag is given", () => {
    const cfg = resolveConfig(baseCli(), {
      FORMSTR_RELAYS: "wss://a.example , wss://b.example",
    });
    expect(cfg.relays).toEqual(["wss://a.example", "wss://b.example"]);
  });

  it("carries allowWrites and ignores any FORMSTR_NSEC", () => {
    const cfg = resolveConfig(baseCli({ allowWrites: true }), { FORMSTR_NSEC: "nsec1whatever" });
    expect(cfg.allowWrites).toBe(true);
    expect(cfg).not.toHaveProperty("credential");
    expect(JSON.stringify(cfg)).not.toContain("nsec");
  });
});
