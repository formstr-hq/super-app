# Calendar Interop Issues — context for the `nostr-calendar` repo

> **Audience:** maintainers of the standalone **calendar.formstr.app** (`nostr-calendar`).
> **Author:** Formstr super-app team. **Date:** 2026-06-04.
> **Status:** super-app side fixed (see §3). This doc records the root causes and
> recommends defensive guards for the standalone so it never hard-fails on
> foreign-but-valid (or merely malformed) calendar data again.

When a calendar/event authored by an **older** build of the Formstr **super-app**
was loaded by **calendar.formstr.app**, the standalone threw on load. Two distinct
errors were involved. Both have now been fixed on the super-app side so it emits
wire formats the standalone already understands; this doc additionally asks the
standalone to **fail soft** on any payload it cannot parse, since other clients
(or future versions) can always put unexpected data on the relays.

Line references below are against the vendored read-only snapshot at
`super-app/upstream/nostr-calendar/` (the source of truth we built against). The
**deployed** build may differ slightly; where a line cannot be pinned from the
snapshot this is called out explicitly.

---

## 1. Error 1 — `Calendar list payload is not a tags array (got object)`

### Symptom

Loading a super-app-authored **kind-32123** calendar list logged / threw:

```
Calendar list payload is not a tags array (got object)
```

### Origin (vendored source)

`src/common/calendarList.ts` → `decryptCalendarList`:

```ts
// calendarList.ts:104-109
const parsed = JSON.parse(decryptedContent) as unknown;
if (!Array.isArray(parsed)) {
  throw new Error(`Calendar list payload is not a tags array (got ${typeof parsed})`);
}
```

The standalone stores a calendar list as a **NIP tags array** in the NIP-44
self-encrypted `content` (see `encryptCalendarList`, `calendarList.ts:50-64`):

```ts
const tags = [
  ["title", calendarList.title],
  ["content", calendarList.description],
  ["color", calendarList.color],
  // ["notifications","disabled"]?  ...["a", coordinate, relayHint, viewKey]
];
```

The **old super-app** instead encrypted a JSON **object** (`{ id, title, … }`),
so `Array.isArray(parsed)` was `false` and `decryptCalendarList` threw.

### Severity in the current snapshot

In the vendored snapshot this throw is **already caught** by the subscription
handler (`calendarList.ts:220-225`):

```ts
try {
  const list = await decryptCalendarList(event);
  onList(list);
} catch (error) {
  console.error("Failed to decrypt calendar list:", error);
}
```

So against the current code the super-app's old list is **silently dropped**
(a `console.error`, the calendar simply never appears) rather than crashing the
page. Against the **deployed** build at the time of the original report it
surfaced as a load-time throw — i.e. the catch was not yet present, or the throw
escaped on a different path. Either way the user-visible result is the same: the
super-app calendar does not show up.

---

## 2. Error 2 — `Unknown letter ":"` (bech32 / `nip19.decode`)

### Symptom

Loading super-app private-event **invitations** threw a bech32 decode error:

```
Error: Unknown letter ":". Allowed: qpzry9x8gf2tvdw0s3jn54khce6mua7l
```

`:` is not in the bech32 alphabet — this is `nip19.decode` (via `bech32.decode`)
being handed a value that is **not** an `nsec`/`naddr`/`npub` but rather an
addressable **coordinate** string like `32678:<pubkey>:<dTag>` (which contains
`:`).

### Origin

The standalone's invitation model is: a **NIP-59 gift wrap** (kind 1052)
containing a rumor (kind 52) whose tags carry the addressable coordinate and the
per-event **viewKey**. `getDetailsFromGiftWrap` (`nostr.ts:590-613`) reads them:

```ts
const aTag = rumor.tags.find((tag) => tag[0] === "a");
if (!aTag) {
  console.log(rumor);
  throw new Error("invalid rumor. a tag not found");
}
const eventId = aTag[1].split(":")[2];
const authorPubkey = aTag[1].split(":")[1];
const kind = Number(aTag[1].split(":")[0]);
const viewKey = rumor.tags.find((tag) => tag[0] === "viewKey")?.[1];
if (!viewKey) throw new Error("invalid rumor: viewKey not found");
```

and later decodes the `viewKey` nsec to fetch/decrypt the event, e.g.
`nostr.ts:515`:

```ts
const viewSecretKey = nip19.decode(event.viewKey as NSec).data;
```

