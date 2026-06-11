import { describe, expect, it } from "vitest";

import { MODULE_DEFAULT_RELAYS } from "./module-defaults";

const normalize = (url: string) => url.replace(/\/+$/, "");

describe("MODULE_DEFAULT_RELAYS", () => {
  it("forms set matches the standalone formstr.app default relays exactly", () => {
    // upstream/nostr-forms/packages/formstr-app/src/nostr/common.ts defaultRelays
    const upstream = [
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://relay.nostr.wirednet.jp",
      "wss://nostr-01.yakihonne.com",
      "wss://relay.snort.social",
      "wss://relay.nostr.band",
      "wss://nostr21.com",
    ];
    expect([...MODULE_DEFAULT_RELAYS.forms].map(normalize).sort()).toEqual(upstream.sort());
  });

  it("calendar set is a superset of calendar.formstr.app's default relays", () => {
    // upstream/nostr-calendar/src/common/nostr.ts defaultRelays
    const upstream = [
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://relay.nostr.wirednet.jp",
      "wss://nostr-01.yakihonne.com",
      "wss://relay.snort.social",
      "wss://nostr21.com",
    ];
    const ours = new Set([...MODULE_DEFAULT_RELAYS.calendar].map(normalize));
    for (const relay of upstream) expect(ours.has(relay)).toBe(true);
  });
});
