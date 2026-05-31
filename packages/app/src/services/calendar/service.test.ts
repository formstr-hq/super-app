import { signerManager, nostrRuntime, nip44SelfEncrypt } from "@formstr/core";
import type { Event } from "nostr-tools";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  signerManager: { getSigner: vi.fn() },
  nostrRuntime: { publish: vi.fn(), fetchOne: vi.fn(), querySync: vi.fn(), subscribe: vi.fn() },
  relayManager: { getRelaysForModule: vi.fn(() => ["wss://relay.test"]) },
  nip44SelfEncrypt: vi.fn(),
  nip44SelfDecrypt: vi.fn(),
  wrapEvent: vi.fn(),
  unwrapEvent: vi.fn(),
}));

import { fetchCalendarEventByCoordinate } from "./service";
import { CALENDAR_KINDS } from "./types";

const mockSigner = {
  getPublicKey: vi.fn().mockResolvedValue("aabbccdd"),
  signEvent: vi
    .fn()
    .mockImplementation((e: any) =>
      Promise.resolve({ ...e, id: "eid", sig: "sig", pubkey: "aabbccdd" }),
    ),
};

beforeEach(() => {
  vi.clearAllMocks();
  (signerManager.getSigner as any).mockResolvedValue(mockSigner);
  (nostrRuntime.publish as any).mockResolvedValue(undefined);
  (nostrRuntime.querySync as any).mockResolvedValue([]);
  (nip44SelfEncrypt as any).mockResolvedValue("enc");
});

describe("fetchCalendarEventByCoordinate", () => {
  it("returns null when no event matches", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([]);
    const result = await fetchCalendarEventByCoordinate("31923:formpub:abc12345");
    expect(result).toBeNull();
  });

  it("returns the parsed event on a hit", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "eid",
        pubkey: "formpub",
        kind: CALENDAR_KINDS.publicEvent,
        created_at: 1000,
        sig: "sig",
        content: "",
        tags: [
          ["d", "abc12345"],
          ["title", "Launch Party"],
          ["start", "1700000000"],
          ["end", "1700003600"],
        ],
      } satisfies Event,
    ]);
    const result = await fetchCalendarEventByCoordinate("31923:formpub:abc12345");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Launch Party");
    expect(result!.id).toBe("abc12345");
  });

  it("returns null on a malformed coordinate", async () => {
    expect(await fetchCalendarEventByCoordinate("garbage")).toBeNull();
  });
});
