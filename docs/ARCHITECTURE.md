# Formstr Super-App Architecture

This document is for developers working on (or integrating with) the Formstr super-app.
It explains how the codebase is organized, how identity and the Nostr plumbing work, and
exactly which Nostr event kinds each module reads and writes. If you only need the MCP
server, read [MCP.md](./MCP.md) instead; this file covers the whole app and the shared
service layer that the MCP also builds on.

Everything here is grounded in the source under `packages/`. Where a detail matters for
cross-app compatibility (so that data written here shows up on the original standalone
apps and vice versa) it is called out, because that constraint shapes most of the design.

## What the super-app is

The super-app bundles five formerly-standalone Nostr apps into one workspace:

- **Forms** (originally `formstr.app`)
- **Calendar** (originally `calendar.formstr.app`)
- **Pages** (originally `pages.formstr.app`, the `nostr-docs` project)
- **Drive** (originally `drive.formstr.app`)
- **Polls** (originally `pollerama.fun`, the `nostr-polls` project)

On top of those five it adds an AI assistant that drives every module through a shared
tool registry, and a standalone MCP server (`@formstr/mcp`) that exposes the same tools to
external agent hosts like Claude Desktop, Claude Code, and Cursor.

A few properties are true across the entire app:

- **There is no backend.** The browser talks straight to Nostr relays over WebSockets and
  to Blossom blob servers over HTTP. Identity keys never leave the client.
- **Wire compatibility comes first.** Each module uses the same event kinds, tags, and
  encryption model as the standalone app it came from, so the same account sees the same
  data in both places. When the two disagree, the standalone app's format wins.
- **One identity engine.** Both the web app and the MCP server log in through
  `@formstr/signer` and feed the result into the shared signer in `@formstr/core`.

## Repository layout

This is a pnpm monorepo. `pnpm-workspace.yaml` globs `packages/*`. There are four
packages:

| Package          | Version | Published     | Role                                                                                                                                                                             |
| ---------------- | ------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@formstr/core`  | 0.0.1   | private       | Nostr primitives: signers, relay and runtime plumbing, crypto, Blossom, cross-module linking. Plain TypeScript, built with `tsc`.                                                |
| `@formstr/agent` | 0.0.1   | private       | The five modules' service layer plus the 53-tool registry and the neutral result/safety/schema helpers. Ships its source directly through package `exports`, with no build step. |
| `@formstr/app`   | 0.0.1   | private       | The React 19 web client: UI, Zustand stores, and the in-browser AI runtime. Built with Vite.                                                                                     |
| `@formstr/mcp`   | 0.4.0   | public on npm | The stdio MCP server that wraps the agent's tool registry. A single-file bundle built with `tsup`, with the `formstr-mcp` binary.                                                |

The root `package.json` is private and orchestrates the workspace (`pnpm -r build`,
`pnpm -r typecheck`, `vitest run`, and so on).

## How the packages depend on each other

```
                @formstr/core      (nostr primitives)
                      |
                @formstr/agent     (services + tool registry)
                      |
        +-------------+-------------+
   @formstr/app                @formstr/mcp
 (React UI + browser agent)   (stdio MCP server)
```

A few invariants hold this layering together:

- **`@formstr/agent` has no MCP SDK and no DOM dependency.** Its services import only
  `@formstr/core` and `nostr-tools`, so they run unchanged in the browser and in Node.
  Tools return a neutral `ToolResult`, and each consumer maps that to its own shape (the
  MCP adapter maps it to the SDK's `CallToolResult`, the browser agent reads it directly).
- **`@formstr/mcp` does not depend on `@formstr/app`.** It pulls the tool registry from
  `@formstr/agent` and bundles everything except the native keychain addon. The published
  tarball contains no workspace references.
- **The app imports services through deep paths** like `@formstr/agent/services/forms`,
  which line up with the per-module `exports` map in the agent's `package.json`.

## Build and tooling

- **TypeScript** is strict everywhere (`tsconfig.base.json`): target ES2022, module
  ESNext, bundler resolution, `noUnusedLocals` and `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `isolatedModules`, with declarations and source maps.
