# Calendar Interop & Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the super-app calendar bidirectionally wire-compatible with the standalone `nostr-calendar`, with full RSVP, delete/manage calendar, navbar module switching, a redesigned UI, full MCP parity, and a context doc for the calendar repo.

**Architecture:** Four sequential phases = four PRs on branch `upstream-week5&6-pr3`. Phase 1 (navbar) is independent chrome. Phase 2 fixes the wire formats (calendar-list tags-array codec + private-event viewKey model). Phase 3 adds RSVP + calendar management. Phase 4 finishes the UI redesign + MCP. TDD throughout; service/crypto/MCP logic is fully test-first.

**Tech Stack:** React + MUI + Zustand, `@formstr/core` (signer/runtime/crypto), `nostr-tools` (kinds, nip19, nip44, gift-wrap), vitest + @testing-library/react, MCP SDK + zod.

**Spec:** `docs/superpowers/specs/2026-06-04-calendar-interop-parity-design.md`

**Reference (read-only):** `upstream/nostr-calendar/src/common/{calendarList.ts,nostr.ts,EventConfigs.ts}`, `.../components/{RSVPBar,SuggestedTime,AddNote,CalendarManageDialog}.tsx`.

---

## File Structure

**Create:**

- `packages/app/src/services/calendar/calendarListCodec.ts` — encode/decode calendar list ⇆ NIP tags array.
- `packages/app/src/services/calendar/calendarListCodec.test.ts`
- `packages/app/src/services/calendar/viewKey.ts` — viewKey gen, event-content encrypt/decrypt, eventRef build/parse.
- `packages/app/src/services/calendar/viewKey.test.ts`
- `packages/app/src/components/calendar/RSVPBar.tsx` + `.test.tsx`
- `packages/app/src/components/calendar/CalendarManageDialog.tsx` + `.test.tsx`
- `docs/superpowers/specs/2026-06-04-calendar-interop-issues.md` — calendar-repo context doc.

**Modify:**

- `packages/app/src/services/calendar/service.ts` — list CRUD via codec, viewKey private events, membership helpers, `deleteCalendarList`.
- `packages/app/src/services/calendar/rsvp.ts` — RSVP suggested-time/comment; new invitation-rumor reader.
- `packages/app/src/services/calendar/types.ts` — `RSVPResponse` extra fields; `CalendarList.eventRefs` already exists.
- `packages/app/src/layout/{Header.tsx,AppShell.tsx,Sidebar.tsx}` — navbar tabs / remove rail.
- `packages/app/src/pages/CalendarPage.tsx` — membership filter, drop margin hack, manage dialog.
- `packages/app/src/components/calendar/{CalendarSidebar,CalendarMonthView,CalendarListView,EventCard,EventDetailsDialog}.tsx` — restyle + RSVP.
- `packages/mcp/src/tools/calendar.ts` — new/extended tools.
- `packages/mcp/test/calendar.test.ts` — new tool tests.

**Delete:** `packages/app/src/components/calendar/CreateCalendarDialog.tsx` (replaced by `CalendarManageDialog`).

**Conventions:** service tests `vi.mock("@formstr/core", …)` and import the mocked symbols (see existing `service.test.ts`). MCP tests use a `fakeServer()` tools Map (see existing `calendar.test.ts`). Commit messages: `feat(calendar):`, `fix(calendar):`, `test(calendar):`, `refactor(calendar):`, `feat(mcp):`. No `Co-Authored-By` trailer.

---

# Phase 1 — Navigation restructure (PR 1)

### Task 1: Module tabs in the navbar

**Files:**

- Modify: `packages/app/src/layout/Header.tsx`
- Test: `packages/app/src/layout/Header.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { Header } from "./Header";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header onLoginClick={() => {}} isMobile={false} />
    </MemoryRouter>,
  );

describe("Header module tabs", () => {
  it("renders all module tabs", () => {
    renderAt("/calendar");
    ["Forms", "Calendar", "Pages", "Drive", "Polls"].forEach((l) =>
      expect(screen.getByRole("link", { name: l })).toBeInTheDocument(),
    );
  });

  it("marks the active route with aria-current", () => {
    renderAt("/calendar");
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm --filter @formstr/app test -- Header` → fails (no links rendered).

- [ ] **Step 3: Implement** — in `Header.tsx`, add a `NAV_ITEMS` const (`Forms /forms`, `Calendar /calendar`, `Pages /pages`, `Drive /drive`, `Polls /polls`) and render a tab strip after the breadcrumb using `react-router-dom` `NavLink`:

