import { describe, it, expect } from "vitest";

import { parseCli, splitRelays } from "../src/cli";

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