- **Builds:** core compiles with `tsc`, the app runs `tsc -b && vite build`, the MCP
  bundles with `tsup` (CJS, node20 target, single file with a shebang banner). The agent
  has no build step because it exports source.
- **Tests** run on Vitest. Core and app are wired into the root `vitest.workspace.ts`; the
  agent and MCP each run their own `vitest run`. The standing convention is to write tests
  for backend code (services, stores, MCP helpers) and to keep frontend component tests
  rare.
- **Lint and format** use ESLint 9 (flat config) and Prettier, run on commit through Husky
  and lint-staged. Commits are GPG-signed.

## Identity and signing

### The core contract

`packages/core/src/signer/types.ts` defines the single interface every module signs
through:

```ts
interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  encrypt?(pubkey, plaintext): Promise<string>; // NIP-04
  decrypt?(pubkey, ciphertext): Promise<string>; // NIP-04
  nip44Encrypt?(pubkey, plaintext): Promise<string>;
  nip44Decrypt?(pubkey, ciphertext): Promise<string>;
}
type SignerMethod = "local" | "nip07" | "nip46" | "nip55" | "guest";
```

### SignerManager

`packages/core/src/signer/SignerManager.ts` exports the `signerManager` singleton. It owns
the active signer, the active pubkey, the login method, a ready flag, a set of observers,
and a single login-modal callback. The parts worth knowing:

- **Two-phase restore.** On startup it reads the cached method and pubkey from
  `localStorage` and immediately installs a `DeferredSigner` that queues operations against
  the cached pubkey, so the UI can render at once. The real signer resolves in the
  background and takes over.
- **`getSigner()`** is the blocking accessor used by write paths. If nobody is signed in it
  triggers the registered login modal. **`getSignerIfAvailable()`** is the non-blocking
  accessor used by read paths and returns null when there is no signer.
- **`setActiveSigner(signer, method, pubkey)`** is the injection point. Passing `null` for
  the signer means "locked": the account is shown but any write routes to the unlock modal.
  It disposes any previous `LocalSigner` and wipes the legacy `formstr:client-secret` key so
  no raw secret lingers.
- Concrete signers live in the same directory: `LocalSigner` (an in-memory secret key that
  zeroizes on `dispose()`), `NIP07Signer` (browser extension via `window.nostr`),
  `NIP46Signer` (a bunker connection), `DeferredSigner`, and `DriveSignerAdapter`.

### How the web app logs in

The web app uses `@formstr/signer` (npm) as its identity engine.
`packages/app/src/stores/authStore.ts` is the bridge: it subscribes to the signer's
changes, adapts the unlocked signer to the core `NostrSigner` shape, and injects it through
`signerManager.setActiveSigner`. Accounts re-hydrate locked after a reload and unlock on
demand: a passphrase for an `ncryptsec` key, a page grant for an extension, a session
resume for NIP-46. Local keys are stored as NIP-49 `ncryptsec` (passphrase-encrypted); a
raw nsec is never persisted. The login surfaces are `LoginDialog`, `UnlockDialog`, and a
one-time `MigrationDialog` that moves any legacy plaintext key into an `ncryptsec`.

### How the MCP logs in

The MCP server uses the same `@formstr/signer` engine but stores the encrypted keystore in
the OS keychain (or an encrypted file) rather than `localStorage`, and it logs in from the
terminal. See [MCP.md](./MCP.md) for the full flow; the bridge into core is identical.

## The Nostr runtime

`packages/core/src/runtime/` provides the shared event plumbing as the `nostrRuntime`
singleton, made of three parts.

- **`SimplePool`** (from `nostr-tools`) holds the actual relay connections.
- **`EventStore`** is a multi-indexed in-memory cache keyed by id, kind, author, and
  address (`kind:pubkey:dtag`). It handles replaceable events (0, 3, 10000 to 19999) and
  parameterized-replaceable events (30000 to 39999) by keeping the newest per address. It
  applies NIP-09 kind-5 deletions on load with a same-author forgery guard on both `e` and
  `a` targets, and keeps tombstones keyed by deletion time so that an `a`-deletion arriving
  before its target still sticks while a legitimate re-publish survives. It also honors the
  calendar's kind-84 participant removals.
