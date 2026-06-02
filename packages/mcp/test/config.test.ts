import { describe, it, expect } from "vitest";

import { resolveConfig, redact } from "../src/config";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

describe("resolveConfig", () => {
  it("reads nsec from env", () => {
    const cfg = resolveConfig({ argv: [], env: { FORMSTR_NSEC: NSEC } });
    expect(cfg.nsec).toBe(NSEC);
    expect(cfg.allowWrites).toBe(false);
  });

  it("CLI flag overrides env for nsec and enables writes", () => {
    const cfg = resolveConfig({
      argv: ["--nsec", NSEC, "--allow-writes"],
      env: { FORMSTR_NSEC: "nsec1ignored" },
    });
    expect(cfg.nsec).toBe(NSEC);
    expect(cfg.allowWrites).toBe(true);
  });

  it("parses comma-separated relays from env", () => {
    const cfg = resolveConfig({
      argv: [],
      env: { FORMSTR_NSEC: NSEC, FORMSTR_RELAYS: "wss://a.example , wss://b.example" },
    });
    expect(cfg.relays).toEqual(["wss://a.example", "wss://b.example"]);
  });

  it("throws a clear error when nsec is missing", () => {
    expect(() => resolveConfig({ argv: [], env: {} })).toThrow(/nsec/i);
  });

  it("redact hides all but the prefix", () => {
    expect(redact(NSEC)).toBe("nsec1…");
    expect(redact(undefined)).toBe("(none)");
  });
});