```tsx
import { NavLink, useLocation } from "react-router-dom";
// ...inside Toolbar, replacing the breadcrumb block when !isMobile:
<Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: 0.25, ml: 1 }}>
  {NAV_ITEMS.map(({ label, path }) => (
    <NavLink key={path} to={path} style={{ textDecoration: "none" }}>
      {({ isActive }) => (
        <Box
          sx={{
            px: 1.25,
            py: 0.75,
            borderRadius: "7px",
            fontSize: 13.5,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "text.primary" : "text.secondary",
            bgcolor: isActive ? "action.selected" : "transparent",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          {label}
        </Box>
      )}
    </NavLink>
  ))}
</Box>;
```

Keep the existing breadcrumb for the `isMobile` branch.

- [ ] **Step 4: Run it, expect PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(calendar): module tabs in the navbar"`

---

### Task 2: Remove the desktop module rail from AppShell

**Files:**

- Modify: `packages/app/src/layout/AppShell.tsx`
- Test: `packages/app/src/layout/AppShell.test.tsx` (create)

- [ ] **Step 1: Failing test**

```tsx
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("does not render the desktop module rail (aside)", () => {
    const { container } = render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );
    expect(container.querySelector("aside")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (the `<Box component="aside">` rail exists).

- [ ] **Step 3: Implement** — delete the desktop `aside` block and the `ml: showDesktopSidebar ? sidebarWidth : 0` offset (set `ml: 0`); keep the mobile/tablet `Drawer`. Remove now-unused `showDesktopSidebar`/`sidebarWidth`/`SIDEBAR_*` imports as the lints demand. Main content keeps its `maxWidth: 1280` centering.

- [ ] **Step 4: Run, expect PASS.** Also run `pnpm --filter @formstr/app typecheck`.
- [ ] **Step 5: Commit** — `feat(calendar): remove desktop module rail; navbar owns module switching`

---

### Task 3: Reduce Sidebar to the mobile drawer menu

**Files:**

- Modify: `packages/app/src/layout/Sidebar.tsx`
- Test: existing `AppShell.test.tsx` mobile path (add case)

- [ ] **Step 1: Add test** — render `AppShell` with `window.innerWidth = 500`; assert the drawer menu still lists "Forms" and "Calendar" (mobile nav preserved). Use `vi.stubGlobal`/`window.innerWidth` + `fireEvent(window, new Event("resize"))`.
- [ ] **Step 2: Run, expect FAIL** if Sidebar was deleted; PASS-after-impl otherwise.
- [ ] **Step 3: Implement** — keep `Sidebar` rendering the nav list (it's still used by the mobile `Drawer`), but it no longer needs the collapse toggle. Leave logo + nav + user area. No desktop-collapse code.
- [ ] **Step 4: Run, expect PASS** + `pnpm --filter @formstr/app test` (whole module green).
- [ ] **Step 5: Commit** — `refactor(calendar): sidebar serves mobile drawer only`

> **PR 1 boundary:** push branch, open PR "nav: module switcher in navbar". CI must be green.

---

# Phase 2 — Interop + private viewKey (PR 2)

### Task 4: Calendar-list codec (tags array)

**Files:**

- Create: `packages/app/src/services/calendar/calendarListCodec.ts`
- Test: `packages/app/src/services/calendar/calendarListCodec.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { encodeCalendarList, decodeCalendarList } from "./calendarListCodec";
import type { CalendarList } from "./types";

const list: CalendarList = {
  id: "d123",
  eventId: "",
  title: "Work",
  description: "stuff",
  color: "#4285f4",
  eventRefs: [["31923:pk:abc", "wss://r.test", "nsec1view"]],
  createdAt: 1000,
  isVisible: true,
};