- **`SubscriptionManager`** deduplicates identical `(relays, filters)` subscriptions by
  hash with reference counting, replays already-received events to late listeners, fires
  EOSE per listener, and auto-chunks filters with more than 1000 authors into batches.

`NostrRuntime` exposes `query` and `get` (synchronous reads from the cache), `subscribe`
(network plus store plus forward), `fetchOne` (first match then close, with a 10 second
default timeout, cache first), `querySync` (collect until EOSE), `fetchBatched` (coalesces
single-id lookups in a 50 ms window, grouped by relay set), and `publish`.

## Relays

- **`RelayManager`** exposes read, write, and per-module relay selectors. `getReadRelays`
  and `getWriteRelays` return the user's NIP-65 relays (kind 10002) once they have been
  fetched, and otherwise fall back to a built-in default set. They do not actually merge
  the two; it is one set or the other (the class is described internally as "merging", but
  the code picks user relays when present, else the defaults). The per-module selector
  `getRelaysForModule(module)` ignores the user's relays entirely and always returns that
  module's own default set, and that is the method every module service calls.
- **`MODULE_DEFAULT_RELAYS`** holds the per-module relay arrays. Each set is the union of
  the super-app's relays and the matching standalone app's hardcoded relays, which is what
  makes cross-app sync work. The current sets are:

  | Module   | Default relays                                                                       |
  | -------- | ------------------------------------------------------------------------------------ |
  | forms    | damus, primal, nos.lol, wirednet.jp, yakihonne, snort, nostr.band, nostr21           |
  | calendar | damus, primal, nos.lol, wellorder, nostr.mom, wirednet.jp, yakihonne, snort, nostr21 |
  | pages    | damus, primal, nos.lol                                                               |
  | drive    | damus, nostr.band, nos.lol                                                           |
  | polls    | damus, primal, nos.lol, wirednet.jp, yakihonne, nostr21                              |

- **`OutboxService`** does NIP-65 gossip discovery with a three-tier cache (in-memory, then
  `localStorage`, then network, with a five minute TTL and stale-while-revalidate). It
  resolves outbox and inbox relays per author.

One thing to keep in mind: the module services publish and read on the fixed
`getRelaysForModule` set, not on the user's NIP-65 relays. `AppShell` does fetch the user's
relays, but the per-module services use the static defaults. For most accounts this does
not matter because their NIP-65 relays overlap the defaults, but a user whose declared
relays do not overlap the module defaults can end up seeing data locally that the
standalone app does not. The MCP server can override the module relays process-wide with
`--relays`.

## Cryptography and wire protocols

Everything lives in `packages/core/src/crypto/` and is re-exported from the package root.

- **NIP-44 v2** (`nip44.ts`): `nip44Encrypt` and `nip44Decrypt`, plus `nip44SelfEncrypt`
  and `nip44SelfDecrypt` (encrypt-to-self). This is the modern encryption used by Forms,
  Calendar, Pages, and Drive metadata.
- **NIP-59 gift wrap** (`nip59.ts`): the three-layer pipeline of rumor (unsigned), seal
  (kind 13, NIP-44 to the recipient), and wrap (kind 1059 by default, with an ephemeral
  sender key). Timestamps are randomized by up to two days to defeat timing analysis. Used
  for Forms access grants, Calendar invitations and RSVP, and Polls DMs.
- **NIP-49** `ncryptsec` passphrase encryption of secret keys is provided by
  `@formstr/signer`, not by core.
- **`nkeys`** (`nkeys.ts`): the standalone apps' bech32-plus-TLV encoding (`nkeys1...`) for
  passing encryption keys through URL hash fragments, which browsers never send to a
  server. This is byte-for-byte compatible with the upstream layout, so Forms and Pages can
  share view and edit keys through links that decode on `formstr.app` and back.
- **AES-GCM** (`aesGcm.ts`): a byte-for-byte port of the standalone Drive's blob
  encryption. A per-file key feeds a NIP-44 v2 HKDF, then AES-GCM, with a base64
  `[version, nonce, ciphertext]` payload.
