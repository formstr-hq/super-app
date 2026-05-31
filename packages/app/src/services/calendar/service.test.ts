import {
  signerManager,
  nostrRuntime,
  nip44SelfDecrypt,
  nip44SelfEncrypt,
  wrapEvent,
} from "@formstr/core";
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

import {
  createCalendarList,
  deleteCalendarEvent,
  fetchCalendarEventByCoordinate,
  fetchCalendarEventsSync,
  fetchCalendarLists,
  publishPrivateCalendarEvent,
  publishPublicCalendarEvent,
  updateCalendarList,
} from "./service";
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
  (nip44SelfDecrypt as any).mockResolvedValue("{}");
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

describe("publishPublicCalendarEvent — update", () => {
  it("reuses draft.existingId as the d-tag when provided", async () => {
    await publishPublicCalendarEvent({
      title: "Edited",
      description: "",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
      existingId: "keepme00",
    });
    const published = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(published.tags).toContainEqual(["d", "keepme00"]);
  });

  it("generates a fresh d-tag when existingId is absent", async () => {
    await publishPublicCalendarEvent({
      title: "New",
      description: "",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
    });
    const published = (nostrRuntime.publish as any).mock.calls[0][1];
    const dTag = published.tags.find((t: string[]) => t[0] === "d")?.[1];
    expect(dTag).toBeTruthy();
    expect(dTag).not.toBe("keepme00");
  });
});

describe("publishPublicCalendarEvent — tags", () => {
  it("publishes kind-31923 with title/start/end/participant tags", async () => {
    await publishPublicCalendarEvent({
      title: "Standup",
      description: "daily",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
      location: "Zoom",
      participants: ["pubA"],
      categories: ["work"],
    });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(CALENDAR_KINDS.publicEvent);
    expect(e.tags).toContainEqual(["title", "Standup"]);
    expect(e.tags).toContainEqual(["start", "1700000000"]);
    expect(e.tags).toContainEqual(["p", "pubA"]);
    expect(e.tags).toContainEqual(["location", "Zoom"]);
  });
});

describe("publishPrivateCalendarEvent — gift wraps", () => {
  it("encrypts content and publishes a gift-wrap per participant", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap", kind: CALENDAR_KINDS.giftWrap });
    await publishPrivateCalendarEvent(
      {
        title: "Secret",
        description: "",
        begin: new Date(1700000000000),
        end: new Date(1700003600000),
        participants: ["pubA", "pubB"],
        isPrivate: true,
      },
      "default",
    );
    expect((nostrRuntime.publish as any).mock.calls.length).toBe(3);
    expect(wrapEvent).toHaveBeenCalledTimes(2);
    const privateEvt = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(privateEvt.kind).toBe(CALENDAR_KINDS.privateEvent);
    expect(privateEvt.content).toBe("enc");
  });
});

describe("fetchCalendarEventsSync", () => {
  it("parses returned events", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "e1",
        pubkey: "p",
        kind: CALENDAR_KINDS.publicEvent,
        created_at: 1,
        sig: "s",
        content: "",
        tags: [
          ["d", "d1"],
          ["title", "T"],
          ["start", "1700000000"],
          ["end", "1700003600"],
        ],
      } satisfies Event,
    ]);
    const events = await fetchCalendarEventsSync({});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("T");
  });
});

describe("deleteCalendarEvent", () => {
  it("publishes kind-5 with the a-tag coordinate", async () => {
    await deleteCalendarEvent("e1", "31923:p:d1");
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(5);
    expect(e.tags).toContainEqual(["a", "31923:p:d1"]);
  });
});

describe("createCalendarList", () => {
  it("publishes an encrypted calendarList event and returns the list", async () => {
    const list = await createCalendarList("My Calendar", "#ff0000", "A test calendar");
    expect(nip44SelfEncrypt).toHaveBeenCalledTimes(1);
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(32123);
    expect(list.title).toBe("My Calendar");
    expect(list.color).toBe("#ff0000");
    expect(list.eventId).toBe("eid");
  });
});

describe("updateCalendarList", () => {
  it("re-publishes the updated list and returns it with the new eventId", async () => {
    const input = {
      id: "listid1",
      eventId: "old",
      title: "Updated",
      description: "",
      color: "#00ff00",
      eventRefs: [],
      createdAt: 1000,
      isVisible: true,
    };
    const result = await updateCalendarList(input);
    expect(nip44SelfEncrypt).toHaveBeenCalledTimes(1);
    expect(result.eventId).toBe("eid");
    expect(result.title).toBe("Updated");
  });
});

describe("fetchCalendarLists", () => {
  it("decrypts and returns calendar lists", async () => {
    const listData = {
      id: "l1",
      eventId: "",
      title: "Fetched",
      description: "",
      color: "#aabbcc",
      eventRefs: [],
      createdAt: 100,
      isVisible: true,
    };
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "evt1",
        pubkey: "aabbccdd",
        kind: 32123,
        created_at: 100,
        sig: "s",
        content: "enc",
        tags: [["d", "l1"]],
      },
    ]);
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify(listData));
    const lists = await fetchCalendarLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].title).toBe("Fetched");
    expect(lists[0].eventId).toBe("evt1");
  });

  it("skips corrupted entries", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "evt2",
        pubkey: "aabbccdd",
        kind: 32123,
        created_at: 100,
        sig: "s",
        content: "bad",
        tags: [],
      },
    ]);
    (nip44SelfDecrypt as any).mockRejectedValue(new Error("decrypt fail"));
    const lists = await fetchCalendarLists();
    expect(lists).toHaveLength(0);
  });
});
