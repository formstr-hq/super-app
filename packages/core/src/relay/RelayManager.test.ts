import { beforeEach, describe, expect, it } from "vitest";

import { RelayManager } from "./RelayManager";

describe("RelayManager", () => {
  let mgr: RelayManager;

  beforeEach(() => {
    mgr = new RelayManager();
  });

  it("falls back to defaults when user relays empty", () => {
    expect(mgr.getReadRelays()).toContain("wss://relay.damus.io");
    expect(mgr.getReadRelays()).toContain("wss://nos.lol");
  });

  it("parses NIP-65 read/write markers", () => {
    mgr.setUserRelays([
      { url: "wss://r1", read: true, write: false },
      { url: "wss://r2", read: false, write: true },
      { url: "wss://r3", read: true, write: true },
    ]);
    expect(mgr.getReadRelays()).toEqual(["wss://r1", "wss://r3"]);
    expect(mgr.getWriteRelays()).toEqual(["wss://r2", "wss://r3"]);
  });

  it("getRelaysForModule returns the module-specific subset", () => {
    expect(mgr.getRelaysForModule("forms")).toContain("wss://relay.yakinonne.com");
    expect(mgr.getRelaysForModule("calendar")).toContain("wss://nostr.mom");
    expect(mgr.getRelaysForModule("polls")).toContain("wss://nostr-01.yakihonne.com");
  });

  it("dispose() resets to defaults", () => {
    mgr.setUserRelays([{ url: "wss://x", read: true, write: false }]);
    expect(mgr.getReadRelays()).toEqual(["wss://x"]);
    mgr.dispose();
    expect(mgr.getReadRelays()).toContain("wss://relay.damus.io");
  });
});
