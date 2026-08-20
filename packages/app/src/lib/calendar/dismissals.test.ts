import { describe, it, expect, vi, beforeEach } from "vitest";

const querySync = vi.hoisted(() => vi.fn());
vi.mock("@formstr/core", () => ({ nostrRuntime: { querySync } }));

import { fetchDismissals } from "./dismissals";

function deletion(over: Partial<any> = {}) {
  return { id: "d", pubkey: "me", kind: 5, created_at: 1, tags: [], content: "", sig: "", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  querySync.mockResolvedValue([]);
});

describe("fetchDismissals", () => {
  it("collects the wrap ids and coordinates the user deleted", async () => {
    querySync.mockResolvedValue([
      deletion({
        tags: [
          ["e", "wrap1"],
          ["a", "32678:author:abc"],
        ],
      }),
    ]);
    const dismissed = await fetchDismissals("me", ["wss://a.test"]);
    expect(dismissed.ids.has("wrap1")).toBe(true);
    expect(dismissed.coordinates.has("32678:author:abc")).toBe(true);
  });

  it("asks only for the user's own deletions", async () => {
    await fetchDismissals("me", ["wss://a.test"]);
    expect(querySync).toHaveBeenCalledWith(
      ["wss://a.test"],
      expect.objectContaining({ kinds: [5], authors: ["me"] }),
    );
  });

  it("returns an empty index when the query fails", async () => {
    querySync.mockRejectedValue(new Error("relay down"));
    const dismissed = await fetchDismissals("me", ["wss://a.test"]);
    expect(dismissed.ids.size).toBe(0);
    expect(dismissed.coordinates.size).toBe(0);
  });
});
