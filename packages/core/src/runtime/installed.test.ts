import type { Event, Filter } from "nostr-tools";
import { describe, it, expect, afterEach } from "vitest";

import type { NostrRuntimeContract } from "./contract";
import { nostrRuntime, setNostrRuntime, resetNostrRuntime } from "./installed";

/** A contract implementation that records what it was asked to do. */
function recorder() {
  const calls: Array<{ method: string; relays: string[] }> = [];
  const impl: NostrRuntimeContract = {
    subscribe: (relays) => {
      calls.push({ method: "subscribe", relays });
      return { unsub: () => {} };
    },
    fetchOne: async (relays: string[], _filter: Filter) => {
      calls.push({ method: "fetchOne", relays });
      return null;
    },
    querySync: async (relays: string[], _filter: Filter) => {
      calls.push({ method: "querySync", relays });
      return [];
    },
    publish: async (relays: string[], _event: Event) => {
      calls.push({ method: "publish", relays });
    },
    dispose: () => {
      calls.push({ method: "dispose", relays: [] });
    },
  };
  return { calls, impl };
}

describe("the installed runtime", () => {
  afterEach(() => {
    resetNostrRuntime();
  });

  it("routes calls to whichever implementation is installed", async () => {
    const { calls, impl } = recorder();
    setNostrRuntime(impl);

    await nostrRuntime.querySync(["wss://kanban"], { kinds: [30301] });

    expect(calls).toEqual([{ method: "querySync", relays: ["wss://kanban"] }]);
  });

  it("keeps working for modules that captured the singleton before installation", async () => {
    // Agent services import `nostrRuntime` at module load, long before the app
    // decides which backend to install. The reference they hold must follow.
    const captured = nostrRuntime;
    const { calls, impl } = recorder();

    setNostrRuntime(impl);
    await captured.publish(["wss://kanban"], {} as Event);

    expect(calls).toEqual([{ method: "publish", relays: ["wss://kanban"] }]);
  });

  it("falls back to the default SimplePool runtime when nothing is installed", () => {
    // MCP never installs anything: Node has no Worker, so it must keep the
    // default rather than fail.
    expect(() => nostrRuntime.subscribe(["wss://a"], [{ kinds: [1] }]).unsub()).not.toThrow();
  });
});
