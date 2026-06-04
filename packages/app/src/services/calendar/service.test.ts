import {
  signerManager,
  nostrRuntime,
  nip44SelfDecrypt,
  nip44SelfEncrypt,
  wrapEvent,
  unwrapEvent,
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
  LocalSigner: class {
    nip44Encrypt = vi.fn();
    nip44Decrypt = vi.fn();
    getPublicKey = vi.fn();
  },
}));

import {
  createCalendarList,
  deleteCalendarEvent,
  fetchCalendarEventByCoordinate,
  fetchCalendarEventsSync,
  fetchCalendarLists,
  fetchInvitationsSync,
  publishPrivateCalendarEvent,
  publishPublicCalendarEvent,
  updateCalendarList,
} from "./service";
import { CALENDAR_KINDS } from "./types";
import { generateViewKey } from "./viewKey";

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

describe("publishPrivateCalendarEvent — recurrence/tz/form in encrypted payload", () => {
  it("includes rrule/tzid/form rows in the data passed to nip44SelfEncrypt", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap", kind: CALENDAR_KINDS.giftWrap });
    await publishPrivateCalendarEvent(
      {
        title: "SecretRepeat",
        description: "",
        begin: new Date(1700000000000),
        end: new Date(1700003600000),
        isPrivate: true,
        rrule: "FREQ=WEEKLY",
        startTzid: "Asia/Tokyo",
        registrationFormRef: "naddr1priv",
      },
      "default",
    );
    const encryptedArg = (nip44SelfEncrypt as any).mock.calls[0][1];
    const rows = JSON.parse(encryptedArg) as string[][];
    expect(rows).toContainEqual(["L", "rrule"]);
    expect(rows).toContainEqual(["l", "FREQ=WEEKLY", "rrule"]);
    expect(rows).toContainEqual(["start_tzid", "Asia/Tokyo"]);
    expect(rows).toContainEqual(["form", "naddr1priv"]);
  });
});

describe("publishPrivateCalendarEvent — viewKey model (standalone interop)", () => {
  it("gift-wraps a rumor carrying an 'a' coordinate and a 'viewKey' nsec", async () => {
    let rumor: { content: string; tags: string[][] } | undefined;
    (wrapEvent as any).mockImplementation((r: typeof rumor) => {
      rumor = r;
      return Promise.resolve({ id: "wrap", kind: CALENDAR_KINDS.giftWrap });
    });
    const result = await publishPrivateCalendarEvent(
      {
        title: "Secret",
        description: "",
        begin: new Date(1700000000000),
        end: new Date(1700003600000),
        participants: ["deadbeef"],
        isPrivate: true,
      },
      "cal1",
    );
    const aTag = rumor!.tags.find((t) => t[0] === "a");
    const vkTag = rumor!.tags.find((t) => t[0] === "viewKey");
    expect(rumor!.content).toBe("");
    expect(aTag?.[1]).toMatch(/^32678:/);
    expect(vkTag?.[1]).toMatch(/^nsec1/);
    // The published event exposes its viewKey so the owner's calendar list can ref it.
    expect(result.viewKey).toBe(vkTag?.[1]);
  });

  it("reuses an existing viewKey when editing (so prior invitees keep access)", async () => {
    (wrapEvent as any).mockResolvedValue({ id: "wrap", kind: CALENDAR_KINDS.giftWrap });
    const existing = generateViewKey().nsec;
    const result = await publishPrivateCalendarEvent(
      {
        title: "Secret",
        description: "",
        begin: new Date(1700000000000),
        end: new Date(1700003600000),
        isPrivate: true,
        existingId: "keepid",
        viewKey: existing,
      },
      "cal1",
    );
    expect(result.viewKey).toBe(existing);
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

describe("publishPublicCalendarEvent — recurrence/tz/form round-trip", () => {
  it("emits rrule label-pair, start_tzid and form tags", async () => {
    await publishPublicCalendarEvent({
      title: "Repeat",
      description: "",
      begin: new Date(1700000000000),
      end: new Date(1700003600000),
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      startTzid: "America/New_York",
      registrationFormRef: "naddr1abc",
    });
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags).toContainEqual(["L", "rrule"]);
    expect(e.tags).toContainEqual(["l", "FREQ=WEEKLY;BYDAY=MO", "rrule"]);
    expect(e.tags).toContainEqual(["start_tzid", "America/New_York"]);
    expect(e.tags).toContainEqual(["form", "naddr1abc"]);
  });
});

describe("parseCalendarEvent (via fetchCalendarEventByCoordinate) — reads recurrence/tz/form", () => {
  it("recovers rrule, startTzid and registrationFormRef from tags", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "eid",
        pubkey: "p",
        kind: CALENDAR_KINDS.publicEvent,
        created_at: 1000,
        sig: "sig",
        content: "",
        tags: [
          ["d", "abc12345"],
          ["title", "R"],
          ["start", "1700000000"],
          ["end", "1700003600"],
          ["L", "rrule"],
          ["l", "FREQ=DAILY", "rrule"],
          ["start_tzid", "Europe/Paris"],
          ["form", "naddr1xyz"],
        ],
      } satisfies Event,
    ]);
    const ev = await fetchCalendarEventByCoordinate("31923:p:abc12345");
    expect(ev!.repeat.rrule).toBe("FREQ=DAILY");
    expect(ev!.startTzid).toBe("Europe/Paris");
    expect(ev!.registrationFormRef).toBe("naddr1xyz");
  });
});