The **old super-app** private events were **self-encrypted** (to the author's own
pubkey, not a shareable viewKey) and the gift-wrapped rumor carried a bare JSON
blob `{ eventId, calendarId }` with **no `a` tag and no `viewKey` tag**. Against
the standalone that means:

- In the **current snapshot**, `getDetailsFromGiftWrap` throws
  `"invalid rumor. a tag not found"` (`nostr.ts:595`), which is **caught** by the
  gift-wrap subscription handler (`nostr.ts:651-656`,
  `console.error("Failed to unwrap gift wrap:", error)`). No bech32 error here.
- The originally-observed **`Unknown letter ":"`** comes from a `:`-containing
  string (a coordinate, or a misassigned field) reaching one of the **un-guarded
  `nip19.decode` callsites**. In the vendored snapshot those are:
  `nostr.ts:203`, `nostr.ts:255`, `nostr.ts:425`, `nostr.ts:515`, `nostr.ts:792`.
  The **exact** deployed callsite cannot be pinned from the snapshot (the deployed
  invitation-ingest path differed from the current one), but every one of these
  decodes user/relay-sourced data with no validation and will throw uncaught on a
  malformed value.

### Why this is a standalone-hardening concern even after our fix

Our fix (below) makes the super-app emit the exact rumor shape the standalone
wants, so this specific trigger is gone. But **any** client can publish a kind
1052 wrap addressed to a user with a malformed `viewKey`/coordinate; an uncaught
`nip19.decode` throw on the ingest path will still take down the calendar load.

---

## 3. Fixes shipped on the super-app side

Branch `upstream-week5&6-pr3`. All make the super-app **bidirectionally
wire-compatible** with the standalone — no standalone change is required for
interop, only for robustness (§4).

| Task | Commit    | What                                                                                                                                                                                                |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4    | `3ca1585` | `calendarListCodec.ts` — encode/decode a CalendarList ⇆ the standalone **tags array** (`["title",…]`, `["content",…]`, `["color",…]`, `["a", coordinate, relayHint, viewKey]`).                     |
| 5    | `01fec50` | List CRUD persists the **tags array** (not an object); `fetchCalendarLists` skips non-array payloads instead of throwing. **Fixes Error 1.**                                                        |
| 6    | `df87d85` | `viewKey.ts` — `generateViewKey()`, `encrypt/decryptWithViewKey(nsec,…)`, `build/parseEventRef`.                                                                                                    |
| 7    | `2563dc8` | Private events use a per-event **viewKey**: content encrypted with the viewKey nsec; gift-wrap rumor `content:""` + tags `[["a", coord, relayHint], ["viewKey", nsec]]`. **Fixes Error 2 trigger.** |
| 8    | `ae76b68` | Read path: decrypt private content via the invitation's viewKey; `extractInvitationFromWrap` reads the standalone `a`+`viewKey` rumor shape (legacy JSON kept as fallback).                         |
| 9    | `2a37fa2` | Event↔calendar membership via `eventRefs` (`addEventToCalendarList`/`removeEventFromCalendarList`/`moveEventBetweenCalendarLists`), mirroring `calendarList.ts:275-361`.                            |

After these, a calendar/event authored in the super-app round-trips into the
standalone: the kind-32123 list decodes to a tags array, and private-event
invitations carry the `a`+`viewKey` rumor the standalone already parses.

---

## 4. Recommended defensive guards for the standalone repo

The standalone should **never hard-fail on relay-sourced data it cannot parse**.
Some guards already exist in the vendored snapshot (good — keep them); the
remaining gaps are the `nip19.decode` callsites.

### Already present (acknowledge / keep)

- `calendarList.ts:214-219` — kind guard in the calendar-list stream.
- `calendarList.ts:220-225` — try/catch around `decryptCalendarList`.
- `nostr.ts:593-596` / `:602-604` — missing-`a`-tag / missing-`viewKey` guards in
  `getDetailsFromGiftWrap`.
- `nostr.ts:651-656` — try/catch around `getDetailsFromGiftWrap` in the gift-wrap
  subscription.

### Still recommended

1. **Guard every `nip19.decode` of user/relay-sourced keys.** Wrap a
   `safeNip19Decode(value, expectedPrefix)` helper that returns `null` (and
   `console.warn`s) instead of throwing when the value is empty, the wrong type,
   or contains a `:` (i.e. is a coordinate, not a bech32 entity). Apply at
   `nostr.ts:203, 255, 425, 515, 792`. Example:

   ```ts
   function safeNip19Decode(value: string | undefined, prefix: "nsec" | "naddr") {
     if (!value || value.includes(":") || !value.startsWith(prefix)) {
       console.warn(`Skipping malformed ${prefix}:`, value);
       return null;
     }
     try {
       return nip19.decode(value as `${typeof prefix}1${string}`).data;
     } catch (e) {
       console.warn(`nip19.decode failed for`, value, e);
       return null;
     }
   }
   ```

   Callers skip the invitation/event when it returns `null` rather than letting
   the throw escape the subscription callback.