- **Blossom** (`packages/core/src/blossom/`): `BlossomClient` implements BUD-02 upload,
  BUD-03 download, and BUD-04 delete. Authorization events are kind 24242. Used by Forms
  (images), Pages, and Drive.

## Cross-module linking

`packages/core/src/linking.ts` turns Nostr references into in-app routes, so clicking an
entity in one module can open it in another:

- `MODULE_ROUTES` maps each module to its route (`/forms`, `/calendar`, and so on) and is
  the single source of truth shared by the router and the AI layer.
- `parseRef` and `resolveRef` decode `naddr`, `nevent`, and `nprofile`, then map the
  embedded kind to a module through `KIND_MODULE_MAP`.
- `createTagRef` and `parseTagRef` build and read the `formstr:<module>:<identifier>` tag
  used to embed cross-module references inside events.

`KIND_MODULE_MAP` is the deep-link table: pages 33457, drive 34578, forms 30168, polls
1068, and calendar 31923, 32678, 32679, and 32123. The full per-module wire details are in
the module sections below.

## The frontend

- **Entry** (`packages/app/src/main.tsx`): React 19 in StrictMode. It kicks off auth init
  at module load and wraps the app in the MUI theme provider, `CssBaseline`, the notistack
  snackbar provider, and the router.
- **Routing** (`router.tsx`, React Router v7): a standalone `/forms/fill/:naddr` route for
  public form filling that is eagerly loaded and sits outside the shell, with everything
  else nested under `AppShell` and lazy-loaded per module, plus a settings route. The index
  redirects to `/forms`.
- **Layout** (`packages/app/src/layout/`): `AppShell` renders the header, sidebar, the main
  outlet, the auth, unlock, and migration dialogs, and the AI panel. `fullBleed.ts` decides
  which routes render edge to edge.
- **State** (`packages/app/src/stores/`, Zustand v5): one store per concern (`authStore`,
  `settingsStore`, the five module stores, `aiStore`, `aiPendingStore`,
  `invitationsStore`, `bookingStore`). Stores call the agent services and hold view state.
  They are the boundary between the UI and the Nostr service layer.
- **UI stack:** MUI v6 with Emotion, lucide-react line icons (never emoji), TipTap v3 for
  the Pages editor, Recharts for poll and analytics charts, `rrule` for calendar
  recurrence, and `qrcode` for NIP-46 pairing. Page orchestrators under
  `packages/app/src/pages/` are kept thin (under about 200 lines).

## AI assistant and the tool registry

Two consumers share the same 53-tool registry in `@formstr/agent`
(`packages/agent/src/tools/index.ts`, which concatenates the per-module tool arrays):

- The **in-browser agent** (`packages/app/src/ai/`) runs a provider-agnostic, multi-step
  tool-use loop. The model gets JSON-schema tool definitions derived from the registry's
  zod shapes, requests tools, and the loop runs them and feeds results back so it can chain
  calls across modules. It stops at a final text answer or after 8 steps.
- The **stdio MCP server** registers the same tools over the Model Context Protocol for
  external hosts. See [MCP.md](./MCP.md).

### Providers (bring your own key)

`packages/app/src/ai/providers/` has a small provider per backend, all behind one
`LLMProvider` interface (`generateStream`, `getAvailableModels`, `isAvailable`). The
factory picks one from settings:

- `anthropic` (Claude)
- `openai`
- `gemini`
- `openai-compat` (any OpenAI-compatible endpoint, with a base URL and optional key)
- `ollama` (local models, default when nothing else is set)

Keys live in the user's settings and never leave the browser. The default and most capable
target is the latest Claude model through the Anthropic provider.

### Context and the system prompt

`ConversationContext` keeps a bounded message history and a list of recently created or
referenced entities, and builds the system prompt. The prompt tells the model the current
date, the form-field vocabulary, the default poll type, and the rule that read tools and
creates run immediately while irreversible actions (delete, share, submit, rsvp, rename,
move) ask the user to confirm first.

### The safety model

Two separate gates protect destructive and outward actions. They are independent, so it
helps to keep them straight:

