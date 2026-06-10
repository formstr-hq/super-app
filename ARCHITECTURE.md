# Formstr Super-App — Architecture

> Code-grounded architecture reference. Every statement below is derived from the
> source in this repository, not from external assumptions. File paths are relative
> to the repo root (`packages/<pkg>/src/...`).
>
> This document is written incrementally. Part I covers the cross-cutting
> foundation (packages, identity, runtime, relays, crypto, the app shell, the AI/MCP
> layer). Parts II+ document each feature module (Forms, Calendar, Pages, Polls,
> Drive) one at a time.

---

# Part I — Foundation

## 1. What this is

A unified, **fully client-side** Nostr application that bundles five formerly-standalone
Formstr apps — **Forms, Calendar, Pages, Drive, Polls** — into one workspace, plus an
**AI orchestration layer** and a **standalone MCP server** that exposes the same
capabilities to external agent hosts (Claude Desktop, Cursor, etc.).

Core properties, all verifiable in code:

- **No backend.** The browser talks to Nostr relays directly (`SimplePool` in
  `packages/core/src/runtime/NostrRuntime.ts`) and to Blossom blob servers over HTTP
  (`packages/core/src/blossom/BlossomClient.ts`). Identity keys never leave the client.
- **Wire-parity with the standalone apps.** Each module reads/writes the same Nostr
  event kinds, tags, and encryption model as its original standalone app, so data
  syncs both ways. Per-module relay default sets are unioned with the standalone
  defaults (`packages/core/src/relay/module-defaults.ts`).
- **One identity engine.** Both the web app and the MCP server use `@formstr/signer`
  for login/identity, bridged into the shared `signerManager` from `@formstr/core`.

## 2. Repository layout

pnpm monorepo. `pnpm-workspace.yaml` globs `packages/*`. Four packages:

| Package          | Version | Published        | Role                                                                                                                                                                           |
| ---------------- | ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@formstr/core`  | 0.0.1   | private          | Nostr primitives: signers, relay/runtime, crypto, Blossom, linking. Pure TS, built with `tsc`.                                                                                 |
| `@formstr/agent` | 0.0.1   | private          | The 5 modules' **service layer** + the **53-tool registry** + neutral `result`/`safety`/`schema` helpers. Ships its `src/*.ts` directly via package `exports` (no build step). |
| `@formstr/app`   | 0.0.1   | private          | The React 19 web client (UI, stores, AI runtime). Built with Vite.                                                                                                             |
| `@formstr/mcp`   | 0.1.1   | **public (npm)** | stdio MCP server wrapping the agent's tool registry. Single-file CJS bundle via `tsup`; `bin: formstr-mcp`.                                                                    |

Root `package.json` is `private`, `type: module`, and orchestrates the workspace
(`pnpm -r build`, `pnpm -r typecheck`, `vitest run`, etc.).

## 3. Package layering & dependency rules

```
                      @formstr/core   (nostr primitives; deps: nostr-tools, @noble/hashes)
                            ▲
                            │
                      @formstr/agent  (services + tool registry; deps: core, nostr-tools, zod, zod-to-json-schema)
                            ▲
              ┌─────────────┴─────────────┐
        @formstr/app                  @formstr/mcp
   (React UI + in-browser agent)   (stdio MCP CLI)
   deps: core, agent,              deps (runtime): @napi-rs/keyring
         @formstr/signer (npm)     deps (bundled by tsup): core, agent,
                                         @formstr/signer, @modelcontextprotocol/sdk
```

Key invariants enforced by this layering:

- **`@formstr/agent` is MCP-SDK-free and DOM-free.** Its services import only
  `@formstr/core` + `nostr-tools` (one guarded `window` use), so they run unchanged in
  both the browser (app) and Node (mcp). Tools return a neutral `ToolResult`
  (`packages/agent/src/result.ts`); the MCP adapter maps that to the SDK's
  `CallToolResult`.
- **`@formstr/mcp` does not depend on `@formstr/app`.** It imports the registry from
  `@formstr/agent` and bundles everything except the native `@napi-rs/keyring` addon
  (`packages/mcp/tsup.config.ts`: `noExternal: [/^(?!@napi-rs\/keyring)/]`). The
  published tarball carries zero workspace `@formstr/*` references.
- The **app imports services via deep paths** (`@formstr/agent/services/<module>`),
  matching the per-module `exports` map in `packages/agent/package.json`.

## 4. Build & dev tooling

- **TypeScript** strict everywhere (`tsconfig.base.json`): `target ES2022`, `module
ESNext`, `moduleResolution bundler`, `strict`, `noUnusedLocals/Parameters`,
  `noFallthroughCasesInSwitch`, `isolatedModules`, `declaration` + maps.
- **Build:** core → `tsc` to `dist`; app → `tsc -b && vite build`; mcp → `tsup`
  (CJS, `target node20`, single file, shebang banner). agent has no build (source
  exports).
- **Tests:** Vitest. The root `vitest.workspace.ts` includes `packages/core` and
  `packages/app`; `@formstr/agent` and `@formstr/mcp` each run their own `vitest run`.
  Standing convention: **backend-only tests (service/store/MCP), TDD**; very few
  frontend component tests.
- **Lint/format:** ESLint 9 flat config + Prettier, run on commit via Husky +
  lint-staged (`eslint --fix` then `prettier --write` on staged files). Commits are
  GPG-signed.

## 5. Identity & signing

### 5.1 The core contract

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

### 5.2 `SignerManager` (singleton)

`packages/core/src/signer/SignerManager.ts` exports `signerManager`. It owns the
active signer, pubkey, method, `ready` flag, an observer set, and a single
`loginModalCallback`. Notable behavior:

- **Two-phase restore** (`restore()`): reads `formstr:signer-method` / `formstr:pubkey`
  from `localStorage`; phase 1 installs a `DeferredSigner` (queues ops against the
  cached pubkey for instant startup), phase 2 resolves the real signer in the
  background.
- **`getSigner()`** (blocking, used by write paths) returns the signer or, if none,
  invokes the registered login modal callback; **`getSignerIfAvailable()`**
  (non-blocking, read paths) returns null when absent.
- **`setActiveSigner(signer | null, method, pubkey)`** is the injection point used by
  the app's `@formstr/signer` bridge. `null` means "locked": the account/pubkey is
  shown but `getSigner()` routes to the unlock modal. It disposes any prior
  `LocalSigner` and wipes the legacy `formstr:client-secret` so no raw key persists.
- Concrete signers in the same directory: `LocalSigner` (in-memory secret key with
  `dispose()` zeroization), `NIP07Signer` (`window.nostr`), `NIP46Signer` (wraps a
  bunker connection), `DeferredSigner`, and `DriveSignerAdapter`.

### 5.3 App identity (browser)

The web app uses **`@formstr/signer`** (npm `^0.1.0`) as the identity engine:

- `packages/app/src/auth/appSigner.ts` — the singleton `createSigner({ appName:
"Formstr", storageKeyPrefix: "formstr:signer:" })`, persisting accounts to
  `localStorage`.
- `packages/app/src/stores/authStore.ts` — the **bridge**: subscribes to
  `appSigner.onChange`, and on each change adapts the unlocked `ActiveSigner` →
  `NostrSigner` (`auth/toNostrSigner.ts`) and injects it via
  `signerManager.setActiveSigner(...)`. Multi-account: accounts re-hydrate **locked**
  after reload and unlock on demand (passphrase for `ncryptsec`, page-grant for
  extension, session resume for NIP-46). `auth/methodMap.ts` maps the signer's
  `LoginMethod` → core `SignerMethod`.
- Local keys are stored **NIP-49 `ncryptsec`** (passphrase-encrypted); a raw nsec is
  never persisted. Login surfaces: `components/LoginDialog.tsx` (extension / create /
  import / bunker / QR), `components/UnlockDialog.tsx`, `components/MigrationDialog.tsx`
  (one-time legacy plaintext-key → ncryptsec).

### 5.4 MCP identity (Node)

The MCP server uses the **same `@formstr/signer` engine** but backed by an encrypted
**keystore** (OS keychain → AES-256-GCM file) instead of `localStorage`, with
terminal-only login and headless boot-unlock. See Part III (MCP) for the full flow;
the bridge mirrors the app exactly (`packages/mcp/src/bootstrap.ts` calls the same
`setActiveSigner` + `toNostrSigner`).

## 6. Nostr runtime

`packages/core/src/runtime/` provides the shared event plumbing as the
`nostrRuntime` singleton (`NostrRuntime.ts`), composed of three parts:

- **`SimplePool`** (from `nostr-tools`) — the actual relay connections.
- **`EventStore`** (`EventStore.ts`) — a multi-indexed in-memory cache (by id, kind,
  author, and `kind:pubkey:dtag` address). It correctly handles **replaceable**
  (0, 3, 10000–19999) and **parameterized-replaceable** (30000–39999) events
  (keeping the newest per address), applies **NIP-09 kind-5 deletions** (same-author
  forgery guard on both `e` and `a` targets; `deletedCoordinates` tombstones keyed by
  deletion time, so an `a`-deletion arriving before its target sticks while a
  legitimate re-publish survives), honors **kind-84 participant removals**
  (participant `p`-tag check, ignoredEventIds/Coordinates — upstream calendar parity),
  and supports reactive `subscribe(filter, cb)` via `matchFilter`.
- **`SubscriptionManager`** (`SubscriptionManager.ts`) — **deduplicates** identical
  `(relays, filters)` subscriptions by hash with reference counting (auto-closes at 0
  refs), replays already-received events to late listeners, fires EOSE per listener,
  and **auto-chunks** filters with >1000 authors into 1000-author batches.

`NostrRuntime` exposes: `query`/`get` (sync cache), `subscribe` (network + store +
forward), `fetchOne` (first match then close, 10s default timeout, cache-first),
`querySync` (collect-until-EOSE), `fetchBatched` (coalesces single-id lookups in a
**50 ms** window, grouped by relay set), and `publish` (`pool.publish` via
`Promise.allSettled`, then store locally).

## 7. Relays

- **`RelayManager`** (`packages/core/src/relay/RelayManager.ts`, singleton
  `relayManager`) — merges the user's **NIP-65** relay list (kind 10002) with a
  built-in default set of 6 relays. Exposes `getReadRelays`/`getWriteRelays`/
  `getAllRelays`/`getDefaultRelays`, `fetchUserRelays(pubkey)`/`setUserRelays`, and
  **`getRelaysForModule(module)`** which returns per-module defaults.
- **`MODULE_DEFAULT_RELAYS`** (`relay/module-defaults.ts`) — per-module relay arrays
  for `forms / calendar / pages / drive / polls`. These are **unioned with each
  standalone app's hardcoded relays** so cross-app sync works (the calendar set, e.g.,
  explicitly merges `calendar.formstr.app`'s relays).
- **`OutboxService`** (`relay/OutboxService.ts`, singleton `outboxService`) — NIP-65
  gossip discovery with a 3-tier cache (in-memory → `localStorage` `formstr:outbox:*`
  → network, 5-min TTL, stale-while-revalidate). Resolves outbox/inbox relays per
  author and merges relay sets for a set of authors (capped at 20).

> Note: the MCP server overrides `relayManager.getRelaysForModule` process-wide when
> the operator passes `--relays`/`FORMSTR_RELAYS` (`packages/mcp/src/bootstrap.ts`).

## 8. Cryptography & wire protocols

All in `packages/core/src/crypto/` (re-exported from the package root):

- **NIP-44 v2** (`nip44.ts`) — `nip44Encrypt`/`nip44Decrypt` plus `nip44SelfEncrypt`/
  `nip44SelfDecrypt` (encrypt-to-self), the modern encryption used by Forms, Calendar,
  Pages, and Drive metadata.
- **NIP-59 Gift Wrap** (`nip59.ts`) — the three-layer pipeline: **rumor** (unsigned) →
  **seal** (kind 13, NIP-44 to recipient) → **wrap** (default kind **1059**,
  overridable, ephemeral sender key). Timestamps are randomized ±2 days to defeat
  timing analysis. Helpers: `createRumor`/`createSeal`/`createWrap`, `wrapEvent`,
  `wrapManyEvents` (per-recipient seals), `unwrapEvent`. Used for Forms access grants,
  Calendar invitations/RSVP, and Polls DMs.
- **NIP-49** — `ncryptsec` passphrase encryption of secret keys is provided by
  `@formstr/signer` (used for identity), not by core.
- **`nkeys`** (`nkeys.ts`) — the standalone apps' **bech32 + TLV** encoding (`nkeys1…`)
  for passing encryption keys through **URL hash fragments** (`#nkeys1…`), which
  browsers never send to a server. Byte-for-byte upstream layout (nostr-forms /
  nostr-docs `utils/nkeys.ts`): 1-byte length TLVs with ALL type-0 (key names) grouped
  before ALL type-1 (key values), paired by index; 255-byte value guard; 2048-char
  bech32 limit. This is how Forms and Pages share view/edit keys via links —
  cross-decodable with formstr.app in both directions. `encodeNKeys`/`decodeNKeys`.
- **AES-GCM** (`aesGcm.ts`) — `encryptFileWithKey`/`decryptFileWithKey` +
  `aesGcmEncrypt`/`aesGcmDecrypt`, a byte-for-byte port of the standalone Drive's blob
  encryption (per-file key → NIP-44-v2 HKDF → AES-GCM, base64 `[ver|nonce|ct]`).
- **Blossom** (`packages/core/src/blossom/`) — `BlossomClient` implements **BUD-02**
  upload (`PUT /upload`, `Authorization: Nostr <base64 event>`, `X-SHA-256` header),
  **BUD-03** download (`GET /<sha256>`), **BUD-04** delete (`DELETE /<sha256>`). Auth
  events are **kind 24242** (`createBlossomAuthEvent` in `blossom/auth.ts`). Tolerates
  both JSON-descriptor and bare-hash responses. Used by Forms (images), Pages, Drive.

## 9. Cross-module linking

`packages/core/src/linking.ts` resolves Nostr references to in-app routes for
"click an entity in one module → open it in another":

- `MODULE_ROUTES` — the single source of truth mapping `forms/calendar/pages/drive/
polls` → `/forms`, `/calendar`, … (also consumed by the router and AI layer).
- `parseRef(bech32)` / `resolveRef(bech32)` — decode `naddr`/`nevent`/`nprofile` and
  map the embedded kind to a module via `KIND_MODULE_MAP`.
- `createTagRef`/`parseTagRef` — the `formstr:<module>:<identifier>` event-tag form
  used to embed cross-module references inside events.

> `KIND_MODULE_MAP` in `linking.ts` is the **deep-link** kind table, aligned with the
> kinds the modules actually write: pages 33457, drive 34578, forms 30168, polls 1068,
> calendar 31923/32678/32679/32123. The authoritative per-module wire documentation
> lives in each module's section.

## 10. Frontend application shell

- **Entry** (`packages/app/src/main.tsx`): React 19 `StrictMode`; calls
  `useAuthStore.getState().init()` at module load; wraps the app in MUI
  `ThemeProvider` (theme derived from `settingsStore.themeMode`, `theme.ts`),
  `CssBaseline`, notistack `SnackbarProvider`, and `RouterProvider`.
- **Routing** (`router.tsx`, `react-router-dom` v7 `createBrowserRouter`): a
  standalone `/forms/fill/:naddr` route (`FillPage`, eagerly loaded) for public form
  filling; everything else nests under `AppShell` with **lazy-loaded** module pages
  (`forms/* calendar/* pages/* drive/* polls/*`) and a `settings` route. Index
  redirects to `/forms`.
- **Layout** (`packages/app/src/layout/`): `AppShell` (renders Header + Sidebar +
  `<Outlet>` + the auth/unlock/migration dialogs + AI panel), `Header`, `Sidebar`, and
  `fullBleed.ts` (which routes render edge-to-edge vs. contained).
- **State** (`packages/app/src/stores/`, **Zustand** v5): one store per concern —
  `authStore`, `settingsStore`, `formsStore`, `calendarStore`, `pagesStore`,
  `driveStore`, `pollsStore`, `aiStore`, `aiPendingStore`, `invitationsStore`,
  `bookingStore`. Stores call `@formstr/agent` services and hold view state; they are
  the boundary between UI and the Nostr service layer.
- **UI stack:** MUI v6 (+ Emotion), **lucide-react** line icons (never emoji), TipTap
  v3 (Pages rich editor), Recharts (Polls/analytics), `rrule` (Calendar recurrence),
  `qrcode` (NIP-46 pairing). Module components live under
  `packages/app/src/components/<module>/`; page orchestrators under
  `packages/app/src/pages/` are kept thin (target < 200 LOC).

## 11. AI orchestration & MCP (overview)

Two consumers share the **same 53-tool registry** in `@formstr/agent`
(`packages/agent/src/tools/index.ts`, aggregating forms/calendar/pages/polls/drive
tool arrays):

- **In-browser agent** (`packages/app/src/ai/`): a provider-agnostic multi-step
  tool-use loop (`agent.ts`) over BYOK LLM providers (Anthropic / OpenAI /
  OpenAI-compatible / Gemini / Ollama in `ai/providers/`). Tool JSON-schemas come from
  the registry's zod shapes via `getToolSchemas()`. Gated tools surface an inline
  confirm card before executing.
- **stdio MCP server** (`@formstr/mcp`): registers the same registry over the
  Model Context Protocol for external hosts.

Both honor the registry's safety model (`packages/agent/src/safety.ts`):

- **`GATED_TOOLS`** — the 15 mutating/outward tools. In the stdio MCP these are
  registered **only** when `--allow-writes` is set (the `ToolCtx.allowWrites` flag,
  checked in `packages/mcp/src/server.ts`).
- **`requireConfirm(tool, args, effect)`** — even when registered, a gated tool
  refuses to run without `confirm: true`, returning a `Confirmation required…` message
  naming the irreversible effect. `ToolResult` (`result.ts`) is the neutral
  success/error/`data` shape both consumers share.

Details of the agent loop, providers, BYOK settings, and the MCP CLI are in Part III.

## 12. Event-kind reference (consolidated)

Authoritative kinds are listed per module in Parts II+. The cross-module deep-link
table (`linking.ts`) and the kinds confirmed so far:

| Kind  | Type                | Used by | Notes                                |
| ----- | ------------------- | ------- | ------------------------------------ |
| 0     | profile (NIP-01)    | all     | replaceable                          |
| 5     | deletion (NIP-09)   | all     | applied on load (delete-that-sticks) |
| 13    | seal                | NIP-59  | inner layer of gift wrap             |
| 1059  | gift wrap           | NIP-59  | default wrap kind                    |
| 10002 | relay list (NIP-65) | core    | RelayManager / OutboxService         |
| 24242 | Blossom auth        | core    | BUD authorization events             |

(Module-specific kinds — forms 30168, calendar 31923/32678/32123/31926, polls
1068/1018, pages 33457, drive 34578, RSVP, invitations, etc. — are documented with
exact tags in each module's section.)

## 13. Conventions & invariants

- **Wire-parity first.** A module's event kinds/tags/encryption must match its
  standalone app; relay defaults are unioned with the standalone's.
- **Delete-that-sticks.** Because relays keep serving addressable events, modules fetch
  NIP-09 kind-5 deletions and apply them **on load**.
- **Keys stay client-side.** Identity keys never hit a server; share keys travel only
  in URL hash fragments (`nkeys`); the agent/MCP never return key material.
- **Confirmation for destructive actions.** All `GATED_TOOLS` require explicit
  `confirm: true`; the stdio MCP additionally hides them without `--allow-writes`.
- **UI:** outlined lucide icons, never emoji; thin page orchestrators; backend-only
  TDD.

---

# Part II — Forms module

The original Formstr app. Builds and publishes Nostr-native forms/surveys, collects
responses, and supports public and encrypted (view-key) forms with cross-app parity to
`formstr.app` and `@formstr/sdk`.

- **Service:** `packages/agent/src/services/forms/{service.ts,types.ts,keys.ts}`
- **Store:** `packages/app/src/stores/formsStore.ts`
- **UI:** `packages/app/src/pages/{FormsPage,FillPage}.tsx`,
  `packages/app/src/components/forms/*`
- **Tools:** `packages/agent/src/tools/forms.ts` (9 tools)

## II.1 Event kinds (`forms/types.ts` → `FORM_KINDS`)

| Kind      | Name          | Shape                                    | Purpose                                           |
| --------- | ------------- | ---------------------------------------- | ------------------------------------------------- |
| **30168** | `template`    | parameterized-replaceable (`d` = formId) | The form definition.                              |
| **1069**  | `response`    | regular                                  | A submitted response.                             |
| **14083** | `myFormsList` | replaceable                              | The user's private index of their/imported forms. |
| **1059**  | `giftWrap`    | NIP-59 wrap                              | Carries the view key to collaborators.            |
| 5         | deletion      | NIP-09                                   | Form deletion.                                    |

## II.2 Form template (kind 30168) wire format

`createForm` builds the upstream spec rows (`buildSpecRows`): `["d", formId]`,
`["name", name]`, optional `["settings", JSON]`, and one
`["field", id, PRIMITIVE, label, optionsJSON, answerSettingsJSON]` per field
(`fieldCodec.ts: buildFieldTag/parseFieldTag` — pure, fully unit-tested):

- **Slot 2 is the upstream PRIMITIVE** (`text, number, option, label, section, file,
datetime, grid, rating`); the concrete widget is `answerSettings.renderElement`
  (the `AnswerTypes` value), exactly what formstr.app's filler switches on.
- `optionsJSON` = `[[choiceId,label,settingsJSON?], …]` for choice fields, or a
  `GridOptions` `{columns:[[id,label]…], rows:[[id,label]…]}` object for grids.
- `answerSettingsJSON` carries `renderElement`, `required`, `validationRules`
  (`min/max/regex` mapped from the super-app's `validation`), `maxStars` (rating),
  `allowMultiplePerRow` (checkbox grids), and blossom file keys
  (`blossomServer`/`maxFileSize` MB/`allowedTypes`) mapped from `fileConfig`.
- Field types: `AnswerType` enum — `shortText, paragraph, radioButton, checkboxes,
dropdown, number, date, label, time, datetime, fileUpload, signature,
multipleChoiceGrid, checkboxGrid, rating, section` (legacy `multiChoiceGrid` is
  read-tolerated; section = page-break marker, not answerable).
- Parse precedence: primitive `section` → `renderElement` → legacy slot-2 AnswerType →
  per-primitive default.
- **Every plaintext form** gets `["t", "public"]` (upstream does, regardless of
  `settings.publicForm`) and per-relay `["relay", url]` tags; `content` is empty.

`formId` is an 8-char `crypto.randomUUID().slice(0,8)`.

## II.3 Encryption model (the dual-key design)

Two independent ephemeral keys per form, never the user's identity key. **All** forms
(public too) are `finalizeEvent`-signed with an ephemeral **signing key** — the
upstream model — so a form's `pubkey` is always the signing pubkey:

- **signing key** — authors the form event and decrypts responses; required to edit
  (replace) the form at its `30168:signingPub:formId` address.
- **view key** — an ephemeral keypair whose pubkey the spec is encrypted _to_.
  Anyone holding the view key (secret) can decrypt.

Flows:

- **Encrypted forms:** the **full spec tag array** (d, name, settings, field rows) is
  `formSigner(signingKey).nip44Encrypt(viewPubkey, JSON(specRows))` → stored in
  `content`. Outer tags carry only `["d"], ["name"], ["relay"…], ["allowed"…], ["p"…]`
  (allowed = `settings.allowedResponders`; p = allowed ∪ collaborators) — **no
  settings, no `encryption` tag** (detection = non-empty content with no field tags).
  Decryption (`fetchForm`): `makeViewKeySigner(viewKey).nip44Decrypt(formPubkey,
content)`; `parseFormEvent(event, decryptedRows)` merges outer + decrypted rows
  (outer-first), still honoring the legacy `["encryption","view-key"]` tag and the
  legacy field-rows-only ciphertext.
- **Responses** (`submitResponse`): tag `["a", "30168:formPubkey:formId"]` plus one
  `["response", fieldId, answer, metadata]` per answer. When `encrypt`, the response
  tags are NIP-44-encrypted by the responder _to the form pubkey_ and the inline tags
  are stripped (only the `a` tag remains). The form owner decrypts with the **signing
  key**. Submits/fetches go to the form's `["relay"]` tags ∪ module relays.
- **Public forms:** spec rows live in plaintext tags; `content` empty; still signed by
  the ephemeral signing key (so formstr.app can edit them and vice versa).

## II.4 "My Forms" index (kind 14083)

A **NIP-44 self-encrypted** JSON array, one entry per form
(`appendToMyFormsList`/`saveToMyForms`):

```
["f", "<formPubkey>:<formId>", "<relay>", "<signingKeyHex>[:<viewKeyHex>]"]
```

Public forms carry just the signing key in the 4th segment (upstream
`saveToMyForms` semantics); encrypted forms append `:viewKey`. The relay slot is
preserved on rewrite (`FormSummary.relay`). Key encoding is shared with
`@formstr/sdk` / `formstr.app` (`keys.ts`: `encodeFormKeys`/`decodeFormKeys`).

Critical compatibility details (all in `service.ts`):

- **Newest-across-relays read** (`fetchLatestMyFormsEvent`): kind-14083 is replaceable
  and relays diverge, so the list is read with `querySync` and reduced to the highest
  `created_at` — never a first-responder `fetchOne`, which could drop entries on
  republish.
- **Self-encryption with NIP-44** (not NIP-04): `formstr.app`'s loader decrypts with
  `nip44Decrypt(userPub, content)`; the reader also tolerates legacy NIP-04 content
  (`?iv=` heuristic) on read.
- **Legacy entry normalization**: 3-element entries are padded to the canonical
  4-element shape because `formstr.app` does an unguarded `entry[3].split(":")`.
- **Fallback discovery** (`fetchMyFormsByAuthor`): if the list is empty/unreadable,
  forms are discovered by querying kind-30168 authored by the user.

## II.5 Service API surface (`forms/service.ts`)

`createForm` · `fetchForm` (optional `viewKey`; auto-discovers a granted view key via
`fetchFormKeys` when none is supplied) · `submitResponse` (optional `overrideSigner`,
used by the public filler; optional `formRelays`) · `subscribeToResponses` /
`fetchResponses` (optional `signingKey` to decrypt, optional `formRelays`) ·
`fetchMyForms` (+ `fetchMyFormsByAuthor` fallback) · `saveToMyForms` · `deleteForm`
(NIP-09 kind-5 with `["a", coord]` + `["k","30168"]`, then rewrites the trimmed 14083
from the raw decrypted entries so the delete sticks) · `updateForm` (re-publishes the
replaceable template, signing with the stored ephemeral signing key — no address fork) ·
`shareForm` · `fetchFormKeys` · `importForm` / `fetchFormSummaryFromRef`.

**Sharing** (`shareForm`) — a port of upstream `accessControl.grantAccess`: a rumor
**kind 18** authored by the _signing key_ with `["EditAccess", signingKeyHex]` (for
`editors`) and `["ViewAccess", viewKeyHex]` tags, sealed (kind 13) by the signing key,
wrapped (kind 1059) by a random key whose `p` tag is the **sha256 alias**
`sha256("30168:" + signingPub + ":" + formId + ":" + recipientPub)` — timestamps are
`now()` (no randomization; core `wrapEvent` is deliberately not used). The inbound
side, `fetchFormKeys(formAuthor, formId)`, queries kind-1059 by that alias and
unwraps wrap→seal→rumor with the user's signer, recovering granted view/edit keys —
round-trips with formstr.app in both directions.

## II.6 App layer

- **Store** (`formsStore.ts`): `myForms`, `currentForm`, `responses`; `fetchMyForms`,
  `loadForm` (pulls the cached `viewKey` from the summary), `loadResponses` (live
  subscription, decrypts with the cached `signingKey`), `createForm`, `deleteForm`.
- **Pages/components:** `FormsPage` (full-bleed `/forms` workspace), `FillPage`
  (standalone public `/forms/fill/:naddr`, not under `AppShell`, not lazy — see
  `router.tsx`), and `components/forms/*` (`FormBuilderSurface`, `FormListView`,
  `FormCard`, `FillFormDialog`, `ResponsesDialog`, `FormAnalytics`,
  `FormFieldsRenderer`, `ResponderIdentityBar`, etc.). `/forms` is registered full-bleed
  (`layout/fullBleed.ts`).
- **Blossom** uploads back file/image fields (`FormFieldFileConfig.blossomServer`,
  `settings.titleImageUrl`/`coverImageUrl`).

## II.7 Tool surface (`tools/forms.ts`, 9 tools)

Read/create (always registered): `list_forms`, `get_form` (optional `viewKey`),
`fetch_form_responses` (auto-decrypts when the form is in the caller's own list),
`create_form` (full field/validation/image/thank-you support), `import_form_from_naddr`
(accepts `naddr1…`, `pubkey:formId`, or `kind:pubkey:formId`).

Gated (`write: true`, require `confirm: true`, hidden without `--allow-writes`):
`update_form`, `share_form`, `delete_form`, `submit_form_response`. `aiFieldsToFormFields`
and `normalizePubkeyList` (`tools/shared.ts`) coerce loose AI input into the strict field
/ pubkey shapes.

## II.8 Critical points

- Every form's `pubkey` is the **ephemeral signing pubkey**, not the user's — so forms
  are discovered via the kind-14083 list (which stores the keys), and losing that list
  means losing edit/decrypt ability (unless someone re-shares the keys via a kind-1059
  access grant, which `fetchFormKeys` can recover).
- Response privacy is **one-way to the owner**: responders encrypt to the form pubkey;
  only the signing-key holder decrypts. A non-owner fetching responses sees
  `_(encrypted)_` placeholders.
- `updateForm`/`shareForm` require the caller to be the owner (keys resolved from the
  user's my-forms list), enforced in the service, not just the UI.

---

# Part III — Calendar module

The richest module — public/private events, per-event view-key encryption, NIP-59
invitations, RSVP (with counter-proposals), shared calendar lists, Calendly-style
appointment scheduling, recurrence, and delete-that-sticks. Wire-parity target:
`nostr-calendar` / `calendar.formstr.app`.

- **Services:** `packages/agent/src/services/calendar/{service.ts, rsvp.ts, booking.ts,
viewKey.ts, calendarListCodec.ts, types.ts}`
- **Stores:** `packages/app/src/stores/{calendarStore,invitationsStore,bookingStore}.ts`
- **UI:** `packages/app/src/pages/CalendarPage.tsx`,
  `packages/app/src/components/calendar/*`
- **Tools:** `packages/agent/src/tools/calendar.ts` (19 tools)

## III.1 Event kinds (`calendar/types.ts` → `CALENDAR_KINDS`)

| Kind              | Name                                  | Notes                                                                                                                  |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **31923**         | `publicEvent`                         | Public time-based event (param-replaceable, `d`=eventId).                                                              |
| **32678**         | `privateEvent`                        | Private event; content encrypted to a per-event view key. Recurrence = rrule rows inside the payload (upstream model). |
| **32679**         | `privateRecurring`                    | **Super-app legacy invention** — read-tolerated only, never published; upstream has no such kind.                      |
| **32123**         | `calendarList`                        | A calendar (collection of event refs).                                                                                 |
| **1052 / 52**     | invitation `giftWrap` / `rumor`       | NIP-59 wrap carrying the event coordinate + view key. Published to the **participant's NIP-65 relays**.                |
| **31925 / 32069** | `publicRsvp` / `privateRsvp`          | RSVP responses.                                                                                                        |
| **1055 / 55**     | RSVP `giftWrap` / `rumor`             | Private RSVP delivery (**super-app-only fallback** when no viewKey is in scope; upstream never reads it).              |
| **84**            | `participantRemoval`                  | Invitation opt-out; published on dismiss, honored by the core EventStore and the invitation loaders.                   |
| **31926**         | `publicBusyList`                      | Public free/busy list, one per (user, `YYYY-MM` month); feeds booking-page availability.                               |
| **31927**         | `schedulingPage`                      | Calendly-style booking link.                                                                                           |
| **32680**         | `schedulingPagesList`                 | Index of scheduling pages.                                                                                             |
| **1057 / 57**     | booking request `giftWrap` / `rumor`  | Inbound booking requests.                                                                                              |
| **1058 / 58**     | booking response `giftWrap` / `rumor` | Approve/decline responses.                                                                                             |

## III.2 Public events (kind 31923)

`publishPublicCalendarEvent` (`service.ts:24`) writes tags: `["d", id]`,
`["title"]`, `["description"]`, `["start"]`/`["end"]` (unix seconds), optional
`["location"]`, `["r", website]`, `["image"]`, `["t", category]*`, `["p", participant]*`,
`["start_tzid"]`/`["end_tzid"]` (IANA), and recurrence as the **NIP-32 label pair**
`["L","rrule"]` + `["l", RRULE]`, plus `["form", naddr]` to attach a Formstr
registration form. `content` is empty (the parser falls back to `content` for
description on public events only — upstream puts it there and writes
`["name", title]`; the parser accepts both `name`/`title`).

> Upstream-divergence note: upstream writes **no** rrule/tzid/`t`/`r` tags on public
> events (its public-event recurrence/timezone support is effectively a super-app
> extension); its parser still reads the `L`/`l` pair, so the extension is harmless
> there. Upstream also has a known bug pushing locations as `["image", loc]`.

## III.3 Private events & the view-key model (`viewKey.ts`)

Each **private** event mints a per-event **view key** (`generateViewKey()` → an `nsec`).
The event payload — upstream `preparePrivateCalendarEvent` row parity: numeric
`start`/`end` (unix seconds), an inner `["d", id]`, the **creator's own `["p"]` row
before the participants'**, optional `["notification", pref]` and
`["form", naddr, formViewKey?]` (the 3rd element is the registration form's read-only
view key, never its signing key) — is JSON-encoded and **self-encrypted under the view
key** (`encryptWithViewKey` = `nip44SelfEncrypt` with a `LocalSigner(viewKey)`), stored
in `content`; the on-wire tags are just `[["d", id]]` (`publishPrivateCalendarEvent`).

- The inner `["d", id]` is **critical interop**: `calendar.formstr.app`'s
  `viewPrivateEvent` replaces the event's tags with the decrypted array and reads the id
  from that `d` row — without it every super-app private event collapses under id `""`
  upstream.
- Anyone holding the view-key `nsec` decrypts (self-encryption under a shared key), which
  is what makes private events shareable with invitees — unlike author-only
  self-encryption.
- **Invitations:** for each participant, a NIP-59 gift wrap (`wrapEvent`, wrap kind
  **1052**, rumor kind **52**) carries `["a", coordinate, relayHint]` +
  `["viewKey", nsec]`. Each wrap is published to the **participant's NIP-65 relay
  list** (`fetchRelayListsForPubkeys`, batch kind-10002 lookup; fallback module
  relays), and the inbox side (`invitationsStore` / `fetchInvitationsSync`) reads from
  the module relays ∪ the user's own NIP-65 read relays
  (`getInvitationInboxRelays`). `parseCalendarEvent` prefers a supplied view key,
  falling back to author self-decrypt for legacy events.

## III.4 Calendar lists (kind 32123) & event refs

`calendarListCodec.ts` encodes/decodes a `CalendarList` (title, description, color,
`eventRefs`, and upstream's `["notifications","disabled"]` preference row, which
round-trips through super-app edits). Each event ref is `[coordinate, relayHint, viewKey]`
(`viewKey.ts: buildEventRef/parseEventRef`), so a shared calendar carries the per-event
view keys inline — letting members decrypt private events authored by others.
`fetchCalendarEventsForUser` (`service.ts:322`) merges two sources: **direct** (public +
private by author) and **referenced** (private events from the lists' `eventRefs`, using
their embedded view keys).

## III.5 RSVP (`rsvp.ts`)

`rsvpToEvent` publishes a `publicRsvp` (31925) or, for private events with a
`viewKey`, a `privateRsvp` (32069, payload NIP-44-encrypted with the event viewKey,
deterministic `d` = sha256(responder:author:eventId)[:30]) — the wire
calendar.formstr.app reads. Private events **without** a viewKey fall back to a
super-app-only gift wrap (1055 / rumor 55) that upstream never reads; the MCP
`rsvp_event` tool therefore auto-discovers the viewKey from the user's calendar lists
(`lookupEventViewKey`). An RSVP carries the status
(`accepted`/`declined`/`tentative`/`pending`), and optionally a **counter-proposal**
(`suggestedStart`/`suggestedEnd`) and a free-text `comment`. `fetchRsvpsForEvent`
aggregates responses; `extractInvitationFromWrap` turns an inbound gift wrap into an
`InvitationRumor`.

**Participant removal (kind 84):** dismissing an invitation publishes a kind-84 event
e-tagging the wrap id (`publishParticipantRemovalEvent`, same tag shape as a NIP-09
deletion). The user's own 84s are fetched at invitation-load time
(`fetchParticipantRemovals`) so dismissals stick across sessions, and the core
`EventStore` honors inbound 84s (participant `p`-tag check,
ignoredEventIds/Coordinates) — matching upstream.

## III.6 Appointment scheduling (`booking.ts`)

Calendly-style flow: `schedulingPage` (31927) with an index list (32680);
`bookingLinkUrl` builds the shareable link. Inbound `BookingRequest`s arrive as gift
wraps (1057 / rumor 57); `approveBookingRequest`/`declineBookingRequest` reply via
booking responses (1058 / rumor 58). `fetchSchedulingPages` / `fetchBookingRequests`
power the booking inbox.

**Availability — public busy lists (kind 31926, `busyList.ts`):** one
parameterized-replaceable event per (user, `YYYY-MM`) with `["d", month]`,
`["t", month]`, `["t","busy"]` and repeatable `["block", startSec, endSec]` rows
(empty content — no titles leak). The hosted BookingPage greys out slots from these.
`addBusyRange`/`removeBusyRange` republish each touched month (idempotent, exact-pair
matching); `approveBookingRequest` always publishes the approved slot, and
`calendarStore` maintains ranges on event create/update/delete (recurring events are
skipped — busy lists store only raw ranges, as upstream).

## III.7 Recurrence

Stored as an RFC-5545 `RRULE` under the NIP-32 `["L","rrule"]` + `["l", RRULE]` label
pair. `parseCalendarEvent` reads three shapes for back-compat: the standalone's 2-element
`["l", RRULE]` after an `["L","rrule"]`, the super-app's historical 3-element
`["l", RRULE, "rrule"]`, and a legacy `["rrule", RRULE]`. Expansion uses the `rrule`
library (`packages/app/src/lib/rrule.ts`); `RepeatingFrequency` is the UI-level enum.

## III.8 Delete-that-sticks

`fetchDeletions(relays, authors)` (`service.ts:273`) collects kind-5 events and indexes
tombstones by coordinate (`a`, newest `created_at` wins, **same-author forgery guard**)
and by `pubkey:eventId` (`e`). `isEventDeleted` is applied **on load** in the fetch
paths, because relays keep serving addressable events after a NIP-09 request and a plain
author re-query would resurrect them.

> Sync note: `fetchCalendarEventsForUser` intentionally uses **no `created_at` window**
> for the direct author query — relays filter `since`/`until` by publish time, not the
> event's `start`, so a month-coupled window silently dropped cross-app events (the
> "doesn't sync" bug). Views filter by event date client-side.

## III.9 Service API & app layer

Service: `publishPublicCalendarEvent`/`publishPrivateCalendarEvent`,
`subscribeToCalendarEvents`/`fetchCalendarEventsSync`/`fetchCalendarEventsForUser`,
`fetchCalendarEventByCoordinate`, `createCalendarList`/`updateCalendarList`/
`fetchCalendarLists`/`deleteCalendarList`, `addEventToCalendarList`/
`removeEventFromCalendarList`/`moveEventBetweenCalendarLists`, `deleteCalendarEvent`,
`parseCalendarEvent`, `fetchInvitationsSync`; plus `rsvp.ts` and `booking.ts` exports.

App: `calendarStore` (events, lists, CRUD), `invitationsStore` (live NIP-59 invitation
subscription), `bookingStore` (scheduling pages + requests). UI under
`components/calendar/*` (`CalendarMonthView`, `CalendarListView`, `EventDialog`,
`EventDetailsDialog`, `RSVPBar`, `RecurrenceField`, `InvitationsView`, `BookingsView`,
`CalendarManageDialog`, …); `/calendar` is full-bleed.

## III.10 Tool surface (`tools/calendar.ts`, 19 tools)

Read/create: `list_calendar_events`, `get_calendar_event`, `create_calendar_event`,
`list_calendars`, `create_calendar`, `fetch_event_rsvps`, `list_invitations`,
`list_scheduling_pages`, `list_booking_requests`, `update_calendar`,
`add_event_to_calendar`, `remove_event_from_calendar`, `approve_booking`,
`decline_booking`.

Gated (`write: true`, require `confirm`): `delete_calendar_event`,
`update_calendar_event`, `attach_form_to_event`, `rsvp_event`, `delete_calendar`. (See
`GATED_TOOLS` in `agent/src/safety.ts`.)

## III.11 Critical points

- The inner `["d", id]` inside encrypted private-event content, the `[coordinate,
relayHint, viewKey]` ref shape, and the NIP-32 rrule label pair are all **exact
  upstream wire requirements** — deviating breaks `calendar.formstr.app` sync.
- View keys are the unit of private-event access control: they ride in calendar-list
  refs and invitation wraps; possession = decryption.
- Deletions are applied at fetch time (no server-side enforcement); the same-author
  guard prevents deletion forgery.

---

# Part IV — Pages module

Private Markdown documents (the standalone `nostr-docs` / pages.formstr.app): an
encrypted personal notebook with per-document share links (view-only or editable),
private labels/tags, renames, and encrypted inline comments.

- **Service:** `packages/agent/src/services/pages/{service.ts, comments.ts, viewKey.ts,
types.ts}`
- **Store:** `packages/app/src/stores/pagesStore.ts`
- **UI:** `packages/app/src/pages/PagesPage.tsx`, `packages/app/src/components/pages/*`
  (TipTap rich editor + Markdown bridge)
- **Tools:** `packages/agent/src/tools/pages.ts` (12 tools)

## IV.1 Event kinds (`pages/types.ts` → `PAGES_KINDS`)

| Kind      | Name               | Notes                                                                                                                                            |
| --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **33457** | `document`         | The full Markdown file, encrypted into `content`; param-replaceable, `d` = 6-char docId. The ONLY on-wire tag is `["d"]` — no plaintext title.   |
| **34579** | `docMetadata`      | Private per-doc metadata, `d` = the doc **address** (`33457:pubkey:dtag`), NIP-44 self-encrypted JSON. Doubles as the shared-docs index (below). |
| **1494**  | `comment`          | Encrypted inline comment/suggestion anchored to a doc (non-replaceable).                                                                         |
| **22457** | `crdtOp`           | Declared upstream and here; unused by both (ephemeral Yjs experiments).                                                                          |
| 11234     | legacy shared list | **Super-app legacy invention** — read-only migration source; upstream never had it.                                                              |
| 5         | deletion           | `a` + `k` + one `e` per known version id (upstream `deleteEvent`).                                                                               |

## IV.2 Document encryption model (`viewKey.ts`)

Two encryption modes, exactly the standalone's `encryptContent(content, viewKey?)`:

- **Personal docs:** owner **NIP-44 self-encryption** (`nip44SelfEncrypt(ownerSigner, md)`).
- **Shared docs:** NIP-44 **self-conversation under a random 32-byte viewKey**
  (`getConversationKey(viewKey, pubkey(viewKey))`) — anyone holding the viewKey hex
  decrypts. The title is the decrypted first Markdown line (no metadata leaks).

Share links carry the keys only in the URL hash: `/pages/<naddr>#<nkeys>` with
`{viewKey, editKey?}` (core `nkeys` TLV — upstream-compatible, §8). An **editable**
share is re-signed with a second random **editKey**: the shared copy lives at
`33457:editKeyPub:dtag`, and anyone with the editKey can replace it (recipients sign
with it; no Nostr identity needed).

## IV.3 Doc metadata & the shared-docs index (kind 34579)

`DocMetadata` is the exact upstream shape: `{tags?, title?, viewKey?, editKey?,
sharedAs?, …unknown keys preserved}` — one NIP-44 self-encrypted JSON object per doc
address. **Every write is read-merge-write** (`saveDocMetadata`): a tags edit must
never clobber the `viewKey` that grants access to a shared doc.

This one kind carries four features:

- **tags** — private labels (`fetchDocTags`/`setDocTags`).
- **title** — custom rename (`setDocTitle`; blank clears, falling back to first-line).
- **viewKey/editKey — the shared-with-me index** (upstream `SharedDocsContext`):
  every metadata entry carrying a `viewKey` IS a shared/received doc.
  `fetchSharedList` returns `[address, viewKey, editKey?]` tuples from metadata;
  legacy kind-11234 entries are merged read-only and migrated best-effort. Opening a
  share link records the grant here (`addSharedPage`), so shares roam across devices
  and to/from pages.formstr.app.
- **sharedAs** — back-pointer from the original doc to its editKey-signed shared copy.
  After an edit-share the original becomes a read-only backup; a later edit-re-share
  returns the existing link **without republishing** (republishing would stomp
  collaborator edits made through the live link — upstream ShareModal rule).

## IV.4 Sharing flow (`sharePage`)

Mirrors upstream `handleGeneratePrivateLink` + post-share bookkeeping: mint (or reuse)
viewKey (+ editKey iff `canEdit`) → re-encrypt the Markdown under the viewKey →
sign with the editKey (else owner) → publish → record `{viewKey, editKey}` in the new
address's metadata → for an owner's edit-share, set `sharedAs` on the original.
`fetchMyPages` surfaces metadata title/viewKey/sharedAs; `fetchPage` falls back to a
metadata-stored viewKey when owner self-decrypt fails. Inbound links are opened by
`pagesStore.openSharedLink(naddr, hash)` (wired to the `/pages/*` route splat).

## IV.5 Comments (kind 1494, `comments.ts`)

Exact upstream `nostr/comments.ts` wire: tags `["a", docAddress]`, `["e", docEventId]`,
`["p", docOwner]`; `content` = NIP-44 (viewKey self-conversation) ciphertext of a flat
inner tag array `[["content", text], ["type", "comment"|"suggestion"],
["quote", anchorText]?, ["context", prefix, suffix]?]`. Signed by the commenter's real
key — anchoring is public, the body is viewKey-gated. `publishPageComment` /
`fetchPageComments` (oldest-first) / `parsePageComment`.

## IV.6 Tool surface (`tools/pages.ts`, 12 tools)

Read/create: `list_pages`, `get_page`, `list_shared_pages`, `get_page_tags`,
`list_page_comments`, `create_page`, `save_private_note`, `update_page`,
`set_page_tags`. Gated: `delete_page`, `share_page`, `add_page_comment`.

## IV.7 Critical points

- The kind-34579 metadata object is **shared mutable state across apps** — any writer
  that doesn't read-merge-write destroys upstream-recorded keys (`viewKey` loss =
  permanent loss of access to the shared copy).
- A doc with `sharedAs` set must not be edited/republished from local state; the live
  copy is the shared address.
- The viewKey travels only in URL fragments and inside self-encrypted metadata —
  never in plaintext on relays.

---

# Part V — Polls module

NIP-88-style public polls (the standalone `nostr-polls` / pollerama.fun): single- or
multiple-choice, optional expiry and proof-of-work gate, live tallies.

- **Service:** `packages/agent/src/services/polls/{service.ts, pow.ts, types.ts}`
- **Store:** `packages/app/src/stores/pollsStore.ts`
- **UI:** `packages/app/src/pages/PollsPage.tsx`, `packages/app/src/components/polls/*`
- **Tools:** `packages/agent/src/tools/polls.ts` (8 tools)

## V.1 Event kinds (`polls/types.ts` → `POLLS_KINDS`)

| Kind     | Name             | Notes                                                             |
| -------- | ---------------- | ----------------------------------------------------------------- |
| **1068** | `poll`           | Regular event; question in `content`.                             |
| **1018** | `response`       | A vote.                                                           |
| 1070     | `responseLegacy` | Read-only legacy vote kind (upstream still queries both).         |
| 34259    | `rating`         | Upstream's ratings/reviews kind — declared, not implemented here. |
| 5        | deletion         | Poll deletion + vote retraction (`clearMyVotes`).                 |

## V.2 Poll event (kind 1068)

`createPoll` writes: `["option", id, label]` per option (ids are short random strings),
`["relay", url]` per module relay (upstream uses the author's relays — votes are
published/read from these ∪ defaults), `["t", hashtag]*`, `["polltype",
"singlechoice"|"multiplechoice"]`, `["endsAt", unixSec]?`, and parses (never writes)
`["PoW", difficulty]`. The parser also accepts the legacy `["label"]` question tag.

## V.3 Votes (kind 1018) & PoW (`pow.ts`)

A vote: `["e", pollId]`, `["p", pollAuthor]`, one `["response", optionId]` per
selection (single-choice = one row), empty content. Published to the poll's `relay`
tags ∪ module relays.

**PoW-gated polls** (poll has `["PoW", d]`): the vote must be NIP-13-mined.
`minePollEvent` (a port of upstream `mining-worker.ts`) appends `["nonce", count, d]`
**and the query tag `["W", d]`**, then grinds the nonce (re-anchoring `created_at`
each second) until `getPow(id) ≥ d`. Upstream discovers votes with an `#W=[d]` filter
and drops under-target ids — an unmined vote is invisible there. `submitPollResponse`
mines automatically when callers pass `poll.powDifficulty`.

## V.4 Tally (`fetchPollResults`)

Query kinds `[1018, 1070]` `#e`=poll.id on the poll's relays ∪ defaults, bounded by
`until: endsAt`, plus `#W` when PoW. Then: drop NIP-09-cleared votes (same-author
guard), drop under-target PoW ids, keep each voter's **latest** response by
`created_at`, count each (voter, option) once, percentage = option count / Σ all
counts (matches upstream, so multiple-choice bars render identically).
`totalVotes` = number of distinct voters.

## V.5 Critical points

- A vote on a PoW poll without nonce+`W` tags is silently invisible upstream — both
  the mine-side and the tally-side gates matter.
- Vote retraction is NIP-09 over the voter's own response events; "latest wins" makes
  re-votes supersede without deletion.

---

# Part VI — Drive module

Encrypted file storage (the standalone `formstr-drive` / drive.formstr.app): blobs on
Blossom servers, a private per-file metadata index on relays.

- **Service:** `packages/agent/src/services/drive/{service.ts, types.ts}`
- **Store:** `packages/app/src/stores/driveStore.ts`
- **UI:** `packages/app/src/pages/DrivePage.tsx`, `packages/app/src/components/drive/*`
- **Tools:** `packages/agent/src/tools/drive.ts` (5 tools)

## VI.1 Wire model

One kind — **34578** `fileMetadata` (param-replaceable, `d` = the blob's SHA-256):
tags `["d", hash]`, `["client", "formstr-drive"]`, `["encrypted", "nip44"]`;
`content` = NIP-44 self-encrypted `FileMetadata` JSON: `{name, hash, size, type,
folder, uploadedAt, server, encryptionKey, encryptionAlgorithm: "aes-gcm",
previewHash?, deleted?}`. Kind **36363** events are read for Blossom server discovery.

- **Per-file encryption:** a fresh nostr keypair per file; conversation key =
  self-conversation of that key; AES-GCM over the base64 plaintext (core `aesGcm.ts`,
  byte-for-byte standalone parity, §8). The hex secret lives only inside the
  self-encrypted metadata.
- **Previews:** image uploads also publish a downscaled webp thumbnail (≤300px,
  q0.7 — `app/src/lib/imagePreview.ts`), encrypted with the **same** per-file key
  (core `encryptFileWithExistingKey`) and uploaded to the same server; its hash is
  `previewHash` (what drive.formstr.app renders as the card thumbnail).
  `downloadPreview` reads them back. Video/PDF thumbnails are upstream-only for now.
- **Soft delete:** republish the same `d` with `deleted: true` (no kind-5 — upstream
  semantics); reads keep only the newest event per hash, so a stale non-deleted event
  can't resurrect a deleted file.
- **Folders** are virtual paths inside metadata (`/work/docs`); custom empty folders
  are device-local (localStorage) in both apps.

## VI.2 Blossom

Uploads/downloads via core `BlossomClient` (BUD-02/03/04) with kind-24242 auth
events. `DEFAULT_BLOSSOM_SERVERS` = upstream's list in the same order
(`nostr.download`, `blossom.primal.net`, `blossom.oxtr.dev` — the first entry is the
default upload target), extended by user-added servers and kind-36363 discovery.

## VI.3 Critical points

- `encryptionKey` in metadata is the only copy of the file key — losing the kind-34578
  event (or the identity key that decrypts it) orphans the blob.
- Every metadata rewrite re-publishes the FULL object (rename/move/delete are
  read-modify-write through `saveFileMetadata`, which also backfills
  `encryptionAlgorithm` on legacy entries).

---

_Part VII (AI/MCP) follows as it is written._