2. **Keep calendar-list ingest log-only on bad payloads** (already done at
   `calendarList.ts:220`). A non-array / object payload should be skipped with a
   warning, never thrown to the page.

3. **Treat the gift-wrap subscription callback as a hard isolation boundary.**
   The try/catch at `nostr.ts:651` is correct; ensure _every_ subscription
   `onEvent` that touches `nip19`/`nip59`/`JSON.parse` is similarly wrapped so one
   bad event from one client cannot abort the load of the rest.

These three changes make the standalone resilient to **any** foreign client, not
just this super-app version.

---

## 5. Wire-format appendix (tag-by-tag)

Coordinate form throughout: `"<kind>:<authorPubkey>:<dTag>"`. All "private"
content is a JSON-stringified **tags array** carried in NIP-44-encrypted `content`.

### kind 32123 — Calendar list (addressable, NIP-44 self-encrypted content)

- Outer tags: `["d", <calendarId>]`.
- Decrypted `content` = JSON tags array:
  - `["title", <name>]`
  - `["content", <description>]`
  - `["color", <hex>]`
  - `["notifications", "disabled"]` _(optional; standalone-only, super-app ignores)_
  - `["a", <eventCoordinate>, <relayHint>, <viewKey nsec>]` — one per member event.

### kind 31923 — Public calendar event (addressable, plaintext)

Tags (super-app `publishPublicCalendarEvent`):
`["d", id]`, `["title", …]`, `["description", …]`,
`["start", <unixSec>]`, `["end", <unixSec>]`,
`["location", …]?`, `["r", <website>]?`, `["image", …]?`,
`["t", <category>]*`, `["p", <participantPubkey>]*`,
`["start_tzid", …]?`, `["end_tzid", …]?`,
`["L","rrule"] + ["l", <RRULE>, "rrule"]`? , `["form", <naddr>]?`. `content:""`.

### kind 32678 — Private calendar event (addressable, viewKey-encrypted content)

- Outer tags: `["d", id]`. `content` = NIP-44 encrypt (to the **viewKey** pubkey)
  of the JSON tags array `[["title",…],["description",…],["start",…],["end",…],
["location",…]?, ["t",…]*, ["p",…]*, ["start_tzid",…]?, ["end_tzid",…]?,
["L","rrule"]+["l",<RRULE>,"rrule"]?, ["form",<naddr>]?]`.
- Anyone holding the viewKey nsec can decrypt; the author shares it via the gift
  wrap below.

### kind 1052 — Calendar-event gift wrap (NIP-59) → rumor kind 52

Rumor (`content:""`) tags:
`["a", <eventCoordinate>, <relayHint>]`, `["viewKey", <nsec>]`.
Consumed by `getDetailsFromGiftWrap` (`nostr.ts:590`).

### kind 31925 — Public RSVP (addressable) · kind 32069 — Private RSVP

Tags: `["a", <eventCoordinate>]`, `["status", "accepted"|"tentative"|"declined"]`,
`["start", <unixSec>]?` + `["end", <unixSec>]?` (suggest-a-new-time),
`["d", <id>]`. Free-text **note** lives in `content`. Parsed by the standalone's
`parseRSVPTags` (`nostr.ts:677-697` → `RSVPRecord`). _(Suggested-time + note are
Phase-3 work in the super-app; format documented here for parity.)_

### kind 1055 — RSVP gift wrap (NIP-59) → rumor kind 55

Private-RSVP analogue of 1052: gift-wrapped rumor carrying the RSVP tags above,
addressed to the event organiser.

---

## 6. TL;DR for the standalone maintainer

1. Nothing is required for **interop** — the super-app now speaks your exact wire
   format (tags-array lists + `a`/`viewKey` invitation rumors).
2. For **robustness**, add a `safeNip19Decode` guard at the five `nip19.decode`
   callsites (`nostr.ts:203, 255, 425, 515, 792`) so a `:`-containing or otherwise
   malformed key from _any_ client is skipped, not thrown. The calendar-list and
   gift-wrap subscription try/catches you already have are the right pattern;
   extend it to the decode sites.