1. **The `write` flag on a tool** controls registration in the stdio MCP. A `write` tool is
   only registered when the server is started with `--allow-writes`. The browser agent
   always runs with writes enabled, so this gate only affects the MCP. 23 of the 53 tools
   carry this flag (see the catalog below).
2. **`requireConfirm` inside the handler** makes every one of those 23 write tools refuse
   to run unless the call includes `confirm: true`. Without it the handler returns a
   "Confirmation required" message that names the irreversible effect, instead of doing
   anything. The MCP turns that into an error result; the browser agent turns it into a
   confirm card and re-calls with `confirm: true` if the user approves.

There is also an exported `GATED_TOOLS` constant (15 names) plus an `isGated` helper. The
browser agent uses `isGated` to decide which tools to preview with a confirm card before
the first call. It is a subset of the 23 write tools (it does not include `update_form`,
`share_form`, `approve_booking`, `decline_booking`, `update_calendar`, `delete_calendar`,
`add_event_to_calendar`, or `remove_event_from_calendar`); for those, the handler-level
`requireConfirm` is still the real enforcement, and the model just sees the confirmation
message and re-calls.

## Event-kind reference (all modules)

This is the consolidated list of every Nostr event kind the app reads or writes. The exact
tags and encryption for each are documented in the module sections that follow.

### Shared and protocol kinds

| Kind  | Meaning                                  | Used by                     |
| ----- | ---------------------------------------- | --------------------------- |
| 0     | Profile metadata (NIP-01), replaceable   | all                         |
| 5     | Deletion (NIP-09), applied on load       | all                         |
| 13    | Seal (inner layer of a NIP-59 gift wrap) | gift-wrap paths             |
| 1059  | Gift wrap (default wrap kind, NIP-59)    | forms, calendar, polls      |
| 10002 | Relay list (NIP-65)                      | core relay and outbox logic |
| 24242 | Blossom authorization (BUD)              | forms, pages, drive         |

### Forms

| Kind  | Name        | Shape                                   | Purpose                                 |
| ----- | ----------- | --------------------------------------- | --------------------------------------- |
| 30168 | template    | parameterized-replaceable, `d` = formId | The form definition                     |
| 1069  | response    | regular                                 | A submitted response                    |
| 14083 | myFormsList | replaceable                             | The user's private index of their forms |
| 1059  | giftWrap    | NIP-59 wrap                             | Carries a view key to collaborators     |
| 5     | deletion    | NIP-09                                  | Form deletion                           |

### Calendar

| Kind          | Name                          | Notes                                                          |
| ------------- | ----------------------------- | -------------------------------------------------------------- |
| 31923         | publicEvent                   | Public time-based event, parameterized-replaceable             |
| 32678         | privateEvent                  | Private event, content encrypted to a per-event view key       |
| 32679         | privateRecurring              | Super-app legacy kind, read-tolerated only, never published    |
| 32123         | calendarList                  | A calendar (a collection of event refs)                        |
| 1052 / 52     | invitation wrap / rumor       | NIP-59 wrap carrying the event coordinate plus view key        |
| 31925 / 32069 | publicRsvp / privateRsvp      | RSVP responses                                                 |
| 1055 / 55     | RSVP wrap / rumor             | Super-app-only private RSVP fallback (upstream never reads it) |
| 84            | participantRemoval            | Invitation opt-out, honored by the EventStore                  |
| 31926         | publicBusyList                | Public free/busy list, one per user and month                  |
| 31927         | schedulingPage                | A Calendly-style booking link                                  |
| 32680         | schedulingPagesList           | Index of scheduling pages                                      |
| 1057 / 57     | booking request wrap / rumor  | Inbound booking requests                                       |
| 1058 / 58     | booking response wrap / rumor | Approve or decline responses                                   |

### Pages

