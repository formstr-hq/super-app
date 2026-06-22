import { describe, it, expect } from "vitest";

import { parseCli, splitRelays, helpText, formatFatal } from "../src/cli";

describe("parseCli", () => {
  it("defaults to the run command", () => {
    expect(parseCli([]).command).toBe("run");
    expect(parseCli(["--allow-writes"]).command).toBe("run");
  });

  it("recognizes the subcommands incl. accounts", () => {
    expect(parseCli(["login"]).command).toBe("login");
    expect(parseCli(["logout"]).command).toBe("logout");
    expect(parseCli(["whoami"]).command).toBe("whoami");
    expect(parseCli(["accounts"]).command).toBe("accounts");
  });

  it("parses the switch command with a positional target", () => {
    const cli = parseCli(["switch", "npub1abc"]);
    expect(cli.command).toBe("switch");
    expect(cli.target).toBe("npub1abc");
  });

  it("recognizes the help command and -h/--help", () => {
    expect(parseCli(["help"]).command).toBe("help");
    expect(parseCli(["-h"]).command).toBe("help");
    expect(parseCli(["--help"]).command).toBe("help");
    // --help anywhere wins, even after another subcommand
    expect(parseCli(["accounts", "--help"]).command).toBe("help");
  });

  it("parses --relays, --allow-writes, --account", () => {
    const cli = parseCli([
      "run",
      "--relays",
      "wss://a,wss://b",
      "--allow-writes",
      "--account",
      "abcd",
    ]);
    expect(cli.relays).toEqual(["wss://a", "wss://b"]);
    expect(cli.allowWrites).toBe(true);
    expect(cli.account).toBe("abcd");
  });

  it("no longer accepts --nsec", () => {
    const cli = parseCli(["run", "--nsec", "nsec1xyz"]);
    expect(cli).not.toHaveProperty("nsec");
    expect(JSON.stringify(cli)).not.toContain("nsec1xyz");
  });

  it("splitRelays trims and drops empties", () => {
    expect(splitRelays(" wss://a , , wss://b ")).toEqual(["wss://a", "wss://b"]);
    expect(splitRelays(undefined)).toBeUndefined();
    expect(splitRelays("")).toBeUndefined();
  });
});

describe("helpText", () => {
  it("lists every command and the main flags", () => {
    const text = helpText();
    for (const cmd of ["run", "login", "logout", "whoami", "accounts", "switch", "help"]) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain("--allow-writes");
    expect(text).toContain("--account");
    expect(text).toContain("FORMSTR_MCP_NCRYPTSEC_PASSPHRASE");
  });
});

describe("formatFatal", () => {
  it("returns just the message by default", () => {
    expect(formatFatal(new Error("boom"))).toBe("boom");
  });

  it("returns the full stack trace in debug mode", () => {
    const err = new Error("boom");
    expect(formatFatal(err, true)).toBe(err.stack);
    expect(formatFatal(err, true)).toContain("boom");
  });

  it("stringifies non-Error throwables", () => {
    expect(formatFatal("plain string")).toBe("plain string");
  });
});
