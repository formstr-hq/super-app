import { nostrRuntime } from "@formstr/core";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/core", () => ({
  nostrRuntime: { fetchOne: vi.fn() },
  relayManager: { getAllRelays: vi.fn(() => ["wss://relay.test"]) },
}));

import { fetchProfile } from "./service";

beforeEach(() => {
  vi.clearAllMocks();
  (nostrRuntime.fetchOne as any).mockResolvedValue(null);
});

describe("fetchProfile", () => {
  it("parses a kind-0 event into a NostrProfile (display_name → displayName)", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "a".repeat(64),
      kind: 0,
      created_at: 1000,
      sig: "sig",
      tags: [],
      content: JSON.stringify({
        name: "alice",
        display_name: "Alice",
        picture: "https://example.com/a.png",
        about: "hello",
        nip05: "alice@example.com",
        website: "https://alice.example",
        lud16: "alice@wallet.example",
      }),
    });

    const profile = await fetchProfile("a".repeat(64));

    expect(profile).toEqual({
      pubkey: "a".repeat(64),
      name: "alice",
      displayName: "Alice",
      picture: "https://example.com/a.png",
      banner: undefined,
      about: "hello",
      nip05: "alice@example.com",
      website: "https://alice.example",
      lud16: "alice@wallet.example",
      createdAt: 1000,
    });

    const filter = (nostrRuntime.fetchOne as any).mock.calls[0][1];
    expect(filter).toMatchObject({ kinds: [0], authors: ["a".repeat(64)] });
  });

  it("returns null when no kind-0 event exists", async () => {
    expect(await fetchProfile("b".repeat(64))).toBeNull();
  });

  it("returns a bare profile when content is malformed JSON", async () => {
    (nostrRuntime.fetchOne as any).mockResolvedValue({
      id: "eid",
      pubkey: "c".repeat(64),
      kind: 0,
      created_at: 5,
      sig: "sig",
      tags: [],
      content: "not-json",
    });

    const profile = await fetchProfile("c".repeat(64));
    expect(profile).toMatchObject({ pubkey: "c".repeat(64), createdAt: 5 });
    expect(profile!.name).toBeUndefined();
  });
});