| Kind  | Name               | Notes                                                                                                       |
| ----- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| 33457 | document           | The encrypted Markdown file, parameterized-replaceable, `d` = 6-char docId. The only on-wire tag is `["d"]` |
| 34579 | docMetadata        | Private per-doc metadata, NIP-44 self-encrypted JSON; also the shared-docs index                            |
| 1494  | comment            | Encrypted inline comment or suggestion anchored to a doc                                                    |
| 22457 | crdtOp             | Declared but unused (an experimental Yjs slot)                                                              |
| 11234 | legacy shared list | Super-app legacy kind, read-only migration source                                                           |
| 5     | deletion           | `a` plus `k` plus one `e` per known version id                                                              |

### Polls

| Kind  | Name           | Notes                                                    |
| ----- | -------------- | -------------------------------------------------------- |
| 1068  | poll           | Regular event, question in `content`                     |
| 1018  | response       | A vote                                                   |
| 1070  | responseLegacy | Read-only legacy vote kind (still queried for tallies)   |
| 34259 | rating         | Upstream ratings kind, declared but not implemented here |
| 5     | deletion       | Poll deletion and vote retraction                        |

### Drive

| Kind  | Name                       | Notes                                                                  |
| ----- | -------------------------- | ---------------------------------------------------------------------- |
| 34578 | fileMetadata               | Per-file metadata, parameterized-replaceable, `d` = the blob's SHA-256 |
| 36363 | (Blossom server discovery) | Read to discover a user's Blossom servers                              |
| 24242 | Blossom auth               | Per-upload BUD authorization event                                     |

## Module: Forms

The original Formstr app. It builds and publishes Nostr-native forms, collects responses,
and supports both public and encrypted (view-key) forms.

- Service: `packages/agent/src/services/forms/`
- Store: `packages/app/src/stores/formsStore.ts`
- UI: `FormsPage`, `FillPage`, and `components/forms/*`

### The dual-key design

Every form, public or encrypted, is signed by an ephemeral signing key, never the user's
identity key, so a form's `pubkey` is always the signing pubkey. There are two independent
ephemeral keys per form:

- The **signing key** authors the form and decrypts responses, and it is required to edit
  (replace) the form at its `30168:signingPub:formId` address.
- The **view key** is a separate keypair whose pubkey the spec is encrypted to. Anyone
  holding the view-key secret can decrypt the form.

For a **public form**, the spec rows (the `["d"]`, `["name"]`, optional `["settings"]`, and
one `["field", ...]` per field) live in plaintext tags and `content` is empty. Slot 2 of a
field tag is the upstream primitive (text, number, option, label, section, file, datetime,
grid, rating), and the concrete widget is carried in the field's answer settings.

For an **encrypted form**, the full spec tag array is NIP-44 encrypted by the signing key
to the view pubkey and stored in `content`; the outer tags carry only `["d"]`, `["name"]`,
the relay tags, and the allowed/participant tags.

Responses (kind 1069) tag `["a", "30168:formPubkey:formId"]` plus one `["response", ...]`
per answer. For an encrypted form the response tags are NIP-44 encrypted to the form pubkey
and the inline tags are stripped, so only the owner (the signing-key holder) can read them.

### The "My Forms" index (kind 14083)

Because a form's pubkey is ephemeral, forms cannot be found by author. Instead the user
keeps a private index: a NIP-44 self-encrypted JSON array, one entry per form, of the shape
`["f", "<formPubkey>:<formId>", "<relay>", "<signingKeyHex>[:<viewKeyHex>]"]`. This index
is what both this app and `formstr.app` read to list a user's forms, so creating a form
here also writes this entry. The list is read across relays and reduced to the newest
`created_at`, because it is replaceable and relays diverge.

### Sharing (gift wrap)

`shareForm` is a port of the upstream access-control grant. It builds a kind-18 rumor
authored by the signing key with `["EditAccess", signingKeyHex]` and
`["ViewAccess", viewKeyHex]` tags, seals it (kind 13), and wraps it (kind 1059) addressed
to a sha256 alias of the form coordinate and the recipient. The inbound side recovers the
granted keys by querying that alias and unwrapping. This round-trips with `formstr.app`.

### Note on deletion

`deleteForm` publishes a kind-5 deletion signed by the user and rewrites the trimmed 14083
list. The kind-5 carries `["a", coord]` and `["k", "30168"]`, but the template is authored
by the ephemeral signing key, so relays that enforce NIP-09 author matching ignore the
deletion. In practice the form is removed by being de-listed from the 14083 index, which is
what both apps actually honor. This matches the upstream limitation.