describe("calendarListCodec", () => {
  it("encodes to a NIP tags array the standalone understands", () => {
    const tags = encodeCalendarList(list);
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContainEqual(["title", "Work"]);
    expect(tags).toContainEqual(["content", "stuff"]);
    expect(tags).toContainEqual(["color", "#4285f4"]);
    expect(tags).toContainEqual(["a", "31923:pk:abc", "wss://r.test", "nsec1view"]);
  });

  it("round-trips through decode (standalone-compatible shape)", () => {
    const decoded = decodeCalendarList(encodeCalendarList(list), "d123", "evt1");
    expect(decoded.title).toBe("Work");
    expect(decoded.color).toBe("#4285f4");
    expect(decoded.eventRefs).toEqual([["31923:pk:abc", "wss://r.test", "nsec1view"]]);
    expect(decoded.id).toBe("d123");
    expect(decoded.eventId).toBe("evt1");
  });

  it("decodes a standalone-authored fixture (object payload guarded by caller)", () => {
    const standalone = [
      ["title", "Team"],
      ["color", "#0b8043"],
      ["a", "31923:pk:z", "", ""],
    ];
    const d = decodeCalendarList(standalone, "dx", "ex");
    expect(d.title).toBe("Team");
    expect(d.eventRefs[0][0]).toBe("31923:pk:z");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `calendarListCodec.ts`:

```ts
import type { CalendarList } from "./types";

const DEFAULT_TITLE = "Calendar";
const DEFAULT_COLOR = "#334155";

/** CalendarList → NIP tags array (kind-32123 decrypted content), matching the standalone. */
export function encodeCalendarList(list: CalendarList): string[][] {
  const tags: string[][] = [
    ["title", list.title],
    ["content", list.description ?? ""],
    ["color", list.color],
  ];
  for (const ref of list.eventRefs) tags.push(["a", ...ref]);
  return tags;
}

/** NIP tags array → CalendarList. `dTag`/`eventId` come from the outer event. */
export function decodeCalendarList(tags: string[][], dTag: string, eventId: string): CalendarList {
  let title = DEFAULT_TITLE;
  let description = "";
  let color = DEFAULT_COLOR;
  const eventRefs: string[][] = [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length === 0) continue;
    switch (tag[0]) {
      case "title":
        title = tag[1] ?? title;
        break;
      case "content":
        description = tag[1] ?? "";
        break;
      case "color":
        color = tag[1] || DEFAULT_COLOR;
        break;
      case "a":
        eventRefs.push([tag[1], tag[2] ?? "", tag[3] ?? ""]);
        break;
    }
  }
  return { id: dTag, eventId, title, description, color, eventRefs, createdAt: 0, isVisible: true };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): calendar-list tags-array codec (standalone interop)`

---

### Task 5: Wire codec into list CRUD

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts:240-319` (`createCalendarList`, `updateCalendarList`, `fetchCalendarLists`)
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Failing test** (append to `service.test.ts`)

```ts
import { encodeCalendarList } from "./calendarListCodec";

describe("calendar list CRUD interop", () => {
  it("createCalendarList encrypts a tags ARRAY, not an object", async () => {
    let captured = "";
    (nip44SelfEncrypt as any).mockImplementation((_s: any, plain: string) => {
      captured = plain;
      return "enc";
    });
    await createCalendarList("Work", "#4285f4", "desc");
    const parsed = JSON.parse(captured);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContainEqual(["title", "Work"]);
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
```

- [ ] **Step 2: Run, expect FAIL** (current code stringifies an object / parses an object).

- [ ] **Step 3: Implement** — in `service.ts`:
  - `createCalendarList`: build the `CalendarList`, then `const content = await nip44SelfEncrypt(signer, JSON.stringify(encodeCalendarList(calendarData)));`
  - `updateCalendarList`: same — `JSON.stringify(encodeCalendarList(calendarList))`.
  - `fetchCalendarLists`: for each event, `const decrypted = await nip44SelfDecrypt(signer, event.content); const parsed = JSON.parse(decrypted); if (!Array.isArray(parsed)) continue; const dTag = event.tags.find(t => t[0]==="d")?.[1] ?? ""; lists.push(decodeCalendarList(parsed, dTag, event.id));`
  - Import `{ encodeCalendarList, decodeCalendarList }`.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `fix(calendar): persist calendar lists as tags array (fixes standalone decrypt)`

---

### Task 6: viewKey helpers

**Files:**

- Create: `packages/app/src/services/calendar/viewKey.ts`
- Test: `packages/app/src/services/calendar/viewKey.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  generateViewKey,
  encryptWithViewKey,
  decryptWithViewKey,
  buildEventRef,
  parseEventRef,
} from "./viewKey";

describe("viewKey", () => {
  it("round-trips content through the viewKey nsec", async () => {
    const vk = generateViewKey(); // { nsec, pubkey }
    const cipher = await encryptWithViewKey(vk.nsec, JSON.stringify([["title", "Secret"]]));
    const plain = await decryptWithViewKey(vk.nsec, cipher);
    expect(JSON.parse(plain)).toEqual([["title", "Secret"]]);
  });

  it("builds and parses an event ref", () => {
    const ref = buildEventRef("32678:pk:d1", "wss://r", "nsec1abc");
    expect(ref).toEqual(["32678:pk:d1", "wss://r", "nsec1abc"]);
    expect(parseEventRef(ref)).toEqual({
      coordinate: "32678:pk:d1",
      relayHint: "wss://r",
      viewKey: "nsec1abc",
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `viewKey.ts` (uses `nostr-tools` + core `LocalSigner` + `nip44SelfEncrypt/Decrypt`):

```ts
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { LocalSigner, nip44SelfEncrypt, nip44SelfDecrypt } from "@formstr/core";

export interface ViewKey {
  nsec: string;
  pubkey: string;
  secret: Uint8Array;
}

export function generateViewKey(): ViewKey {
  const secret = generateSecretKey();
  return { secret, nsec: nip19.nsecEncode(secret), pubkey: getPublicKey(secret) };
}

function signerFromNsec(nsec: string): LocalSigner {
  const { data } = nip19.decode(nsec);
  return new LocalSigner(data as Uint8Array);
}

/** Self-encrypt to the viewKey's own pubkey — anyone holding the nsec can decrypt. */
export async function encryptWithViewKey(nsec: string, plaintext: string): Promise<string> {
  return nip44SelfEncrypt(signerFromNsec(nsec), plaintext);
}

export async function decryptWithViewKey(nsec: string, ciphertext: string): Promise<string> {
  return nip44SelfDecrypt(signerFromNsec(nsec), ciphertext);
}

export function buildEventRef(coordinate: string, relayHint: string, viewKey: string): string[] {
  return [coordinate, relayHint, viewKey];
}

export function parseEventRef(ref: string[]): {
  coordinate: string;
  relayHint: string;
  viewKey: string;
} {
  return { coordinate: ref[0], relayHint: ref[1] ?? "", viewKey: ref[2] ?? "" };
}
```

- [ ] **Step 4: Run, expect PASS** (real crypto round-trip; no mocks here — exclude `@formstr/core` from the test mock by NOT calling `vi.mock` in this file).
- [ ] **Step 5: Commit** — `feat(calendar): viewKey helpers for interoperable private events`

---

### Task 7: Private events use the viewKey model

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts:88-164` (`publishPrivateCalendarEvent`)
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Failing test**

```ts
describe("publishPrivateCalendarEvent (viewKey model)", () => {
  it("gift-wraps a rumor with an 'a' coordinate tag and a 'viewKey' tag", async () => {
    const published: any[] = [];
    (nostrRuntime.publish as any).mockImplementation((_r: any, e: any) => {
      published.push(e);
    });
    (wrapEvent as any).mockImplementation((rumor: any) => Promise.resolve({ kind: 1052, rumor }));
    const draft = {
      title: "Secret",
      description: "",
      begin: new Date("2026-06-04T09:00:00Z"),
      end: new Date("2026-06-04T10:00:00Z"),
      participants: ["deadbeef"],
      isPrivate: true,
    };
    await publishPrivateCalendarEvent(draft as any, "cal1");
    const wrapCall = (wrapEvent as any).mock.calls[0][0]; // the rumor
    const aTag = wrapCall.tags.find((t: string[]) => t[0] === "a");
    const vkTag = wrapCall.tags.find((t: string[]) => t[0] === "viewKey");
    expect(aTag?.[0]).toBe("a");
    expect(aTag?.[1]).toMatch(/^32678:/);
    expect(vkTag?.[1]).toMatch(/^nsec1/);
    expect(wrapCall.content).toBe("");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (current rumor is `{eventId,calendarId}` with empty tags).

- [ ] **Step 3: Implement** — rewrite `publishPrivateCalendarEvent`:
  - `const vk = generateViewKey();`
  - Build the event-content tags-array (title/description/start/end/location/categories/participants/tz/rrule/form) as today, then `const content = await encryptWithViewKey(vk.nsec, JSON.stringify(eventData));`
  - Publish kind-32678 `{ tags: [["d", eventId]], content }`; capture `relayHint` from the first relay in `relays` (or `relays[0]`).
  - For each participant: `const wrap = await wrapEvent({ kind: CALENDAR_KINDS.rumor, content: "", tags: [["a", coordinate, relayHint], ["viewKey", vk.nsec]] }, signer, participant, CALENDAR_KINDS.giftWrap); await nostrRuntime.publish(relays, wrap);` where `coordinate = ${CALENDAR_KINDS.privateEvent}:${pubkey}:${eventId}`.
  - Return the event with `viewKey: vk.nsec` populated and (if `calendarId`) add the ref to that list (Task 9 helper); for now store `viewKey` on the returned object.
  - Import `{ generateViewKey, encryptWithViewKey }`.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `fix(calendar): private events use shared viewKey + standalone gift-wrap rumor`

---

### Task 8: Read path — viewKey decrypt + new invitation reader

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts` (`parseCalendarEvent`, add optional `viewKey` param)
- Modify: `packages/app/src/services/calendar/rsvp.ts:105-130` (`extractInvitationFromWrap`)
- Test: both test files

- [ ] **Step 1: Failing tests**
  - `parseCalendarEvent(event, viewKey)` decrypts private content with the supplied viewKey: build a private event whose content was `encryptWithViewKey(vk.nsec, …)`, call `parseCalendarEvent(evt, vk.nsec)`, assert `title` recovered. (Real crypto — no core mock in a dedicated test file, or inject decrypt.)
  - `extractInvitationFromWrap` returns `{ eventCoordinate, viewKey }` when the unwrapped rumor has `["a", coord, hint]` + `["viewKey", nsec]`; still resolves the legacy `{eventId,...}` JSON shape.

```ts
// rsvp.test.ts additions
it("reads the standalone invitation rumor shape (a + viewKey tags)", async () => {
  (unwrapEvent as any).mockResolvedValue({
    kind: CALENDAR_KINDS.rumor,
    pubkey: "author",
    tags: [
      ["a", "32678:author:d9", "wss://r"],
      ["viewKey", "nsec1xyz"],
    ],
    content: "",
  });
  const inv = await extractInvitationFromWrap({ id: "w1", created_at: 7 } as any);
  expect(inv?.eventCoordinate).toBe("32678:author:d9");
  expect(inv?.viewKey).toBe("nsec1xyz");
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**
  - `InvitationRumor` gains `viewKey?: string` (types in `rsvp.ts`).
  - `extractInvitationFromWrap`: if the rumor has an `a` tag → parse coordinate from it + read `viewKey` tag; else fall back to the existing JSON parse. Return `viewKey` when present.
  - `parseCalendarEvent(event, viewKey?)`: when `isPrivate` and `viewKey` provided, `decryptWithViewKey(viewKey, event.content)`; else keep the legacy `nip44SelfDecrypt` author fallback. Store `viewKey` on the returned `CalendarEvent`.
  - Callers that have a viewKey (invitation resolve, eventRef fetch) pass it through.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): decrypt private events via viewKey; read standalone invitations`

---

### Task 9: Event ↔ calendar membership helpers

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts` (add `addEventToCalendarList`, `removeEventFromCalendarList`, `moveEventBetweenCalendarLists`)
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Failing test** — `addEventToCalendarList(list, ref)` returns a list whose `eventRefs` include `ref` (deduped by coordinate) and calls `updateCalendarList`; `removeEventFromCalendarList` drops by coordinate. Mirror `upstream/.../calendarList.ts:275-313`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the three helpers (copy the standalone semantics; republish via `updateCalendarList`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): event↔calendar membership via eventRefs`

> **PR 2 boundary:** push, open PR "interop: tags-array lists + viewKey private events". CI green. **Also write the context doc (Task 21) in this PR** since the reproduction lives here.

---

# Phase 3 — RSVP + delete/manage calendar (PR 3)

### Task 10: RSVP wire format (suggested time + comment)

**Files:**

- Modify: `packages/app/src/services/calendar/types.ts` (`RSVPResponse` += `suggestedStart?`, `suggestedEnd?`, `comment?`)
- Modify: `packages/app/src/services/calendar/rsvp.ts` (`rsvpToEvent`, `fetchRsvpsForEvent`)
- Test: `packages/app/src/services/calendar/rsvp.test.ts`

- [ ] **Step 1: Failing test**

```ts
describe("rsvpToEvent wire format", () => {
  it("adds start/end tags and puts comment in content (public)", async () => {
    let signed: any;
    (mockSigner.signEvent as any).mockImplementation((e: any) => {
      signed = e;
      return { ...e, id: "r", sig: "s", pubkey: "me" };
    });
    await rsvpToEvent("31923:pk:d", "accepted", false, {
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "late",
    });
    expect(signed.tags).toContainEqual(["start", "1000"]);
    expect(signed.tags).toContainEqual(["end", "2000"]);
    expect(signed.content).toBe("late");
  });
});

describe("fetchRsvpsForEvent parsing", () => {
  it("returns status + suggested times + comment", async () => {
    (nostrRuntime.querySync as any).mockResolvedValue([
      {
        pubkey: "u1",
        created_at: 9,
        content: "ok?",
        tags: [
          ["status", "tentative"],
          ["start", "1000"],
          ["end", "2000"],
        ],
      },
    ]);
    const r = await fetchRsvpsForEvent("31923:pk:d");
    expect(r[0]).toMatchObject({
      pubkey: "u1",
      status: "tentative",
      suggestedStart: 1000,
      suggestedEnd: 2000,
      comment: "ok?",
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — `rsvpToEvent(coordinate, status, isPrivate=false, extra?: { suggestedStart?; suggestedEnd?; comment? })`: push `["start", String(s)]`/`["end", String(s)]` when present; set `content = extra?.comment ?? ""` (and in the private branch, include them in the wrapped rumor tags/content too). `fetchRsvpsForEvent`: read `start`/`end` tags → `suggestedStart/End`, `evt.content` → `comment`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): RSVP suggested-time + note wire format (standalone parity)`

---

### Task 11: RSVPBar component

**Files:**

- Create: `packages/app/src/components/calendar/RSVPBar.tsx`
- Test: `packages/app/src/components/calendar/RSVPBar.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RSVPBar } from "./RSVPBar";

const event = { begin: 1717491600000, end: 1717495200000 } as any;

it("submits the chosen status", () => {
  const onSubmit = vi.fn();
  render(<RSVPBar event={event} onSubmit={onSubmit} isSubmitting={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: "accepted" }));
});

it("includes a comment when added", () => {
  const onSubmit = vi.fn();
  render(<RSVPBar event={event} onSubmit={onSubmit} isSubmitting={false} />);
  fireEvent.click(screen.getByText(/add a note/i));
  fireEvent.change(screen.getByPlaceholderText(/note/i), { target: { value: "running late" } });
  fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ status: "tentative", comment: "running late" }),
  );
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `RSVPBar.tsx` — props `{ event; myStatus?; isSubmitting; onSubmit: (p:{status; suggestedStart?; suggestedEnd?; comment?})=>void }`. Render a 3-button segmented control (Yes→accepted, Maybe→tentative, No→declined; selected = `variant="contained"`), a collapsible "Suggest a new time" (two datetime-local inputs, only emit start/end when changed from `event.begin/end`), and a collapsible "Add a note" (textarea, placeholder "Add a note"). Monochrome MUI per the approved mockup. Adapt logic from `upstream/.../RSVPBar.tsx`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): RSVPBar (yes/maybe/no + suggest-time + note)`

---

### Task 12: EventDetailsDialog rework

**Files:**

- Modify: `packages/app/src/components/calendar/EventDetailsDialog.tsx`
- Test: `packages/app/src/components/calendar/EventDetailsDialog.test.tsx`

- [ ] **Step 1: Update/extend tests** — author sees Edit/Delete; everyone (incl. author) sees `RSVPBar`; attendee list renders status pill + comment + suggested time. Mock `fetchRsvpsForEvent` to return one entry with a comment.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — replace the Accept/Maybe/Decline `DialogActions` block with `<RSVPBar … onSubmit={p => rsvpToEvent(coordinate, p.status, event.isPrivate, p)} />`; render attendees with `status` + optional `suggestedStart/End` + `comment`. Keep author Edit/Delete actions.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): event details uses full RSVP bar + attendee details`

---

### Task 13: `deleteCalendarList` service

**Files:**

- Modify: `packages/app/src/services/calendar/service.ts`
- Test: `packages/app/src/services/calendar/service.test.ts`

- [ ] **Step 1: Failing test** — `deleteCalendarList("32123:aabbccdd:cal1")` publishes a kind-5 with `["k","32123"]` and `["a","32123:aabbccdd:cal1"]`.

```ts
it("deleteCalendarList emits NIP-09 k + a tags", async () => {
  let signed: any;
  (mockSigner.signEvent as any).mockImplementation((e: any) => {
    signed = e;
    return { ...e, id: "x", sig: "s", pubkey: "aabbccdd" };
  });
  await deleteCalendarList("32123:aabbccdd:cal1");
  expect(signed.kind).toBe(5);
  expect(signed.tags).toContainEqual(["k", "32123"]);
  expect(signed.tags).toContainEqual(["a", "32123:aabbccdd:cal1"]);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `deleteCalendarList(coordinate)` mirroring `deleteCalendarEvent` (kind 5, `k` = coordinate's kind, `a` = coordinate).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): deleteCalendarList (NIP-09 addressable)`

---

### Task 14: CalendarManageDialog (create/edit/delete)

**Files:**

- Create: `packages/app/src/components/calendar/CalendarManageDialog.tsx` + `.test.tsx`
- Delete: `packages/app/src/components/calendar/CreateCalendarDialog.tsx`
- Modify: `packages/app/src/pages/CalendarPage.tsx` (swap dialog usage)

- [ ] **Step 1: Failing test** — renders name/description/color presets; in edit mode shows a Delete button that fires `onDelete`; Save fires `onSave({title,description,color})`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `CalendarManageDialog` props `{ open; calendar?; onClose; onSave; onDelete? }`, monochrome per mockup (8 preset color swatches from the standalone). Update `CalendarPage` to use it for both create + edit; delete `CreateCalendarDialog` and its import.
- [ ] **Step 4: Run, expect PASS** + `pnpm --filter @formstr/app test`.
- [ ] **Step 5: Commit** — `feat(calendar): manage-calendar dialog (create/edit/delete)`

> **PR 3 boundary:** push, open PR "RSVP parity + delete/manage calendar". CI green.

---

# Phase 4 — UI redesign + MCP parity (PR 4)

### Task 15: CalendarSidebar = My Calendars panel

**Files:**

- Modify: `packages/app/src/components/calendar/CalendarSidebar.tsx` + `.test.tsx`

- [ ] **Step 1: Test** — renders each calendar with a color dot + name; clicking the row toggles visibility (`onToggleCalendar`); a per-row edit control fires `onEditCalendar`; "+ New" fires `onNewCalendar`; "Show all public" toggles.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the panel per the approved mockup (header "My Calendars" + "+", rows with dot/name/visibility/edit-gear, divider, "Show all public"). Add `onEditCalendar` prop.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): My Calendars side panel (toggle/edit/new)`

---

### Task 16: Month/List/EventCard restyle

**Files:**

- Modify: `CalendarMonthView.tsx`, `CalendarListView.tsx`, `EventCard.tsx` (+ existing tests)

- [ ] **Step 1: Update smoke tests** — `EventCard` shows time + title, lock icon when `isPrivate`, and applies the calendar color as a left border. `CalendarMonthView` renders today's cell with a distinct marker and places chips on the correct day. Keep existing assertions green.
- [ ] **Step 2: Run, expect FAIL** on the new assertions.
- [ ] **Step 3: Implement** the monochrome restyle from the approved mockup: grey chip fill + 3px colored left border (`borderLeft: 3px solid <calendarColor>`), today = filled circle on the day number, weekday header row, clean borders. Theme tokens only.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(calendar): restyle month/list/event chips (monochrome + calendar color)`

---

### Task 17: CalendarPage orchestrator wiring

**Files:**

- Modify: `packages/app/src/pages/CalendarPage.tsx`

- [ ] **Step 1: Test** — filtering uses calendar-list `eventRefs` membership (events whose coordinate is in a hidden list are filtered out); the page no longer applies negative `mx`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — derive membership from `calendars[].eventRefs` (coordinate `${kind}:${user}:${id}`); drop the `mx:{xs:-2…}` hack now that the rail is gone; wire `onEditCalendar` → open `CalendarManageDialog` in edit mode; keep < 200 LOC.
- [ ] **Step 4: Run, expect PASS** + full `pnpm --filter @formstr/app test`.
- [ ] **Step 5: Commit** — `refactor(calendar): orchestrator filters by eventRefs; drop margin hack`

---

### Task 18: MCP `update_calendar` + `delete_calendar`

**Files:**

- Modify: `packages/mcp/src/tools/calendar.ts`, `packages/mcp/test/calendar.test.ts`
- Modify mock: add `updateCalendarList`, `deleteCalendarList` to the `calendar` mock.

- [ ] **Step 1: Failing test** — `update_calendar` is ungated (constructive) OR gated? It mutates an existing list → **gated + confirm**. `delete_calendar` gated + confirm; calls `deleteCalendarList`. Assert absent when `allowWrites:false`; present + confirm-required when true.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** both tools under the `if (!ctx.allowWrites) return;` block, using `requireConfirm` like `delete_calendar_event`. `delete_calendar({ coordinate, confirm })` → `calendar.deleteCalendarList(coordinate)`. `update_calendar({ id, title?, color?, description?, confirm })` → fetch list, merge, `calendar.updateCalendarList(merged)`.
- [ ] **Step 4: Run, expect PASS** (`pnpm --filter @formstr/mcp test -- calendar`).
- [ ] **Step 5: Commit** — `feat(mcp): update_calendar + delete_calendar (gated)`

---

### Task 19: MCP `add_event_to_calendar` + `remove_event_from_calendar`

**Files:** same as Task 18.

- [ ] **Step 1: Failing test** — both gated + confirm; `add_event_to_calendar({ calendarId, coordinate, relayHint?, viewKey?, confirm })` resolves the list and calls `addEventToCalendarList`; remove calls `removeEventFromCalendarList`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** both tools (fetch lists → find by `calendarId` → call the membership helper → report). Add helpers to the `calendar` service mock.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(mcp): add/remove event to calendar (gated)`

---

### Task 20: MCP RSVP extensions

**Files:** same as Task 18.

- [ ] **Step 1: Failing test** — `rsvp_event` accepts optional `suggestedStart`/`suggestedEnd`/`comment` and forwards them as the 4th arg to `rsvpToEvent`; `fetch_event_rsvps` output includes `suggestedStart`/`suggestedEnd`/`comment`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — extend the zod schema + the handler to pass `{ suggestedStart, suggestedEnd, comment }`; map the extra fields in `fetch_event_rsvps`.
- [ ] **Step 4: Run, expect PASS** + full `pnpm --filter @formstr/mcp test`.
- [ ] **Step 5: Commit** — `feat(mcp): rsvp suggested-time + note; rsvps expose extras`

> **PR 4 boundary:** push, open PR "calendar UI redesign + MCP parity". CI green.

---

### Task 21: Context doc for the calendar repo

**Files:**

- Create: `docs/superpowers/specs/2026-06-04-calendar-interop-issues.md`

- [ ] **Step 1: Reproduce** — with the dev app (`pnpm --filter @formstr/app dev`), create a public event and a calendar in the super-app on a test nsec; load that nsec in calendar.formstr.app; capture both console errors + the exact failing function from the source map (or by reading `upstream/.../nostr.ts` `getDetailsFromGiftWrap` / calendar-list ingest). Record the precise trigger of `Unknown letter: ':'`.
- [ ] **Step 2: Write the doc** — sections: (1) both errors + stack traces + reproduction steps; (2) the super-app fixes shipped (Tasks 5,7,8 with commit SHAs) and why each is super-app-side; (3) recommended **standalone defensive guards** — wrap `getDetailsFromGiftWrap`/gift-wrap `onEvent` in try/catch (skip foreign wraps), guard `nip19.decode` callers against `:`-containing values, log-only on non-array calendar-list payloads; (4) wire-format appendix (tag-by-tag) for kinds 32123 / 31923 / 32678 / 31925 / 32069 / 1052 / 1055.
- [ ] **Step 3: Commit** — `docs(calendar): interop issues + standalone-repo recommendations` (land in PR 2).

---

## Self-Review

**Spec coverage:**

- Workstream A → Tasks 4,5,6,7,8,9 ✓ · B → 10,11,12 ✓ · C → 13,14 ✓ · D → 1,2,3 ✓ · E → 15,16,17 ✓ · F → 18,19,20 ✓ · G → 21 ✓.
- Definition-of-done #2 (round-trip into standalone) is validated by Task 21 reproduction + the codec/viewKey round-trip tests (Tasks 4,6,7).
- Coverage gate (DoD #3) is already enforced; new service files include tests, keeping `services/calendar/**` ≥ 80%.

**Placeholder scan:** No "TBD/handle edge cases" — every code step has concrete code or an exact transformation. Task 21 step 1 is an action (reproduce) by design, not a code placeholder.

**Type consistency:** `rsvpToEvent(coordinate, status, isPrivate, extra?)` 4-arg shape is used consistently in Tasks 10, 12, 20. `RSVPResponse` extras (`suggestedStart/End/comment`) defined in Task 10, consumed in 12 + 20. `buildEventRef`/`parseEventRef`/`generateViewKey` defined in Task 6, used in 7/8/19. `encodeCalendarList`/`decodeCalendarList` defined in Task 4, used in 5. `addEventToCalendarList`/`removeEventFromCalendarList` defined in Task 9, used in 19.

---

## Execution Notes

- One branch (`upstream-week5&6-pr3`), four PRs in order (1→2→3→4); the context doc lands with PR 2.
- After each task: run that package's tests; after each phase: run `pnpm -r test` + `pnpm -r typecheck` + `pnpm -r build` (CI parity, Node 20 + 22).