describe("deleteCalendarEvent", () => {
  it("publishes kind-5 with the a-tag coordinate and matching k-tag", async () => {
    await deleteCalendarEvent("e1", "31923:p:d1");
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.kind).toBe(5);
    expect(e.tags).toContainEqual(["a", "31923:p:d1"]);
    expect(e.tags).toContainEqual(["k", "31923"]);
  });

  it("derives the k-tag for private events from the coordinate kind", async () => {
    await deleteCalendarEvent("d2", "32678:p:d2");
    const e = (nostrRuntime.publish as any).mock.calls[0][1];
    expect(e.tags).toContainEqual(["k", "32678"]);
    expect(e.tags).toContainEqual(["a", "32678:p:d2"]);
    // d-tag id "d2" is not a 64-hex nostr id → no e-tag
    expect(e.tags.find((t: string[]) => t[0] === "e")).toBeUndefined();
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
    // Content is the standalone-compatible NIP tags array, not a JSON object.
    const listTags = [
      ["title", "Fetched"],
      ["content", ""],
      ["color", "#aabbcc"],
    ];
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
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify(listTags));
    const lists = await fetchCalendarLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].title).toBe("Fetched");
    expect(lists[0].id).toBe("l1");
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

describe("fetchInvitationsSync", () => {
  it("unwraps gift-wraps, resolves the referenced event, and dedupes by wrapId", async () => {
    (nostrRuntime.querySync as any)
      .mockResolvedValueOnce([
        {
          id: "w1",
          pubkey: "sender",
          kind: CALENDAR_KINDS.giftWrap,
          created_at: 5,
          sig: "s",
          content: "x",
          tags: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "eid",
          pubkey: "author",
          kind: CALENDAR_KINDS.privateEvent,
          created_at: 5,
          sig: "s",
          content: "",
          tags: [
            ["d", "abc12345"],
            ["title", "Invited Event"],
            ["start", "1700000000"],
            ["end", "1700003600"],
          ],
        },
      ]);
    (unwrapEvent as any).mockResolvedValue({
      kind: CALENDAR_KINDS.rumor,
      pubkey: "author",
      content: JSON.stringify({ eventId: "abc12345" }),
    });

    const invites = await fetchInvitationsSync();
    expect(invites).toHaveLength(1);
    expect(invites[0].eventCoordinate).toBe("32678:author:abc12345");
    expect(invites[0].event?.title).toBe("Invited Event");
  });
});

describe("calendar list CRUD interop", () => {
  it("createCalendarList encrypts a tags ARRAY, not an object", async () => {
    let captured = "";
    (nip44SelfEncrypt as any).mockImplementation((_s: unknown, plain: string) => {
      captured = plain;
      return "enc";
    });
    await createCalendarList("Work", "#4285f4", "desc");
    const parsed = JSON.parse(captured);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContainEqual(["title", "Work"]);
    expect(parsed).toContainEqual(["color", "#4285f4"]);
  });

  it("fetchCalendarLists decodes a tags-array payload", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "evt1",
        pubkey: "aabbccdd",
        kind: CALENDAR_KINDS.calendarList,
        created_at: 5,
        content: "enc",
        tags: [["d", "cal1"]],
        sig: "s",
      },
    ]);
    (nip44SelfDecrypt as any).mockResolvedValue(
      JSON.stringify([
        ["title", "Team"],
        ["color", "#0b8043"],
      ]),
    );
    const lists = await fetchCalendarLists();
    expect(lists[0].title).toBe("Team");
    expect(lists[0].id).toBe("cal1");
    expect(lists[0].eventId).toBe("evt1");
  });

  it("fetchCalendarLists skips a non-array (legacy object) payload without throwing", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        id: "evt2",
        pubkey: "aabbccdd",
        kind: CALENDAR_KINDS.calendarList,
        created_at: 5,
        content: "enc",
        tags: [["d", "cal2"]],
        sig: "s",
      },
    ]);
    (nip44SelfDecrypt as any).mockResolvedValue(JSON.stringify({ id: "cal2", title: "old" }));
    await expect(fetchCalendarLists()).resolves.toEqual([]);
  });
});
