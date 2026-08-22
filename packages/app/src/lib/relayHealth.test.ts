import { beforeEach, describe, expect, it, vi } from "vitest";

const listConnectionStatus = vi.fn();

vi.mock("@formstr/core", () => ({
  defaultNostrRuntime: { pool: { listConnectionStatus: () => listConnectionStatus() } },
}));

import { readRelayHealth, setRelayHealthReader } from "./relayHealth";

beforeEach(() => {
  vi.clearAllMocks();
  setRelayHealthReader(null);
  listConnectionStatus.mockReturnValue(new Map());
});

describe("readRelayHealth", () => {
  it("reports the SimplePool's connection status when no reader is installed", async () => {
    listConnectionStatus.mockReturnValue(
      new Map([
        ["wss://a.test", true],
        ["wss://b.test", false],
      ]),
    );

    expect([...(await readRelayHealth())]).toEqual([
      ["wss://a.test", true],
      ["wss://b.test", false],
    ]);
  });

  it("prefers an installed reader over the pool", async () => {
    listConnectionStatus.mockReturnValue(new Map([["wss://pool.test", true]]));
    setRelayHealthReader(async () => new Map([["wss://worker.test", true]]));

    expect([...(await readRelayHealth())]).toEqual([["wss://worker.test", true]]);
    expect(listConnectionStatus).not.toHaveBeenCalled();
  });

  it("falls back to the pool when the installed reader fails", async () => {
    // The worker answers over a message channel, which can be torn down between
    // the poll firing and the reply. A dead indicator is worse than a stale one.
    listConnectionStatus.mockReturnValue(new Map([["wss://pool.test", true]]));
    setRelayHealthReader(async () => {
      throw new Error("channel closed");
    });

    expect([...(await readRelayHealth())]).toEqual([["wss://pool.test", true]]);
  });

  it("clears the reader when it is uninstalled", async () => {
    setRelayHealthReader(async () => new Map([["wss://worker.test", true]]));
    setRelayHealthReader(null);
    listConnectionStatus.mockReturnValue(new Map([["wss://pool.test", true]]));

    expect([...(await readRelayHealth())]).toEqual([["wss://pool.test", true]]);
  });
});
