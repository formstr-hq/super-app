# Calendar SDK — Protocol & Implementation Reference

> **Superseded as an implementation guide.** This document described the protocol so
> that a headless SDK could be built from it. That SDK exists:
> [`@formstr/calendar-sdk`](https://www.npmjs.com/package/@formstr/calendar-sdk), whose
> own README is now the authority on wire format and API. The super-app consumes it and
> keeps no protocol implementation of its own — see
> [../plans/2026-08-18-calendar-sdk-integration.md](../plans/2026-08-18-calendar-sdk-integration.md).
>
> Kept for the protocol archaeology: the tag-by-tag wire notes and the divergence
> analysis between the two implementations are still accurate history and still useful
> when reading relay traffic. Two things below have since changed on the wire, and the
> SDK follows the new shape:
>
> - **Invitation gift wraps are kind 1059 tagged `["k", "1052"]`, with a NIP-17 kind-14
>   rumor.** This doc describes the older bare kind-1052 wrap with a kind-52 rumor.
>   calendar.formstr.app v2.1.0 writes the new shape and reads both.
> - **Invitation dismissal is a NIP-09 kind-5 deletion of the wrap**, not a kind-84
>   participant removal.
>
> The `@formstr/agent` calendar service this doc cites as its reference implementation
> has been deleted; the SDK replaced it.

> A protocol-first reference for building a **headless TypeScript calendar SDK** on
> Nostr. It documents the complete on-relay wire format, the cryptography, the
> discovery model, a proposed headless API surface, and the UI/interaction
> patterns — distilled from two interoperable implementations:
>
> - **`nostr-calendar`** — the standalone web/mobile app at
>   [calendar.formstr.app](https://calendar.formstr.app). Source under
>   [../nostr-calendar/](../nostr-calendar/).
>   Ships formal NIP proposals in
>   [../nostr-calendar/nips/](../nostr-calendar/nips/).
> - **`@formstr/agent` calendar service** — a headless TS implementation already
>   factored out of any UI, under
>   [../common-packages/packages/agent/src/services/calendar/](../common-packages/packages/agent/src/services/calendar/).
>   This is the closest existing thing to the SDK you are building and is the
>   primary reference implementation cited throughout.
>
> Anything an SDK publishes must be byte-compatible with what `calendar.formstr.app`
> reads, and vice-versa. Where the two implementations diverge, this doc flags the
> **canonical** (NIP-standard / upstream) shape and any super-app-only quirks.

**Repo geography (updated 2026-07-02).** `../nostr-calendar` is a sibling clone of
`formstr-hq/nostr-calendar` (`main`) — we have **no push access**; upstream
contributions go via a fork. The agent/core sources are canonical in
`../common-packages` (branch `calendar-sdk`, off `migrate-mcp-core-agent`); the
copies under `super-app/packages/{core,agent}` are pending removal (migration
Task 7). The SDK itself will be built as a new package in `../common-packages`.

**Delivery goal.** Ship `@formstr/calendar-sdk` so a third-party dev consumes it the
way they consume `@formstr/sdk` today (`../nostr-forms/packages/formstr-sdk`):
`npm install`, import a class, call methods — zero relay/pool wiring required,
signer optional where the protocol allows. See [§14](#14-packaging--suggested-layout).
`calendar.formstr.app` itself already consumes `@formstr/sdk@^0.2.7` and
`@formstr/signer@^0.2.2` from npm, so this consumption model is proven in this
exact ecosystem.

---

## Table of contents

1. [Design philosophy](#1-design-philosophy)
2. [Architecture: the three tiers](#2-architecture-the-three-tiers)
3. [Injectable infrastructure contracts](#3-injectable-infrastructure-contracts)
4. [Event-kind registry](#4-event-kind-registry)
5. [Cryptography](#5-cryptography)
6. [Wire protocol — object by object](#6-wire-protocol--object-by-object)
   - [6.1 Public calendar event (31923)](#61-public-calendar-event-kind-31923)
   - [6.2 Private calendar event (32678 / 32681)](#62-private-calendar-event-kind-32678-time--32681-day)
   - [6.3 Calendar list (32123)](#63-calendar-list-kind-32123)
   - [6.4 Gift-wrap invitation (1052 / rumor 52)](#64-gift-wrap-invitation-kind-1052--rumor-52)
   - [6.5 RSVP (31925 / 32069)](#65-rsvp-public-31925--private-32069)
   - [6.6 Participant removal (84)](#66-participant-removal-kind-84)
   - [6.7 Public busy list (31926)](#67-public-busy-list-kind-31926)
   - [6.8 Scheduling / booking (31927, 32680, 1057/57, 1058/58)](#68-appointment-scheduling)
   - [6.9 Deletion (NIP-09, kind 5)](#69-deletion-nip-09-kind-5)
7. [Recurrence (RRULE / NIP-52R)](#7-recurrence-rrule--nip-52r)
8. [Discovery & relays](#8-discovery--relays)
9. [Proposed headless API surface](#9-proposed-headless-api-surface)
10. [Domain data models](#10-domain-data-models)
11. [End-to-end flows](#11-end-to-end-flows)
12. [UI / interaction patterns](#12-ui--interaction-patterns)
13. [Invariants & gotchas](#13-invariants--gotchas-hard-won)
14. [Packaging & suggested layout](#14-packaging--suggested-layout)
15. [Source map](#15-source-map)

---

## 1. Design philosophy

**Headless.** The SDK owns _protocol logic_ (build/encrypt/sign templates, parse/
decrypt/dedupe results, compute discovery filters) and owns **no** I/O, storage,
keys, or React. Networking, key custody, and persistence are injected by the host.
This is exactly how the agent service is structured: every function takes its
signer and relay-IO from singletons that the host wires up
([../common-packages/packages/agent/src/services/calendar/service.ts](../common-packages/packages/agent/src/services/calendar/service.ts)).

**Protocol-first.** The unit of truth is the **Nostr event on the relay**, not a
TypeScript object. Two independently written clients (the standalone and the
agent) interoperate solely because they agree on kinds, tag shapes, and encryption.
Treat the wire format in [§6](#6-wire-protocol--object-by-object) as the spec and
your types as a projection of it.

**Replaceable, not mutable.** Nearly every calendar object is a NIP-01
_parameterized replaceable event_ (`30000 ≤ kind < 40000`), addressed by the
coordinate `kind:pubkey:dTag`. "Editing" means re-publishing the same coordinate
with a newer `created_at`; "deleting" means a NIP-09 kind-5 tombstone. Your SDK
must dedupe **newest-wins per coordinate** on every read.

**Privacy via view keys, not identity.** Private events are _not_ encrypted to the
author's key — they are encrypted to a throwaway per-event keypair (the **view
key**) whose secret is then distributed to invitees. This decouples "who can read
the event" from "who signed it," and lets the author edit without re-keying
recipients. This is the single most important concept in the protocol; see
[§5.3](#53-the-view-key-pattern).

---

## 2. Architecture: the three tiers

```
┌──────────────────────────────────────────────────────────────────┐
│ TIER 3 — Host (NOT in the SDK)                                     │
│   • Signer implementation (local nsec / NIP-07 / NIP-46 bunker)    │
│   • Relay pool + persistence/cache + UI                            │
│   • Provides the two contracts in §3 to the SDK                    │
└───────────────▲───────────────────────────────────┬───────────────┘
                │ inject                             │ call
┌───────────────┴───────────────────────────────────▼───────────────┐
│ TIER 2 — SDK domain layer (the API surface, §9)                    │
│   createEvent / fetchEvents / rsvp / approveBooking / …            │
│   Orchestrates: resolve relays → build template → encrypt →        │
│   sign → publish → link into list → gift-wrap invites              │
│   Dedupe, NIP-09 filtering, viewKey resolution                     │
└───────────────▲───────────────────────────────────┬───────────────┘
                │ uses                               │ produces
┌───────────────┴───────────────────────────────────▼───────────────┐
│ TIER 1 — SDK codec/crypto layer (pure, no I/O, §5–§6)              │
│   tags ↔ domain object  ·  NIP-44 self-encrypt  ·  NIP-59 wrap     │
│   view-key generate/encrypt  ·  RRULE expand  ·  coordinate parse  │
└────────────────────────────────────────────────────────────────────┘
```

Tier 1 is trivially unit-testable (string in, string out). Tier 2 is testable with
a fake runtime/signer. Keep Tier 2 entry points thin glue over Tier 1 helpers — the
agent codebase enforces exactly this (`encodeCalendarList`/`decodeCalendarList`,
`parseEventRef`, `parseBusyListEvent`, `busyListToTags`, `extractInvitationFromWrap`
are all pure and separately tested).

---

## 3. Injectable infrastructure contracts

The SDK depends on **two** interfaces only. In the agent they live in `@formstr/core`
and are exposed as singletons (`signerManager`, `nostrRuntime`, `relayManager`); in
your SDK, prefer passing them explicitly (constructor or per-call context object) so
the SDK has no hidden globals.

### 3.1 Signer

The signer holds the user's key and performs signing + NIP-44. Source:
[../common-packages/packages/core/src/signer/types.ts](../common-packages/packages/core/src/signer/types.ts).

```ts
interface NostrSigner {
  getPublicKey(): Promise<string>; // hex
  signEvent(event: EventTemplate): Promise<VerifiedEvent>; // adds id+pubkey+sig
  // NIP-44 v2 — required for every private object
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  // NIP-04 — legacy, not used by calendar
  encrypt?(pubkey: string, plaintext: string): Promise<string>;
  decrypt?(pubkey: string, ciphertext: string): Promise<string>;
}
```

Implementations the host may provide: a local-key signer (`LocalSigner`), a browser
extension (`NIP07Signer`), or a remote bunker (`NIP46Signer`). The SDK never cares
which.

**Align the SDK's signer type with `@formstr/sdk`'s `FormsSigner`** —
`{ getPublicKey, signEvent, nip44Encrypt, nip44Decrypt }`, all four required
(calendar can't do private objects without NIP-44). Then one signer object satisfies
both SDKs. Both producers already exist in production: `@formstr/signer`'s
`createSigner` drives `calendar.formstr.app`'s `SignerManager`
([../nostr-calendar/src/common/signer/index.ts](../nostr-calendar/src/common/signer/index.ts)),
which handles NIP-07 extension, NIP-46 bunker, and Android NIP-55
(`nostr-signer-capacitor-plugin`) uniformly.

> **Critical `this`-binding caveat.** Some signer classes (e.g. `@formstr/signer`)
> use **unbound private-field methods**. Copying a bare method reference
> (`{ nip44Encrypt: signer.nip44Encrypt }`) detaches `this` and throws
> `Cannot read private member #e`. Always wrap in an arrow that calls on the
> instance, or `.bind` each method — upstream ships exactly this adapter as
> [`toFormsSigner`](../nostr-calendar/src/utils/toFormsSigner.ts) and its comment
> documents the failure mode. The SDK should export the same adapter (or accept
> `ActiveSigner` directly) so consumers never hit this.

### 3.2 Relay runtime

A thin relay-pool facade. Source:
[../common-packages/packages/core/src/runtime/NostrRuntime.ts](../common-packages/packages/core/src/runtime/NostrRuntime.ts).

```ts
interface NostrRuntime {
  // One-shot query: open subs on all relays, collect until EOSE/timeout, dedupe by id.
  querySync(relays: string[], filter: Filter, timeoutMs?: number): Promise<Event[]>;
  // Live subscription. Returns a handle with .close().
  subscribe(
    relays: string[],
    filters: Filter[],
    cbs: { onEvent: (e: Event) => void; onEose?: () => void },
  ): SubscriptionHandle;
  // Publish to all relays (best-effort, Promise.allSettled under the hood).
  publish(relays: string[], event: Event, timeoutMs?: number): Promise<void>;
}
```

### 3.3 Relay selection

A function `relaysForModule("calendar") → string[]`. The default set is fixed and
**must be a superset of the standalone's defaults** for cross-app sync (see
[§8.3](#83-relay-defaults)). Source:
[../common-packages/packages/core/src/relay/module-defaults.ts](../common-packages/packages/core/src/relay/module-defaults.ts).

Optionally the host can resolve a user's **NIP-65** (kind-10002) relays for inbox
routing of gift wraps ([§8.4](#84-nip-65--gift-wrap-routing)).

---

## 4. Event-kind registry

The authoritative map. Canonical values are from upstream `EventConfigs`
([../nostr-calendar/src/common/EventConfigs.ts](../nostr-calendar/src/common/EventConfigs.ts))
and the agent `CALENDAR_KINDS`
([../common-packages/packages/agent/src/services/calendar/types.ts](../common-packages/packages/agent/src/services/calendar/types.ts)).

| Kind          | Name                          | Class                  | Encrypted?           | Authored by | Purpose                                                     |
| ------------- | ----------------------------- | ---------------------- | -------------------- | ----------- | ----------------------------------------------------------- |
| **31923**     | Public time event             | Param-replaceable      | No                   | user        | NIP-52 public event                                         |
| **31922**     | Public day event              | Param-replaceable      | No                   | user        | NIP-52 all-day event — **spec-only, see §4.1**              |
| **32678**     | Private time event            | Param-replaceable      | **NIP-44 (viewKey)** | user        | Encrypted time event                                        |
| **32681**     | Private day event             | Param-replaceable      | **NIP-44 (viewKey)** | user        | Encrypted all-day event (NIP-52E) — **spec-only, see §4.1** |
| **32123**     | Calendar list                 | Param-replaceable      | **NIP-44 (self)**    | user        | Named collection of event refs                              |
| **1052**      | Calendar gift-wrap            | Regular (NIP-59)       | **NIP-44 (layered)** | ephemeral   | Invitation carrying viewKey                                 |
| **52**        | Calendar rumor                | Unsigned (inside 1052) | —                    | sender      | Inner pointer (a-tag + viewKey)                             |
| **31925**     | Public RSVP                   | Param-replaceable      | No                   | responder   | NIP-52 RSVP                                                 |
| **32069**     | Private RSVP                  | Param-replaceable      | **NIP-44 (viewKey)** | responder   | Encrypted RSVP for a private event                          |
| **84**        | Participant removal           | Regular                | No                   | participant | Opt out of an event (NIP-09-style)                          |
| **31926**     | Public busy list              | Param-replaceable      | No (empty content)   | user        | Free/busy ranges, one per month                             |
| **31927**     | Scheduling page               | Param-replaceable      | **NIP-44 (viewKey)** | host        | Calendly-style booking link                                 |
| **32680**     | Scheduling-pages list         | Param-replaceable      | **NIP-44 (self)**    | host        | viewKey backup for own pages                                |
| **1057 / 57** | Booking request wrap / rumor  | NIP-59                 | layered              | booker      | Request a slot                                              |
| **1058 / 58** | Booking response wrap / rumor | NIP-59                 | layered              | host        | Approve/decline                                             |
| **5**         | Deletion                      | Regular                | No                   | author      | NIP-09 tombstone                                            |
| **10002**     | Relay list                    | Replaceable            | No                   | user        | NIP-65 inbox/outbox relays                                  |

### 4.1 Kind wrinkles you must handle

- **Recurring private events use 32678**, _not_ a distinct kind — recurrence is
  signalled by RRULE tags inside the encrypted payload (NIP-52R, [§7](#7-recurrence-rrule--nip-52r)).
  The agent's `CALENDAR_KINDS.privateRecurring = 32679` appears **only in read
  filters** as a legacy/defensive compatibility kind; the agent _publishes_
  recurring private events as 32678. Read 32678/32679/32681; write 32678 (time) /
  32681 (day).
- **Private RSVP is 32069** (canonical, what `calendar.formstr.app` reads). The
  agent also has a NIP-59 gift-wrap fallback (`rsvpGiftWrap 1055 / rsvpRumor 55`)
  used only when the caller lacks the event's viewKey — **upstream never reads it**.
  Prefer 32069 whenever you can resolve the viewKey ([§6.5](#65-rsvp-public-31925--private-32069)).
- **Day events (31922 / 32681) are spec-only today** (verified 2026-07-02):
  NIP-52E specs 32681, but **neither client implements day events** — upstream's
  `EventKinds` enum ([../nostr-calendar/src/common/EventConfigs.ts](../nostr-calendar/src/common/EventConfigs.ts))
  has no 31922/32681 entry and no code reads or writes them; the agent models
  everything as time events. Per spec they carry `start`/`end` as `YYYY-MM-DD`
  **date strings** with an **exclusive** `end`. The SDK should reserve the kinds
  and parse them defensively, but treating them as a v2 feature loses nothing —
  there are no day events on relays to interop with.
- **Upstream's registry has grown beyond calendar:** kind 30168/1069 (Formstr
  NIP-101 form template/response — used for event registration forms via
  `@formstr/sdk`) and kind 1984 (NIP-56 reporting). Neither belongs in the
  calendar SDK's write surface; 30168 matters only for the `["form", naddr,
viewKey?]` attachment (§6.2.1).

---

## 5. Cryptography

Three primitives cover the entire module. Reference:
[../common-packages/packages/core/src/crypto/nip44.ts](../common-packages/packages/core/src/crypto/nip44.ts),
[../common-packages/packages/core/src/crypto/nip59.ts](../common-packages/packages/core/src/crypto/nip59.ts).

### 5.1 NIP-44 (the only symmetric scheme)

NIP-44 v2 is the workhorse. Conversation key derives from an ECDH between a secret
key and a public key, then ChaCha20 + HMAC. You only ever call:

```ts
nip44.v2.utils.getConversationKey(secretKey, publicKey) → key
nip44.v2.encrypt(plaintext, key) → ciphertext
nip44.v2.decrypt(ciphertext, key) → plaintext
```

Key property used everywhere: `getConversationKey(a, B) === getConversationKey(b, A)`
(ECDH symmetry). That is what makes _self-encryption_ and _view-key sharing_ work.

### 5.2 Self-encryption (calendar lists, scheduling-pages list)

Encrypt to **your own pubkey**: `conversationKey(yourSecret, yourPubkey)`. Only your
key can derive it, so the content is private even on a public relay. Through the
signer this is:

```ts
async function nip44SelfEncrypt(signer, plaintext) {
  const pk = await signer.getPublicKey();
  return signer.nip44Encrypt(pk, plaintext); // recipient == self
}
async function nip44SelfDecrypt(signer, ciphertext) {
  const pk = await signer.getPublicKey();
  return signer.nip44Decrypt(pk, ciphertext); // sender == self == event.pubkey
}
```

Used by: **calendar lists (32123)** and the **scheduling-pages list (32680)**.

### 5.3 The view-key pattern (private events, RSVPs, scheduling pages)

This is **self-encryption under a throwaway keypair** instead of the user's identity
key. Reference:
[../common-packages/packages/agent/src/services/calendar/viewKey.ts](../common-packages/packages/agent/src/services/calendar/viewKey.ts).

```
1. viewSecret = generateSecretKey()              // random, per-event
2. viewPubkey = getPublicKey(viewSecret)
3. ck = getConversationKey(viewSecret, viewPubkey)   // self-conversation
4. content = nip44.encrypt(JSON.stringify(innerTags), ck)
5. The event is SIGNED by the user, but ENCRYPTED to the viewKey.
6. viewSecret is bech32-encoded as `nsec1…` and distributed to invitees
   (via the calendar-list a-ref and the gift-wrap rumor).
```

Anyone holding the `nsec` reconstructs `ck` and decrypts — regardless of who signed
the event. Concretely:

```ts
function signerFromNsec(nsec) {
  const { type, data } = nip19.decode(nsec);
  if (type !== "nsec") throw new Error("expected nsec view key");
  return new LocalSigner(data); // a signer whose key IS the viewKey
}
const encryptWithViewKey = (nsec, pt) => nip44SelfEncrypt(signerFromNsec(nsec), pt);
const decryptWithViewKey = (nsec, ct) => nip44SelfDecrypt(signerFromNsec(nsec), ct);
```

Why not just self-encrypt to the author? Because then **only the author** could read
the event — invitees couldn't. The viewKey is the shareable read-capability.

> **No forward secrecy / no revocation.** Once a viewKey is shared it can be
> re-shared; editing the event (same `d`) keeps the same viewKey by default so prior
> invitees keep access. To truly cut someone off you must publish a _new_ event with
> a _new_ viewKey and re-distribute — there is no in-place revocation.

### 5.4 NIP-59 gift wrap (invitations, RSVP fallback, booking req/resp)

Three nested layers hide _both_ the payload and the sender's identity from relays.
Reference: [../common-packages/packages/core/src/crypto/nip59.ts](../common-packages/packages/core/src/crypto/nip59.ts).

```
Rumor   (unsigned, kind 52/55/57/58)      ← the actual payload, in tags
  │ JSON.stringify, nip44Encrypt(sender → recipient)
Seal    (kind 13, signed by SENDER)       ← authenticates sender to recipient only
  │ JSON.stringify, nip44Encrypt(EPHEMERAL → recipient)
Wrap    (kind 1052/1055/1057/1058, signed by a fresh EPHEMERAL key)
        tags: [["p", recipientPubkey]]    ← the only public routing info
```

The wrap's signer is a throwaway key, so relays can't see who sent it.
The recipient subscribes `{ kinds:[1052], "#p":[myPubkey] }`, then peels:
`wrap → (decrypt with my key) → seal → (decrypt with my key) → rumor`.

**Timestamp divergence (verified 2026-07-02).** The two implementations differ:

- **Agent core** (`nip59.ts` in `@formstr/core`): rumor keeps its **real**
  `created_at`; seal and wrap are randomized **±2 days** (NIP-59's
  anti-timing-correlation recommendation).
- **Upstream** ([../nostr-calendar/src/common/nip59.ts](../nostr-calendar/src/common/nip59.ts)):
  **real timestamps on all three layers** — rumor, seal, and wrap all use `now()`;
  the jitter (and the old `useRealTimestamp` flag) is gone.

Interop is unaffected — nothing matches on seal/wrap time, and upstream's
`unwrapManyEvents` sorts by the **rumor's** `created_at`, which both sides keep
real. **SDK recommendation:** keep the rumor timestamp real always; jitter
seal/wrap by default (privacy per NIP-59) behind an option
(`wrapTimestamps: "jittered" | "real"`, default `"jittered"`) so strict
byte-parity with current upstream is one flag away.

```ts
async function wrapEvent(rumorTemplate, signer, recipientPubkey, wrapKind = 1059) {
  const rumor = createRumor(rumorTemplate);
  rumor.pubkey = await signer.getPublicKey();
  const seal = await createSeal(rumor, signer, recipientPubkey); // kind 13
  return createWrap(seal, recipientPubkey, wrapKind); // ephemeral-signed
}
async function unwrapEvent(wrap, signer) {
  const seal = JSON.parse(await signer.nip44Decrypt(wrap.pubkey, wrap.content));
  const rumor = JSON.parse(await signer.nip44Decrypt(seal.pubkey, seal.content));
  return rumor; // unsigned event
}
```

---

## 6. Wire protocol — object by object

For every object below: only the **outer** event reaches the relay in plaintext;
where marked, the real data is in the NIP-44 `content`. All outer
parameterized-replaceable events carry exactly `tags: [["d", <id>]]` unless noted.

### 6.1 Public calendar event (kind 31923)

Plaintext NIP-52. Reference: `publishPublicCalendarEvent`
([../common-packages/packages/agent/src/services/calendar/service.ts](../common-packages/packages/agent/src/services/calendar/service.ts)).

```jsonc
{
  "kind": 31923,
  "content": "", // description goes in a tag OR content (read both)
  "tags": [
    ["d", "7f3a2b1c"], // 8-hex id (agent uses crypto.randomUUID().slice(0,8))
    ["title", "Launch party"],
    ["description", "Doors at 7"],
    ["start", "1700002800"], // unix SECONDS, string
    ["end", "1700010000"],
    ["location", "Office"], // repeatable
    ["r", "https://example.com"], // website
    ["image", "https://…/x.png"],
    ["t", "social"], // category, repeatable
    ["p", "<hex pubkey>"], // participant, repeatable
    ["start_tzid", "America/New_York"],
    ["end_tzid", "America/New_York"],
    ["L", "rrule"],
    ["l", "FREQ=WEEKLY;BYDAY=MO"], // recurrence, see §7
  ],
}
```

**Title-tag divergence (verified 2026-07-02).** Upstream's
`publishPublicCalendarEvent` ([../nostr-calendar/src/common/nostr.ts](../nostr-calendar/src/common/nostr.ts))
writes `["name", <title>]` with the description in `content`; the agent writes
`["title", …]` + `["description", …]` with empty content. **Both parsers read
both** (upstream `parser.ts` falls through `title`/`name`; the agent falls back
`title ?? name`), so reads interop — but the SDK should **write `title`**
(NIP-52 canonical) and **read both**, ditto description-from-tag-or-content.

> **Upstream bug worth a fork PR:** the same function emits locations as
> `["image", location]` rows (copy-paste), so upstream public events published
> with locations grow bogus image tags and lose the locations. Don't replicate;
> write `["location", …]`.

> Public events: upstream's main view **now** subscribes to public 31923 events
> globally (all authors) with a relay-side `since`/`until` window and client-side
> date filtering — the old "public fetcher is dead code" state is gone. Two
> caveats remain: the relay window filters on **`created_at`** (publish time), so
> long-lived/far-future public events can be missed there (§8.2); and public refs
> still can't be privately listed. Default to private events for anything that
> must sync reliably ([§13.1](#131-discovery-the-1-bug)).

### 6.2 Private calendar event (kind 32678 time / 32681 day)

Outer event leaks only the `d` tag. Reference: `publishPrivateCalendarEvent`
([../common-packages/packages/agent/src/services/calendar/service.ts](../common-packages/packages/agent/src/services/calendar/service.ts)),
and NIP-52E
([../nostr-calendar/nips/NIP-52E.md](../nostr-calendar/nips/NIP-52E.md)).

```jsonc
// On the relay:
{ "kind": 32678, "tags": [["d", "7f3a2b1c"]], "content": "<NIP-44(viewKey) ciphertext>" }
```

The plaintext inside `content` is a **JSON array of tag-rows** (NOT an object):

```jsonc
[
  ["title", "Team Sync"],
  ["description", "Weekly alignment"],
  ["start", 1700002800], // for 32678: JSON NUMBER, unix seconds
  ["end", 1700006400], // for 32681: "YYYY-MM-DD" strings, end EXCLUSIVE
  ["d", "7f3a2b1c"], // ← MUST be present, see §13.2
  ["image", "https://…"],
  ["location", "https://meet.example.com/abc"],
  ["t", "work"],
  ["p", "<author hex>"], // organizer's own p-row FIRST (RSVP-auth context)
  ["p", "<participant hex>"], // then invitees
  ["start_tzid", "America/New_York"],
  ["L", "rrule"],
  ["l", "FREQ=WEEKLY;BYDAY=MO"],
  ["notification", "enabled"], // device-local reminder preference
  ["form", "<naddr>", "<form viewKey?>"], // optional Formstr registration form, §6.2.1
]
```

Required inner rows: `title`, `start`, `d`. Everything else optional.

**Encrypt/sign/publish:**

```ts
const viewKeyNsec = draft.viewKey ?? generateViewKey().nsec; // reuse on edit!
const content = await encryptWithViewKey(viewKeyNsec, JSON.stringify(innerTags));
const signed = await signer.signEvent({ kind: 32678, created_at, tags: [["d", id]], content });
await runtime.publish(relays, signed);
```

The published event is then **linked into a calendar list** and **gift-wrapped to
participants** — both are mandatory for discovery; see [§11.1](#111-create-a-private-event).

#### 6.2.1 Attached registration form (`["form", naddr, viewKey?]`)

A private event may attach Formstr forms (RSVP questionnaires). Each is one
`["form", naddr, viewKey?]` row inside the encrypted payload. The optional 3rd
element is the form's **read-only viewKey** — never its admin/response key. Full
spec: [../nostr-calendar/RSVP_SPEC.md](../nostr-calendar/RSVP_SPEC.md).
Parsing maps it to `registrationFormRef` / `registrationFormViewKey`
([service.ts `parseCalendarEvent`](../common-packages/packages/agent/src/services/calendar/service.ts)).

### 6.3 Calendar list (kind 32123)

The **discovery index** for private events, and the linchpin of the whole protocol.
A user has one list per "calendar" (Work, Personal…). Self-encrypted. Reference:
codec at
[../common-packages/packages/agent/src/services/calendar/calendarListCodec.ts](../common-packages/packages/agent/src/services/calendar/calendarListCodec.ts).

```jsonc
{ "kind": 32123, "tags": [["d", "a3f8c21b"]], "content": "<NIP-44(self) ciphertext>" }
```

Plaintext = JSON array of tag-rows:

```jsonc
[
  ["title", "Work"],
  ["content", "Work meetings"], // description (note the tag name is "content")
  ["color", "#1a73e8"],
  ["notifications", "disabled"], // optional; ONLY the non-default value is persisted
  ["a", "32678:<author>:<dTag>", "wss://relay.damus.io/", "nsec1…"], // event ref
  ["a", "32678:<author>:<dTag>", "", "nsec1…"],
]
```

Each `["a", …]` is an **event reference** — the heart of discovery + key
distribution:

| Position | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| `[1]`    | NIP-01 coordinate `kind:hex-pubkey:dTag`                    |
| `[2]`    | relay hint (where the event was published; `""` if unknown) |
| `[3]`    | **`nsec` view key** to decrypt the referenced event         |

`d`-tag derivation (upstream, current code —
[../nostr-calendar/src/common/calendarList.ts](../nostr-calendar/src/common/calendarList.ts)
`createCalendar`): `sha256(JSON.stringify(calendarData) + "-" + Date.now()).hex.slice(0,30)`
(an older build used `SHA-256("<title>:<created_at>").slice(0,16)`); the agent uses
`crypto.randomUUID().slice(0,8)`. Any of these is fine — the `d` only needs to be
unique per author; never parse meaning out of it.

**Decode quirks your parser must tolerate** (all from real on-relay data — see
[`decodeCalendarList`](../common-packages/packages/agent/src/services/calendar/calendarListCodec.ts)):

- A legacy **double-`a`** row `["a","a",coord,…]` (shift fields back by one).
- A legacy **JSON object** payload instead of a tags array — load it _and_ re-publish
  as the array shape ([§13.4](#134-object-vs-array-calendar-lists)).

Upstream's decoder does **neither** heal (verified 2026-07-02): `decryptCalendarList`
reads `["a", …]` rows positionally and throws on a non-array payload — current
builds merely isolate the throw per list (see §13.4). The healing behavior is
agent-only today and **belongs in the SDK**, since it's what makes old on-relay
data readable everywhere.

### 6.4 Gift-wrap invitation (kind 1052 / rumor 52)

Delivered per participant (including the author) when a private event is created.
The rumor inside carries the pointer + key. Reference:
`publishPrivateCalendarEvent` (wrap side) and `extractInvitationFromWrap` (read side,
[../common-packages/packages/agent/src/services/calendar/rsvp.ts](../common-packages/packages/agent/src/services/calendar/rsvp.ts)).

Rumor (kind 52, unsigned, never broadcast on its own):

```jsonc
{
  "kind": 52,
  "content": "",
  "tags": [
    ["a", "32678:<author hex>:<dTag>", "<relay hint>"], // coordinate + where to fetch
    ["viewKey", "nsec1…"], // the decryption key
  ],
}
```

Then `seal (13) → wrap (1052)` per [§5.4](#54-nip-59-gift-wrap-invitations-rsvp-fallback-booking-reqresp).
The wrap is published to the **recipient's** NIP-65 relays, not the author's
([§8.4](#84-nip-65--gift-wrap-routing)).

**Receiving:** subscribe `{ kinds:[1052], "#p":[me] }`, unwrap, read the `a`
coordinate + `viewKey`. Recipients see these as **pending invitations** — they do
_not_ auto-appear on the calendar. Accepting = append the ref `[coord, relayHint,
viewKey]` to a chosen calendar list and re-publish it. Dedupe invitations against
existing list refs and against your own kind-84 removals.

### 6.5 RSVP (public 31925 / private 32069)

Reference: [../common-packages/packages/agent/src/services/calendar/rsvp.ts](../common-packages/packages/agent/src/services/calendar/rsvp.ts)
and [../nostr-calendar/RSVP_SPEC.md](../nostr-calendar/RSVP_SPEC.md).

All RSVP kinds use a **deterministic `d`-tag** so re-RSVPing _replaces_ the prior
one: `d = SHA-256("<responder>:<author>:<eventDTag>").hex.slice(0, 30)`.

**Public (31925)** — status/times in tags, comment in content:

```jsonc
{
  "kind": 31925,
  "content": "see you there",
  "tags": [
    ["d", "<rsvpId>"],
    ["a", "31923:<author>:<dTag>"],
    ["status", "accepted"],
    ["start", "<unix sec>"],
    ["end", "<unix sec>"],
  ],
} // start/end = "suggest a new time"
```

`status ∈ { accepted, declined, tentative }`.

**Private (32069)** — the entire payload is NIP-44(viewKey)-encrypted; tags reveal
only the coordinate:

```jsonc
{
  "kind": 32069,
  "content": "<NIP-44(viewKey) of {status, suggestedStart?, suggestedEnd?, comment?}>",
  "tags": [
    ["a", "32678:<author>:<dTag>"],
    ["d", "<rsvpId>"],
  ],
}
```

You need the event's viewKey to publish _and_ to read private RSVPs (resolve it from
your calendar-list refs via `lookupEventViewKey`). **Tally** = newest-wins per
responder pubkey across both kinds (`fetchRsvpsForEvent`).

### 6.6 Participant removal (kind 84)

A participant opts out of an event they were invited to. Same tag shape as a NIP-09
deletion but a distinct kind so it doesn't tombstone the event for everyone.
Reference: `publishParticipantRemovalEvent` / `fetchParticipantRemovals`
([service.ts](../common-packages/packages/agent/src/services/calendar/service.ts)).

```jsonc
{
  "kind": 84,
  "content": "<optional reason>",
  "tags": [
    ["a", "32678:<author>:<dTag>"],
    ["e", "<event id>"],
    ["k", "32678"],
  ],
}
```

Apply your own kind-84 set at invitation-load time so dismissed invitations stay
dismissed across sessions (relays keep re-serving the wraps otherwise).

### 6.7 Public busy list (kind 31926)

Free/busy _without leaking event details_. `content` MUST be empty. Reference:
[../common-packages/packages/agent/src/services/calendar/busyList.ts](../common-packages/packages/agent/src/services/calendar/busyList.ts),
NIP-52E §5.

**Monthly** — one event per `(user, YYYY-MM)`, `d` = the UTC month:

```jsonc
{
  "kind": 31926,
  "content": "",
  "tags": [
    ["d", "2024-12"],
    ["t", "2024-12"],
    ["t", "busy"],
    ["block", "1733230800", "1733232600"], // start,end unix SECONDS, repeatable
    ["block", "1733320800", "1733323200"],
  ],
}
```

**Recurring** — a single event with `d = "recurring"`; each block adds a 3rd RRULE
element: `["block", start, end, "FREQ=WEEKLY;BYDAY=MO"]` (start = first occurrence /
DTSTART; duration = `end − start`).

Rules: replaceable, so **every** block for the month must be present on each publish
(no partial updates). A range spanning months is emitted into **each** month it
touches. `addBusyRange`/`removeBusyRange` re-fetch the current month before
re-publishing to avoid clobbering another device's blocks. The hosted booking page
greys out slots that overlap these, so a host who never publishes them looks fully
free (double-booking risk).

### 6.8 Appointment scheduling

Calendly-style booking links. Full spec:
[../nostr-calendar/SCHEDULING_PROTOCOL.md](../nostr-calendar/SCHEDULING_PROTOCOL.md)
and the NIP at
[../nostr-calendar/nips/NIP-Appointment-Scheduling.md](../nostr-calendar/nips/NIP-Appointment-Scheduling.md).
Read/approve reference:
[../common-packages/packages/agent/src/services/calendar/booking.ts](../common-packages/packages/agent/src/services/calendar/booking.ts).

**Scheduling page (31927)** — always private in this client. Outer `tags:[["d",
pageId]]`; `content` = NIP-44(viewKey) of a tag array describing availability
(`title`, `duration_mode`, `slot_duration`, `avail`, `blocked`, `timezone`,
`min_notice`, `max_advance`, `buffer`, `expiry`, `location`, `event_title`,
`relay`). Share URL: `/schedule/<naddr>?viewKey=<hex>` (the `naddr` embeds relays;
the page is undecryptable without the hex viewKey).

**Scheduling-pages list (32680)** — self-encrypted backup so the host can recover a
page's viewKey on a fresh device. `tags:[["d", pageDTag]]`, content =
NIP-44(self) of `{ v:1, viewKey:"nsec…", dTag, createdAt }`; empty content =
tombstone. Read via `{ kinds:[32680], authors:[self] }`, decrypt, build
`Map<dTag, viewKeyNsec>`, then decrypt each 31927.

**Booking request (gift wrap 1057 / rumor 57)** — booker → host. Rumor tags:
`["a","31927:<host>:<pageDTag>"]`, `["start", sec]`, `["end", sec]`, `["title", …]`,
`["note", …]`, `["d", <bookingDTag>]`. The booker pre-generates the `dTag`
(`sha256("booking-{pageRef}-{slotMs}-{now}").slice(0,30)`) so the host can publish
the confirmed event at a coordinate the booker already references.

**Booking response (gift wrap 1058 / rumor 58)** — host → booker. Approve tags:
`["a", pageRef]`, `["start"]`, `["end"]`, `["status","approved"]`, `["event_ref",
"<kind>:<host>:<dTag>"]`, `["viewKey","nsec…"]`. Decline: `["status","declined"]`

- optional `["reason", …]`.

**Approve flow** (`approveBookingRequest`): publish the private event reusing the
booker's `dTag` + `viewKey` → link into a calendar list → `addBusyRange` (always) →
send the 1058 response. Booking matching is by `schedulingPageRef + start + end`
(all in the rumor tags), so it is independent of the wrap timestamp.

> **Timestamp note (updated 2026-07-02).** Upstream now uses **real timestamps on
> every wrap layer** — the old `useRealTimestamp` flag is gone from its `nip59.ts`.
> The agent's core `wrapEvent` still jitters seal+wrap ±2 days. Harmless either
> way, because booking matching keys on the **rumor tags**
> (`schedulingPageRef + start + end`), never the wrap time. See §5.4 for the SDK's
> recommended `wrapTimestamps` option.

### 6.9 Deletion (NIP-09, kind 5)

Reference: `deleteCalendarEvent` / `fetchDeletions` / `isEventDeleted`
([service.ts](../common-packages/packages/agent/src/services/calendar/service.ts)).

```jsonc
{
  "kind": 5,
  "content": "Deleted via Formstr",
  "tags": [
    ["k", "32678"],
    ["a", "32678:<author>:<dTag>"],
    ["e", "<event id (64-hex)>"],
  ],
}
```

Your reader **must apply deletions at fetch time** — most relays keep serving
addressable events after a kind-5, so a deleted event re-appears on the next refresh
unless you filter it. The index maps a deleted coordinate → newest deletion
`created_at`; an event is hidden iff its own `created_at ≤` that (so a legitimate
re-publish _after_ a delete survives). **Same-author guard:** a deletion only counts
against a coordinate whose pubkey matches the deleter (`tag[1].split(":")[1] ===
ev.pubkey`) — prevents forged cross-author deletions. Also remove the event's ref
from its calendar list and re-publish the list.

---

## 7. Recurrence (RRULE / NIP-52R)

Recurrence is additive NIP-32 labels on an otherwise-normal event — no new kind.
Spec: [../nostr-calendar/nips/NIP-52R.md](../nostr-calendar/nips/NIP-52R.md).
Helper: [../nostr-calendar/src/utils/repeatingEventsHelper.ts](../nostr-calendar/src/utils/repeatingEventsHelper.ts).

**Emission** — two adjacent rows:

```
["L", "rrule"]
["l", "FREQ=WEEKLY;BYDAY=MO"]    // bare RFC-5545 value: no "RRULE:" prefix, no DTSTART
```

The event's `start` _is_ the DTSTART. Duration = `end − start`, applied to every
occurrence.

**Parsing — read three shapes** (`parseCalendarEvent`): the canonical 2-element
`["l", RRULE]` after `["L","rrule"]`; a legacy super-app 3-element
`["l", RRULE, "rrule"]`; and a bare `["rrule", RRULE]`. Otherwise an
upstream-authored recurring event silently won't expand.

**Expansion** (use `rrule.js`):

```ts
const rule = RRule.fromString(`DTSTART:${isoBasic(begin)}\nRRULE:${bareRrule}`);
const duration = end - begin;
const occurrences = rule
  .between(viewStart, viewEnd, true)
  .map((occ) => ({ begin: occ.getTime(), end: occ.getTime() + duration }));
```

**Fetching gotcha:** never filter recurring events by `start` time — a weekly event
that began two years ago still occurs tomorrow. Fetch by author/coordinate (no time
window) and expand client-side. The convenience mapping
`RepeatingFrequency → RRULE` (Daily/Weekly/Weekday/Monthly/Quarterly/Yearly, plus
`COUNT`/`UNTIL` end modes) lives in `repeatingEventsHelper.ts` if you want a
friendly enum over raw RRULE.

---

## 8. Discovery & relays

> This section is the difference between an SDK that _works_ and one that _appears
> to work locally but is invisible to other clients_. Read it carefully.

### 8.1 The two discovery channels

A private event is found two ways, and a robust reader **unions both**, deduping
newest-wins per coordinate (`fetchCalendarEventsForUser`,
[service.ts](../common-packages/packages/agent/src/services/calendar/service.ts)):

1. **By author (direct).** `{ kinds:[31923,32678,32679], authors:[me] }`. Returns
   _your own_ events. Private ones decrypt via the viewKey held in your lists.
2. **By calendar-list reference.** Walk every visible list's `eventRefs`, collect
   `{kinds, authors, "#d"}`, and fetch `{ kinds, authors, "#d":[dTags] }`. Each ref
   supplies the **viewKey**, so events authored by _other people_ (e.g. a shared
   calendar, or an invitation you accepted) decrypt correctly — a plain author query
   never could, because their content is encrypted to the viewKey, not to anyone's
   identity key.

For **private** events, `calendar.formstr.app` renders **only channel 2** — events
referenced (with a viewKey) in a _visible_ calendar list. Its private-event flow
was refactored (verified 2026-07-02,
[../nostr-calendar/src/stores/events.ts](../nostr-calendar/src/stores/events.ts))
from gift-wrap-driven to **list-ref-driven**: read refs from visible lists → fetch
by `{kinds, authors, "#d"}` — trying the refs' **relay hints first** — decrypt with
the ref's viewKey. Gift wraps are now only the _invitation_ channel, not a display
channel. It still does **not** query private events by author. **Consequence
(unchanged):** a private event that is never _listed_ is invisible there — the
origin of the "created via API but doesn't show on the website" bug
([§13.1](#131-discovery-the-1-bug)). Public events, by contrast, are now fetched
globally (see §6.1 note and §8.2).

Two SDK take-aways from the refactor: **populate the relay hint** (`ref[1]`) when
linking events — upstream routes fetches through it; and expect a consumer to call
`fetchEvents` with refs from _other_ authors' lists, so never assume
`authors:[me]`.

### 8.2 No `created_at` window on the direct query

Relays filter `since`/`until` against an event's **publish time**, not its `start`.
A recurring or far-future event published last month but occurring next month would
be silently dropped by a month-coupled window. So: fetch the user's events with
**no time window** and let the views filter by event date client-side. Use `since`
only for the explicit "browse all public events" mode.

### 8.3 Relay defaults

The calendar default set
([../common-packages/packages/core/src/relay/module-defaults.ts](../common-packages/packages/core/src/relay/module-defaults.ts))
is the **union** of the super-app's original relays and `calendar.formstr.app`'s
hardcoded `defaultRelays`
([../nostr-calendar/src/common/nostr.ts](../nostr-calendar/src/common/nostr.ts)).
It must remain a superset, enforced by a test, or events published by one app won't
land where the other reads:

```
wss://relay.damus.io   wss://relay.primal.net   wss://nos.lol
wss://nostr-pub.wellorder.net   wss://nostr.mom   wss://relay.nostr.wirednet.jp
wss://nostr-01.yakihonne.com   wss://relay.snort.social   wss://nostr21.com
```

### 8.4 NIP-65 & gift-wrap routing

Invitations (and booking req/resp) are addressed to a single recipient and **must be
published to that recipient's inbox relays**, not the author's module relays — else
a recipient whose relays don't overlap yours never sees the invite. Resolve them by
fetching kind-10002 for each participant (`fetchRelayListsForPubkeys`,
newest-wins, `["r", url]` rows), falling back to module relays when absent.
Symmetrically, **read** your invitations from module relays ∪ _your own_ NIP-65 read
relays (`getInvitationInboxRelays`), since other clients delivered them to your
list.

> The main-view event publish/read in this client uses the **fixed module set**,
> not the user's NIP-65 (gift-wraps are the exception). A user whose NIP-65 relays
> don't overlap the defaults would still sync because both apps share the fixed
> floor. If you extend the SDK to honor NIP-65 for events too, union — never
> replace — the module set, or you reintroduce the asymmetry.

### 8.5 Newest-wins dedupe (everything)

Addressable events diverge across relays and old/new payload shapes coexist. Every
fetch path dedupes by `kind:pubkey:dTag` keeping the highest `created_at`:
`fetchCalendarLists`, `fetchCalendarEventsForUser`, `fetchBusyListsForUser`,
`fetchSchedulingPages` all do this. Bake it into your read layer once.

---

## 9. Proposed headless API surface

Model the SDK on the agent service (every signature below maps 1:1 to an existing
function in
[../common-packages/packages/agent/src/services/calendar/](../common-packages/packages/agent/src/services/calendar/)).
Group into namespaces; keep each function a thin orchestration over Tier-1 codecs.

**Reads should come in two flavors.** The agent is promise-based one-shot
(`querySync` until EOSE) — right for MCP/server/scripting consumers. Upstream is
subscription-based streaming through a client-side `EventStore` cache with
newest-wins replaceable dedupe
([../nostr-calendar/src/common/nostrRuntime/](../nostr-calendar/src/common/nostrRuntime/))
plus an offline cache — right for reactive UIs. The runtime contract (§3.2)
already supports both (`querySync` + `subscribe`); expose each promise-returning
fetch below alongside a `subscribe*` variant (callback + `SubscriptionHandle`),
both funnelling through the same Tier-1 codecs and the same dedupe/deletion
filters. The EventStore-style cache itself stays host-side (Tier 3) — the SDK
must not own storage.

```ts
// ── events ────────────────────────────────────────────────
createEvent(draft: CalendarEventDraft, opts?: { calendars?: CalendarList[] })
    : Promise<{ event: CalendarEvent; calendar?: CalendarList }>      // createCalendarEvent
publishPublicEvent(draft): Promise<CalendarEvent>
publishPrivateEvent(draft, calendarId): Promise<CalendarEvent>        // mints/reuses viewKey, gift-wraps
fetchEvents(calendars, opts?: { authors?; since?; until? }): Promise<CalendarEvent[]>  // unions both channels
fetchEventByCoordinate(coord, viewKey?): Promise<CalendarEvent | null>
updateEvent(draft /* with existingId + viewKey */): Promise<CalendarEvent>
deleteEvent(eventId, coordinate?): Promise<void>                      // kind-5 + delist

// ── calendars (lists) ─────────────────────────────────────
createCalendar(title, color, description?): Promise<CalendarList>
updateCalendar(list): Promise<CalendarList>
deleteCalendar(coordinate /* 32123:pk:d */): Promise<void>
fetchCalendars(): Promise<CalendarList[]>                             // self-decrypt + heal + dedupe
addEventToCalendar(list, eventRef): Promise<CalendarList>
removeEventFromCalendar(list, coordinate): Promise<CalendarList>
moveEventBetweenCalendars(lists, targetId, coordinate, ref): Promise<…>

// ── invitations ───────────────────────────────────────────
fetchInvitations(): Promise<InvitationWithEvent[]>                    // gift-wrap unwrap + preview fetch
acceptInvitation(inv, calendarId)   // = addEventToCalendar(list, [coord, relayHint, viewKey])
dismissInvitation(inv)              // = publishParticipantRemoval(kind 84)

// ── rsvp ──────────────────────────────────────────────────
rsvp(coordinate, status, isPrivate?, extra?, viewKey?): Promise<void> // 31925 / 32069 / wrap-fallback
fetchRsvps(coordinate, viewKey?): Promise<RSVPResponse[]>             // newest-wins per responder

// ── busy / availability ───────────────────────────────────
addBusyRange(range) / removeBusyRange(range): Promise<void>
fetchBusyLists(pubkey, monthKeys): Promise<BusyList[]>

// ── scheduling / booking ──────────────────────────────────
fetchSchedulingPages(): Promise<SchedulingPage[]>
bookingLinkUrl(page): string
fetchBookingRequests(): Promise<BookingRequest[]>
approveBooking(request, calendar): Promise<{ event; calendar }>
declineBooking(request, reason?): Promise<void>

// ── recurrence (pure) ─────────────────────────────────────
expandOccurrences(event, viewStart, viewEnd): { begin; end }[]
isEventInDateRange(event, start, end): boolean

// ── pure codecs (Tier 1) ──────────────────────────────────
generateViewKey() / encryptWithViewKey / decryptWithViewKey
encodeCalendarList / decodeCalendarList / parseEventRef / buildEventRef
parseCalendarEvent(event, viewKey?) / extractInvitationFromWrap(wrap)
busyListToTags / parseBusyListEvent / busyListMonthKey(sForRange)
```

### 9.1 What an existing tool layer exposes

The agent's MCP-style tool wrapper
([../common-packages/packages/agent/src/tools/calendar.ts](../common-packages/packages/agent/src/tools/calendar.ts))
shows the practical public verbs and their argument validation — a good checklist
for SDK ergonomics: `list_calendar_events`, `create_calendar_event` (defaults
**private**, asks which calendar when ambiguous, accepts npub _or_ hex
participants), `get_calendar_event`, `list_calendars`, `create_calendar`,
`fetch_event_rsvps`, `list_invitations`, `list_scheduling_pages`,
`list_booking_requests`, and write-gated `approve_booking` / `decline_booking` /
`delete_calendar_event` / `rsvp_event` / `update_calendar_event` /
`attach_form_to_event` / `update_calendar` / `delete_calendar` /
`add_event_to_calendar` / `remove_event_from_calendar`.

---

## 10. Domain data models

Canonical TS shapes. Agent versions:
[../common-packages/packages/agent/src/services/calendar/types.ts](../common-packages/packages/agent/src/services/calendar/types.ts);
fuller upstream versions (occurrence/device/forms fields):
[../nostr-calendar/src/utils/types.ts](../nostr-calendar/src/utils/types.ts).

```ts
interface CalendarEventDraft {
  title: string;
  description: string;
  begin: Date;
  end: Date;
  location?: string;
  categories?: string[];
  participants?: string[]; // participants: hex
  isPrivate?: boolean;
  calendarId?: string;
  rrule?: string; // bare RFC-5545; takes precedence over `repeat`
  repeat?: RepeatingFrequency; // friendly enum alternative
  startTzid?: string;
  endTzid?: string;
  registrationFormRef?: string;
  registrationFormViewKey?: string;
  notificationPreference?: string; // "enabled" | "disabled"
  image?: string;
  website?: string;
  existingId?: string; // EDIT: reuse the same d
  viewKey?: string; // EDIT: reuse the same viewKey (nsec) — §13.3
}

interface CalendarEvent {
  id: string; // the d-tag
  eventId: string; // the nostr event id (hash)
  title: string;
  description: string;
  kind: number;
  begin: number;
  end: number; // ms timestamps
  createdAt: number; // unix seconds
  image?: string;
  categories: string[];
  participants: string[];
  location: string[];
  website: string;
  user: string; // author pubkey (hex)
  isPrivate: boolean;
  viewKey?: string;
  repeat: { rrule: string | null };
  startTzid?: string;
  endTzid?: string;
  registrationFormRef?: string;
  registrationFormViewKey?: string;
  notificationPreference?: string;
  calendarId?: string;
  isInvitation?: boolean;
  relayHint?: string;
  event?: Event; // the raw signed event (escape hatch)
}

interface CalendarList {
  id: string; // d-tag
  eventId: string;
  title: string;
  description: string;
  color: string;
  eventRefs: string[][]; // [[coord, relayHint, viewKey], …]
  createdAt: number;
  isVisible: boolean; // isVisible is CLIENT-SIDE only, never on the wire
  notificationPreference?: "enabled" | "disabled";
}

interface RSVPResponse {
  pubkey: string;
  status: RSVPStatus;
  eventCoordinate: string;
  createdAt: number;
  suggestedStart?: number;
  suggestedEnd?: number;
  comment?: string; // unix seconds
}

enum RSVPStatus {
  accepted,
  declined,
  tentative,
  pending,
}
enum RepeatingFrequency {
  None,
  Daily,
  Weekly,
  Weekday,
  Monthly,
  Quarterly,
  Yearly,
}
```

Plus `BusyList`/`BusyRange`, `SchedulingPage`, `BookingRequest`/`IOutgoingBooking`,
`IAvailabilityWindow`, `ITimeSlot` — see the source types above. Note unit
conventions: **domain objects use ms; the wire uses unix seconds.** Convert at the
codec boundary only.

---

## 11. End-to-end flows

### 11.1 Create a private event

```
1. viewKey = draft.viewKey ?? generateViewKey()           // reuse on edit, mint on create
2. innerTags = [title, description, start(number), end, ["d", id], p(self first)…, rrule?, form?]
3. content = encryptWithViewKey(viewKey.nsec, JSON.stringify(innerTags))
4. signed = sign({ kind:32678, tags:[["d", id]], content }); publish to module relays
5. relayHint = relays[0]; coordinate = `32678:${pubkey}:${id}`
6. resolve target calendar list (chosen / first / auto-create "My Calendar")
7. addEventToCalendar(list, [coordinate, relayHint, viewKey.nsec])  → re-publish 32123
8. for each participant (NIP-65 inbox relays): wrap rumor{ a:[coord,hint], viewKey } → publish 1052
9. (host policy) addBusyRange({start,end})                // optional, opt-out gated
```

Steps 6–7 are **not optional** for discovery — without the list ref the event is
invisible to `calendar.formstr.app` and its viewKey is lost on refresh. The shared
`createCalendarEvent` helper does 1–8 so the app store and the API behave
identically. Reference:
[service.ts `createCalendarEvent`](../common-packages/packages/agent/src/services/calendar/service.ts).

### 11.2 Receive & accept an invitation

```
1. subscribe { kinds:[1052], "#p":[me] } on module relays ∪ my NIP-65 read relays
2. unwrap each: wrap → seal → rumor; read a-coordinate + viewKey (+ relayHint)
3. drop if wrap.id ∈ my kind-84 removals, or coordinate ∈ any list ref (dedupe)
4. fetch+decrypt the event for preview: fetchEventByCoordinate(coord, viewKey)
5. ACCEPT → addEventToCalendar(chosenList, [coord, relayHint, viewKey]) → re-publish list
   DISMISS → publishParticipantRemoval({ kinds:[52], eventIds:[wrap.id] })   // sticks across sessions
```

### 11.3 Load the calendar (startup)

```
1. fetchCalendars()  → self-decrypt 32123, heal legacy shapes, drop deleted, dedupe
2. fetchEvents(calendars, { authors:[me] })  → union by-author + by-ref, decrypt, drop deleted
3. (optional) fetchInvitations(), fetchBookingRequests(), fetchBusyLists(...)
4. UI filters by visible calendars + the viewed date range (client-side)
```

### 11.4 Approve a booking

See [§6.8](#68-appointment-scheduling) — reuse booker's `dTag`+`viewKey`, publish
private event, link to list, `addBusyRange`, send 1058. Reference:
[booking.ts `approveBookingRequest`](../common-packages/packages/agent/src/services/calendar/booking.ts).

---

## 12. UI / interaction patterns

Reference-level — the SDK is headless, but a host (and optional `calendar-sdk-react`
companion) needs these. Engine:
[../nostr-calendar/src/common/calendarEngine.ts](../nostr-calendar/src/common/calendarEngine.ts);
orchestrator:
[super-app/packages/app/src/pages/CalendarPage.tsx](super-app/packages/app/src/pages/CalendarPage.tsx).

**Rendering pipeline** (pure functions — good SDK candidates):

```
events ──getEventSegmentsForDay(events, dayStartMs)──▶ segments
   (resolve recurring occurrence overlapping the day; clip multi-day to [dayStart, dayStart+24h))
segments ──layoutDayEvents(segments)──▶ positioned[]   (greedy column packing for overlaps;
   top = minutes-from-midnight, height = duration × PX_PER_MINUTE)
```

- `getEventSegmentForDay`: non-recurring → clip `[begin,end]` to the day; recurring →
  `getNextOccurrenceInRange(event, dayStart-duration, dayStart+DAY-1)` then clip.
  Returns `null` when nothing renders that day.
- `layoutDayEvents`: sort by start; place each in the first column whose last event
  ended; else open a new column; `colSpan` = column count → side-by-side overlap.

**View/state pattern** (`CalendarPage` + zustand `calendarStore`,
[super-app/packages/app/src/stores/calendarStore.ts](super-app/packages/app/src/stores/calendarStore.ts)):

- Store holds `events`, `calendars`, `selectedDate`, loading/error; actions delegate
  **straight to the SDK** (`createEvent`, `fetchEvents`, `deleteEvent`, …) and just
  reconcile local arrays. Busy-range publish/retract lives in the store because it's
  gated on an app-only user setting — a clean example of _host policy on top of SDK
  primitives_.
- Month navigation is **purely client-side** (events are fetched window-free; views
  filter by date). `filterEventsByCalendarVisibility` applies the client-only
  visibility toggles.
- Views/dialogs to expect: month grid, list view, event create/edit dialog,
  event-details dialog, calendar-manage dialog, invitations view, bookings view,
  availability view, RSVP bar, recurrence field. All are thin over store + SDK.

**Conventions in this codebase** (if you build the React companion): outlined
**lucide** line-icons, never emoji; page orchestrators < 200 LOC; no new frontend
component tests (backend/codec logic is TDD'd instead).

---

## 13. Invariants & gotchas (hard-won)

### 13.1 Discovery: the "1%" bug

`calendar.formstr.app` renders only events **referenced in a visible calendar list**.
An event created and published but never listed is invisible there even though a
by-author query (your own app) shows it. **Always** link private events into a list
([§11.1](#111-create-a-private-event)); default new events to **private** so they're
listable (public refs can't sync).

### 13.2 The inner `["d", id]` row is mandatory

The standalone's private-event decryption **replaces** the event's tag list with the
decrypted array and then reads the id from the inner `d` row. Omit it and every one
of your private events collapses under id `""` on `calendar.formstr.app` — only one
survives. Emit `["d", id]` _inside_ the encrypted payload, matching the outer `d`.

### 13.3 Reuse the viewKey on edit

Editing a private event re-publishes the same coordinate. If you mint a _fresh_
viewKey, the calendar-list ref still holds the _old_ one → every reader (including
you, next refresh) fails to decrypt with an invalid-MAC error, and prior invitees
lose access. On edit, thread `existingId` **and** `viewKey` through the draft. The
update tools recover the viewKey via `lookupEventViewKey(coordinate)` before
re-publishing.

### 13.4 Object-vs-array calendar lists

Calendar-list content is a **tags array**, not a JSON object. A historical super-app
build wrote an object; `calendar.formstr.app` **throws** on it. Current upstream
code (verified 2026-07-02) catches the throw **per list** inside its subscription
callback, so one bad list no longer aborts the entire load — but older deployed
builds did abort, and upstream still doesn't _heal_: the object-shaped list itself
stays invisible there forever. The agent's `fetchCalendarLists` detects an object
payload, loads it, _and_ re-publishes it as the array shape to heal the relay copy
(self-limiting). The SDK should do both: per-item error isolation on read
(upstream's lesson) **and** heal-and-republish (the agent's lesson).

### 13.5 NIP-09 deletions resurface without fetch-time filtering

Relays keep serving addressable events after a kind-5. Apply deletions on every read
([§6.9](#69-deletion-nip-09-kind-5)) with the same-author guard and the
`created_at ≤ deletionTime` rule, or deleted events/calendars reappear each refresh.

### 13.6 Gift wraps go to the recipient's relays

Publish 1052/1057/1058 to the recipient's NIP-65 inbox relays, not your module set
([§8.4](#84-nip-65--gift-wrap-routing)). Read your own from module ∪ your NIP-65
read relays.

### 13.7 ms vs seconds

Domain objects use **ms**; the wire uses **unix seconds**; inner private `start`/`end`
are JSON **numbers** (seconds) while public ones are **strings** (seconds); day-event
dates are `YYYY-MM-DD` strings. Guard `Number.isFinite` before emitting any
timestamp derived from a parsed `Date` (an unparseable string → `NaN` on the wire
breaks other clients' filters).

### 13.8 Deterministic d-tags where replacement is intended

RSVPs and booking d-tags are SHA-256-derived so re-submitting _replaces_ rather than
accumulating events on relays ([§6.5](#65-rsvp-public-31925--private-32069),
[§6.8](#68-appointment-scheduling)). Random UUIDs there cause unbounded relay growth.

### 13.9 Day events & exclusive end

For 31922/32681, `end` is the **exclusive** end date (NIP-52): `start 2024-12-24`,
`end 2024-12-26` spans Dec 24–25. Don't off-by-one.

---

## 14. Packaging & suggested layout

### 14.1 Consumption model — mirror `@formstr/sdk`

The DX target is what `@formstr/sdk` (0.2.7, `../nostr-forms/packages/formstr-sdk`)
already proves in production (upstream nostr-calendar consumes it for event
registration forms): a class you instantiate and call, with **all infrastructure
defaulted internally** —

- one module-level `SimplePool` (`pool.ts` is three lines) — no relay wiring;
- built-in default relays, overridable per call/constructor;
- a small **structural** signer interface (`FormsSigner`: `getPublicKey`,
  `signEvent`, `nip44Encrypt`, `nip44Decrypt`) — no class import required;
- npm tarball is `dist/**` only.

Target usage:

```ts
import { CalendarSDK } from "@formstr/calendar-sdk";

const sdk = new CalendarSDK({ signer }); // relays/pool defaulted (§8.3 union)
const calendars = await sdk.fetchCalendars();
const { event } = await sdk.createEvent({
  title: "Team sync",
  begin,
  end,
  isPrivate: true, // default
});
await sdk.rsvp(coordinate, "accepted");
```

Differences from the forms SDK, dictated by the protocol:

- **The signer sits in the constructor, not per call.** Forms has a meaningful
  anonymous mode (ephemeral submit); calendar is signer-heavy — lists are
  self-encrypted, private events are signed, wraps need NIP-44. Signerless
  construction is still allowed but limits you to public reads (public events,
  busy lists, public RSVPs).
- **Constructor DI with defaults**: `new CalendarSDK({ signer?, relays?, runtime? })`.
  Default runtime = internal SimplePool-backed implementation of the §3.2 contract;
  default relays = the §8.3 union. Advanced hosts (super-app's agent, upstream's
  `nostrRuntime`) inject their own runtime — same class, no globals. This resolves
  the agent-vs-upstream architecture split: both become hosts of the same SDK.
- **Self-contained like the forms SDK**: dependencies only `nostr-tools`,
  `@noble/hashes`, `rrule`. No `@formstr/core` dependency — the needed crypto
  (§5) is small and gets inlined; `@formstr/signer` stays out of `dependencies`
  (structural typing + a `toCalendarSigner`/`.bind` adapter, §3.1).

**Home:** `../common-packages/packages/calendar-sdk`, package name
`@formstr/calendar-sdk@0.1.0`, tsup ESM+CJS+`.d.ts` build exactly like
`signer`/`agent` (multi-entry if subpath exports are wanted), `files: ["dist"]`,
publish with `corepack pnpm publish --access public` (pnpm rewrites any
`workspace:*`; plain `npm publish` would not).

**Convergence plan (why this de-duplicates instead of adding a third copy):**
extraction order is `agent/src/services/calendar` + the §5 crypto → SDK; then the
agent's calendar service becomes a thin wrapper over the SDK (its tool surface
stays); then upstream `calendar.formstr.app` migrates its `common/nostr.ts` +
`calendarList.ts` + `nip59.ts` protocol code onto the SDK via a fork PR (it
already consumes `@formstr/sdk` + `@formstr/signer` from npm, so the dependency
pattern is established). End state: **one** protocol implementation, two hosts.

### 14.2 Suggested layout

```
common-packages/packages/calendar-sdk/
  src/
    CalendarSDK.ts      # the class; thin orchestration + defaults (§14.1)
    contracts.ts        # CalendarSigner, NostrRuntime, RelayProvider (§3)
    runtime/pool.ts     # default SimplePool-backed NostrRuntime (mirrors forms SDK)
    kinds.ts            # CALENDAR_KINDS (§4)
    crypto/
      nip44.ts          # self-encrypt/decrypt wrappers (§5.2)
      nip59.ts          # wrapEvent / unwrapEvent + wrapTimestamps option (§5.4)
      viewKey.ts        # generate / encrypt / decrypt / build+parse ref (§5.3)
    codec/
      event.ts          # parseCalendarEvent, buildInnerTags (§6.1–6.2)
      calendarList.ts   # encode/decodeCalendarList + heal (§6.3)
      rsvp.ts           # extractInvitationFromWrap, rsvp payloads (§6.4–6.5)
      busyList.ts       # toTags/parse, monthKey helpers (§6.7)
      recurrence.ts     # RRULE emit/parse/expand (§7)
    discovery/
      deletions.ts      # fetchDeletions / isEventDeleted (§6.9)
      relays.ts         # defaults + NIP-65 resolution (§8.3–8.4)
    services/
      events.ts  calendars.ts  invitations.ts  rsvp.ts  busy.ts  booking.ts   # (§9)
    adapters/signer.ts  # ActiveSigner/FormsSigner → CalendarSigner (bind-safe, §3.1)
    index.ts            # public API
  # optional companion package, later:
  calendar-sdk-react/   # hooks/store/engine over the headless core (§12)
```

Mirror the agent's split: pure codecs separately unit-tested; services are thin
orchestration over them + the injected contracts. Test gate worth replicating: every
codec round-trips (encode→decode), and an interop test round-trips against fixtures
captured from `calendar.formstr.app`.

---

## 15. Source map

**Which side to copy, per concern (verified against both codebases 2026-07-02):**

| Concern                                     | Take from                          | Why                                                                        |
| ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Codec healing (double-`a`, object lists)    | agent                              | upstream doesn't heal; old relay data must stay readable (§6.3, §13.4)     |
| Per-item read error isolation               | upstream                           | one poisoned list/event must not sink the load (§13.4)                     |
| Deletion filtering + same-author guard      | agent                              | upstream applies less rigor at fetch time (§6.9)                           |
| viewKey reuse on edit, `lookupEventViewKey` | agent                              | prevents invalid-MAC lockouts (§13.3)                                      |
| Deterministic RSVP/booking `d`-tags         | both (identical)                   | verified byte-identical derivation (§6.5, §13.8)                           |
| Relay-hint usage on ref fetch               | upstream                           | fetches from where the event actually lives (§8.1)                         |
| Streaming reads + client cache model        | upstream                           | `nostrRuntime` EventStore; SDK exposes subscribe, host owns cache (§9)     |
| Window-free own-event fetch                 | agent                              | upstream's `since/until` public window drops long-lived events (§8.2)      |
| Gift-wrap timestamps                        | agent default, upstream via option | rumor real, seal/wrap jittered; `wrapTimestamps: "real"` for parity (§5.4) |
| Public-event tags                           | agent (`title`), read both         | upstream writes legacy `name` + has the location→image bug (§6.1)          |
| Signer handling                             | upstream                           | `@formstr/signer` `createSigner` + bind-safe adapter (§3.1)                |
| Packaging/DX                                | formstr-sdk                        | class + zero-config pool/relays + dist-only npm (§14.1)                    |

**Protocol specs (read first):**

- [../nostr-calendar/PROTOCOL.md](../nostr-calendar/PROTOCOL.md) — private events, lists, gift wraps, fetch strategy, caching
- [../nostr-calendar/nips/NIP-52E.md](../nostr-calendar/nips/NIP-52E.md) — 32678/32681/1052/32123/31926/84 formal spec
- [../nostr-calendar/nips/NIP-52R.md](../nostr-calendar/nips/NIP-52R.md) — recurrence via RRULE labels
- [../nostr-calendar/RSVP_SPEC.md](../nostr-calendar/RSVP_SPEC.md) — form-backed RSVP, `["form", naddr, viewKey]`
- [../nostr-calendar/SCHEDULING_PROTOCOL.md](../nostr-calendar/SCHEDULING_PROTOCOL.md) — 31927/32680/1057/1058 booking
- [../nostr-calendar/nips/NIP-Appointment-Scheduling.md](../nostr-calendar/nips/NIP-Appointment-Scheduling.md)

**Headless reference implementation (model the SDK on this):**

- [../common-packages/packages/agent/src/services/calendar/service.ts](../common-packages/packages/agent/src/services/calendar/service.ts) — events, lists, discovery, deletions
- [../common-packages/packages/agent/src/services/calendar/viewKey.ts](../common-packages/packages/agent/src/services/calendar/viewKey.ts) — view-key crypto
- [../common-packages/packages/agent/src/services/calendar/calendarListCodec.ts](../common-packages/packages/agent/src/services/calendar/calendarListCodec.ts) — list encode/decode + heals
- [../common-packages/packages/agent/src/services/calendar/rsvp.ts](../common-packages/packages/agent/src/services/calendar/rsvp.ts) — RSVP + invitation extract
- [../common-packages/packages/agent/src/services/calendar/busyList.ts](../common-packages/packages/agent/src/services/calendar/busyList.ts) — busy lists
- [../common-packages/packages/agent/src/services/calendar/booking.ts](../common-packages/packages/agent/src/services/calendar/booking.ts) — scheduling pages + approve/decline
- [../common-packages/packages/agent/src/services/calendar/types.ts](../common-packages/packages/agent/src/services/calendar/types.ts) — kinds + domain types
- [../common-packages/packages/agent/src/tools/calendar.ts](../common-packages/packages/agent/src/tools/calendar.ts) — verb/argument surface

**Infrastructure contracts:**

- [../common-packages/packages/core/src/signer/types.ts](../common-packages/packages/core/src/signer/types.ts) — `NostrSigner`
- [../common-packages/packages/core/src/runtime/NostrRuntime.ts](../common-packages/packages/core/src/runtime/NostrRuntime.ts) — `querySync` / `subscribe` / `publish`
- [../common-packages/packages/core/src/crypto/nip44.ts](../common-packages/packages/core/src/crypto/nip44.ts), [../common-packages/packages/core/src/crypto/nip59.ts](../common-packages/packages/core/src/crypto/nip59.ts)
- [../common-packages/packages/core/src/relay/module-defaults.ts](../common-packages/packages/core/src/relay/module-defaults.ts) — relay defaults

**Current upstream client internals (post-refactor, 2026-07):**

- [../nostr-calendar/src/common/nostrRuntime/](../nostr-calendar/src/common/nostrRuntime/) — `EventStore` (replaceable newest-wins cache) + `SubscriptionManager`
- [../nostr-calendar/src/common/signer/index.ts](../nostr-calendar/src/common/signer/index.ts) — `SignerManager` over `@formstr/signer` `createSigner` (NIP-07/46/55)
- [../nostr-calendar/src/common/offlineEventCache/](../nostr-calendar/src/common/offlineEventCache/) — web/native offline cache (host-side concern)
- [../nostr-calendar/src/stores/events.ts](../nostr-calendar/src/stores/events.ts) — list-ref-driven private fetch + global public subscription
- [../nostr-calendar/src/utils/toFormsSigner.ts](../nostr-calendar/src/utils/toFormsSigner.ts) — bind-safe signer adapter (§3.1)

**Consumption model to mirror (`@formstr/sdk`):**

- [../nostr-forms/packages/formstr-sdk/src/sdk/FormstrSDK.ts](../nostr-forms/packages/formstr-sdk/src/sdk/FormstrSDK.ts) — class API, per-call signer, ephemeral fallback
- [../nostr-forms/packages/formstr-sdk/src/sdk/pool.ts](../nostr-forms/packages/formstr-sdk/src/sdk/pool.ts) + `utils/fetchFormTemplate.ts` — zero-config pool + default relays
- [../nostr-forms/packages/formstr-sdk/src/sdk/main.ts](../nostr-forms/packages/formstr-sdk/src/sdk/main.ts) — the entire public export surface

> **Upstream fix candidates for the fork PR** (found 2026-07-02, all in
> `../nostr-calendar`): the `["image", location]` copy-paste bug in
> `publishPublicCalendarEvent` (§6.1); leftover debug logs
> (`console.log("HERE!!!!!!!")` in `calendarList.ts`, `SIGNER-DECRYPT` logs in
> `nip59.ts`); the stale `isRecurring` docstring in `stores/events.ts` describing
> a split the code doesn't implement.

**UI reference:**

- [../nostr-calendar/src/common/calendarEngine.ts](../nostr-calendar/src/common/calendarEngine.ts) — day segments + layout
- [../nostr-calendar/src/utils/repeatingEventsHelper.ts](../nostr-calendar/src/utils/repeatingEventsHelper.ts) — RRULE expansion
- [super-app/packages/app/src/pages/CalendarPage.tsx](super-app/packages/app/src/pages/CalendarPage.tsx), [super-app/packages/app/src/stores/calendarStore.ts](super-app/packages/app/src/stores/calendarStore.ts)
- [super-app/packages/app/src/components/calendar/](super-app/packages/app/src/components/calendar/) — views/dialogs

> **Interop discipline:** before shipping any write path, capture a real event from
> `calendar.formstr.app` (or vice-versa) and assert your codec round-trips it
> byte-for-byte. The whole protocol's value is that two independent clients agree on
> the wire; a one-character divergence (an object instead of an array, a missing
> inner `d`, a 3-element `l` tag) silently breaks discovery on the other side.