## Module: Calendar

The richest module: public and private events, per-event view-key encryption, NIP-59
invitations, RSVP with counter-proposals, shared calendar lists, Calendly-style
appointment scheduling, recurrence, and delete-that-sticks. The wire target is
`calendar.formstr.app`.

- Services: `packages/agent/src/services/calendar/` (`service.ts`, `rsvp.ts`,
  `booking.ts`, `busyList.ts`, `viewKey.ts`, `calendarListCodec.ts`)
- Stores: `calendarStore`, `invitationsStore`, `bookingStore`

### Public events (kind 31923)

Tags include `["d", id]`, `["title"]`, `["description"]`, `["start"]` and `["end"]` in unix
seconds, optional `["location"]`, `["image"]`, category `["t", ...]` tags, participant
`["p", ...]` tags, IANA timezone tags, and recurrence as the NIP-32 label pair
`["L", "rrule"]` and `["l", RRULE]`. A `["form", naddr]` tag can attach a registration form.

### Private events (kind 32678) and view keys

Each private event mints a per-event view key (an `nsec`). The event payload is JSON,
self-encrypted under the view key, and stored in `content`; the only on-wire tag is
`["d", id]`. The encrypted payload itself carries an inner `["d", id]`, which is a hard
interop requirement: `calendar.formstr.app` replaces the event's tags with the decrypted
array and reads the id from that inner `d` row. Anyone holding the view-key `nsec` decrypts
the event, which is what makes private events shareable with invitees.

Invitations are NIP-59 gift wraps (wrap kind 1052, rumor kind 52) that carry
`["a", coordinate, relayHint]` and `["viewKey", nsec]`, published to each participant's
NIP-65 relays.

### Calendar lists (kind 32123)

A calendar list holds title, description, color, and a set of event refs of the shape
`[coordinate, relayHint, viewKey]`. Because the per-event view key rides inside the ref, a
shared calendar lets its members decrypt private events authored by others.

### RSVP, scheduling, and busy lists

RSVP publishes a public RSVP (kind 31925) or, for a private event with a view key, a
private RSVP (kind 32069) encrypted with that view key. Calendly-style scheduling uses
scheduling pages (kind 31927) indexed by a list (kind 32680), with booking requests and
responses delivered as gift wraps (1057/57 and 1058/58). Availability is published as
public busy lists (kind 31926), one parameterized-replaceable event per user and month,
with repeatable `["block", startSec, endSec]` rows and no titles, so nothing leaks.

### Delete-that-sticks

Calendar fetches kind-5 deletions and applies them on load, because relays keep serving
addressable events after a deletion request. The direct author query intentionally uses no
`created_at` window, because relays filter `since`/`until` by publish time, not by the
event's start, so a month-bounded window used to silently drop cross-app events.

## Module: Pages

Private Markdown documents (the `nostr-docs` project, `pages.formstr.app`): an encrypted
notebook with per-document share links (view-only or editable), private labels, renames,
and encrypted inline comments.

- Service: `packages/agent/src/services/pages/`
- Store: `pagesStore`
- UI: `PagesPage`, plus a TipTap editor with a Markdown bridge

### Document encryption (kind 33457)

There are two modes, matching the standalone's `encryptContent`:

- A **personal doc** is owner NIP-44 self-encrypted.
- A **shared doc** is NIP-44 encrypted under a self-conversation keyed by a random 32-byte
  view key, so anyone holding that view key (in hex) decrypts. The title is just the first
  decrypted Markdown line, so no metadata leaks on-wire (the only tag is `["d"]`).

Share links carry the keys only in the URL hash: `/pages/<naddr>#<nkeys>` with a view key
and an optional edit key. An editable share is re-signed with a second random edit key and
lives at `33457:editKeyPub:dtag`, so recipients can replace it with no Nostr identity of
their own.

### Doc metadata and the shared-docs index (kind 34579)

One NIP-44 self-encrypted JSON object per doc address carries four features at once: private
tags, a custom title, the view/edit keys (which make this object double as the
shared-with-me index), and a `sharedAs` back-pointer from an original doc to its
edit-key-signed shared copy. Every write here is read-merge-write, because clobbering a
`viewKey` would permanently lose access to a shared doc. A doc that has `sharedAs` set must
not be edited and republished from local state, because the live copy is the shared address.

### Comments (kind 1494)

Tags are `["a", docAddress]`, `["e", docEventId]`, and `["p", docOwner]`. `content` is the
NIP-44 (view-key self-conversation) ciphertext of a flat inner tag array holding the comment
text, its type (comment or suggestion), and optional quote and context anchors. The anchor
is public; the body is view-key gated.

## Module: Polls

NIP-88-style public polls (the `nostr-polls` project, `pollerama.fun`): single or multiple
choice, optional expiry and proof-of-work gate, and live tallies. This is the cleanest
module, because polls are plain public events authored by the user and discovered by author,
so the cross-app discovery problems the other modules guard against cannot happen here.

- Service: `packages/agent/src/services/polls/`
- Store: `pollsStore`

### Poll (kind 1068) and votes (kind 1018)

A poll carries one `["option", id, label]` per option, per-relay `["relay", url]` tags,
optional hashtags, a `["polltype", "singlechoice"|"multiplechoice"]` tag, an optional
`["endsAt", unixSec]`, and an optional `["PoW", difficulty]` (which the parser reads but
never writes). A vote carries `["e", pollId]`, `["p", pollAuthor]`, and one
`["response", optionId]` per selection.

### Proof of work

When a poll has a `["PoW", d]` tag, votes must be NIP-13 mined. The miner appends
`["nonce", count, d]` and the query tag `["W", d]`, then grinds the nonce until the id meets
the target. Upstream discovers votes with a `#W=[d]` filter and drops under-target ids, so a
vote without the nonce and `W` tags is invisible there. The tally keeps each voter's latest
response, counts each (voter, option) once, and computes percentages as an option's count
over the sum of all counts, which matches upstream exactly.

## Module: Drive

Encrypted file storage (the `formstr-drive` project, `drive.formstr.app`): blobs on Blossom
servers, with a private per-file metadata index on relays.

- Service: `packages/agent/src/services/drive/`
- Store: `driveStore`

### Metadata (kind 34578)

One parameterized-replaceable event per file, with `d` set to the blob's SHA-256, and tags
`["client", "formstr-drive"]` and `["encrypted", "nip44"]`. `content` is the NIP-44
self-encrypted file metadata JSON: name, hash, size, type, folder, uploadedAt, server,
encryptionKey, `encryptionAlgorithm: "aes-gcm"`, an optional `previewHash`, and an optional
`deleted` flag.

### File encryption and previews

Each file gets a fresh nostr keypair; the conversation key is the self-conversation of that
key, and AES-GCM encrypts the blob. The hex secret lives only inside the self-encrypted
metadata, so losing that kind-34578 event (or the identity key that decrypts it) orphans the
blob. Image uploads also publish a downscaled webp thumbnail encrypted with the same per-file
key; its hash becomes `previewHash`.

### Soft delete and folders

Deletion republishes the same `d` with `deleted: true` (no kind-5, matching upstream), and
reads keep only the newest event per hash, so a stale event cannot resurrect a deleted file.
Folders are virtual paths inside the metadata; custom empty folders are device-local.

## Conventions and invariants

- **Wire compatibility first.** A module's kinds, tags, and encryption must match its
  standalone app, and relay defaults are the union with the standalone's relays.
- **Delete-that-sticks.** Because relays keep serving addressable events, modules fetch
  kind-5 deletions and apply them on load rather than trusting relays to enforce them.
- **Keys stay client-side.** Identity keys never reach a server; share keys travel only in
  URL hash fragments; the agent and the MCP never return key material.
- **Confirm destructive actions.** Every write tool requires `confirm: true`, and the stdio
  MCP additionally hides those tools unless `--allow-writes` is set.
- **UI:** outlined lucide icons, never emoji; thin page orchestrators; tests for backend
  code.
