# `@formstr/mcp` v2 — Production-Ready, Secure Login, Full Forms Surface

**Status:** Design / decisions (pre-implementation)
**Date:** 2026-06-03
**Branch:** `feat/formstr-mcp-server`
**Sequel to:** [`2026-06-03-formstr-mcp-server-design.md`](./2026-06-03-formstr-mcp-server-design.md) (v1 blueprint)
**Forms context:** [`2026-05-30-forms-parity-gaps.md`](./2026-05-30-forms-parity-gaps.md)

---

## 0. Context

v1 shipped a working stdio MCP server: a thin adapter over `@formstr/app/services` + `@formstr/core`, with read/create tools always on and destructive/outward tools gated behind `--allow-writes` + `confirm:true`. v1 explicitly **deferred** three things this version delivers:

1. **Key custody beyond plaintext nsec** — v1 took the `nsec` from env/CLI/config; NIP-46 and a browser login bridge were "interfaces left open."
2. **Forms `update` / `share` / `import`** — v1 marked these deferred because the service layer lacked them (the app's `actionDispatcher.ts` is a `@ts-nocheck` stub; the store/service have no `updateForm`/`shareForm`/`importForm`/`fetchFormSummaryFromRef`).
3. **Polished, agent-usable tool output** — tools return a one-line `message` + `structuredContent`; many hosts drop `structuredContent`, so the agent often receives only `"You have 3 form(s)."` with no ids/data to act on — the "empty JSON" symptom.

v2 makes the server **production-ready** (npm-published, hardened), introduces a **secure login flow** (OS keychain + NIP-46), and completes the **forms feature surface** (the only fully-implemented module), improving the existing forms tools along the way. Other modules (calendar/pages/polls/drive) are untouched beyond the shared output rework — no regressions, not the focus.

## 1. Decisions

| #   | Decision              | Choice                                                                                                                                                     |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Sign-in & key storage | **Local login page + OS keychain.** `formstr-mcp login` opens a localhost page mirroring the super-app login (nsec / guest / connect). Key → keychain.     |
| D2  | Extension sign-in     | **NIP-46 remote signer in v2.** nsec/guest → keychain (local signing); extension/bunker → NIP-46 (session token in keychain, key never enters process).    |
| D3  | Forms scope           | **Full surface + polish.** Build `update_form`/`share_form`/`import_form_from_naddr` in the **shared service layer**; polish the 6 existing tools.         |
| D4  | Distribution          | **npm + npx.** Self-contained CJS bundle; native keychain dep stays external. stdio transport (HTTP/DXT deferred).                                         |
| D5  | Headless path         | **Keep, warn loudly.** `--nsec`/`FORMSTR_NSEC`/`config.json` still work for CI/Docker but emit a prominent startup warning; login flow is the default.     |
| D6  | Code locality         | New service functions in `packages/app/src/services/forms/service.ts` (shared, headless-testable); NIP-46 signer in `@formstr/core`. All on the v2 branch. |

## 2. Architecture & file map

```
packages/core/src/signer/
  NIP46Signer.ts        # NEW — wraps nostr-tools BunkerSigner; implements NostrSigner
  SignerManager.ts      # +loginWithNip46(token) and the nip46 restore case
  types.ts              # SignerMethod already includes "nip46"

packages/app/src/services/forms/
  service.ts            # NEW: updateForm, shareForm, importForm, fetchFormSummaryFromRef
  service.test.ts       # + unit tests for the three new functions

packages/mcp/src/
  index.ts              # entry: subcommand router (login/logout/whoami | run server)
  cli.ts                # NEW — arg parse for subcommands
  auth/
    keystore.ts         # NEW — keychain get/set/delete + encrypted-file fallback
    credential.ts       # NEW — Credential type + (de)serialize + zod schema
    login.ts            # NEW — orchestrates the login flow, writes keystore
    loginServer.ts      # NEW — localhost HTTP server + browser open + page serving
    page/               # NEW — static login page (html/css/js), mirrors super-app
  bootstrap.ts          # init signer from resolved credential (local | nip46)
  config.ts             # resolution precedence + loud plaintext warning
  result.ts             # reworked: readable text body + structuredContent + outputSchema
  tools/forms.ts        # polish 6 + add update_form/share_form/import_form_from_naddr
  README.md             # rewrite: login, tool catalog, host config, security
```

## 3. Auth & key storage

### 3.1 CLI surface

`formstr-mcp` (run server, default) · `formstr-mcp login` · `formstr-mcp logout` · `formstr-mcp whoami`. Implemented in `cli.ts`; `index.ts` dispatches on `argv[2]`.

### 3.2 Login flow (`login`)

1. Start an HTTP server on `127.0.0.1:<ephemeral>`, generate a random CSRF/session token, open the browser (`open`/`xdg-open`/`start`) to `http://127.0.0.1:<port>/?t=<token>`. Print the URL too (headless/SSH copy-paste).
2. Page (`auth/page/`) mirrors the super-app login choices:
   - **Paste nsec** → validate `nip19` decode client-side → POST hex secret + chosen relays to `/submit`.
   - **Generate guest** → `generateSecretKey()` in the page → POST hex secret.
   - **Connect extension / bunker (NIP-46)** → page requests a `nostrconnect://` URI from the server (`/nip46/start`), shows it as text + QR; server runs the NIP-46 handshake (Amber / nsec.app / nsecbunker / NIP-46-capable extension) and, on connect, the page polls `/nip46/status`.
3. Server validates the session token, builds a `Credential`, writes it to the keystore, returns a success page, then shuts down.

### 3.3 Credential model (`credential.ts`)

```ts
type Credential =
  | { method: "local"; pubkey: string; nsec: string } // hex secret stored
  | {
      method: "nip46";
      pubkey: string;
      clientSecretKey: string; // session token only
      remoteSignerPubkey: string;
      relays: string[];
    };
```

Stored as JSON. Service = `formstr-mcp`; account = `pubkey` (multi-identity); a `default` pointer records the active account. Zod-validated on read.

### 3.4 Keychain (`keystore.ts`)

`@napi-rs/keyring` (N-API, prebuilt binaries, **no node-gyp**) → macOS Keychain / Windows Credential Manager / Linux Secret Service. Interface: `get(account)`, `set(account, cred)`, `delete(account)`, `list()`, `getDefault()/setDefault()`.

**Fallback** (no Secret Service, e.g. headless Linux): AES-256-GCM encrypted file `~/.config/formstr-mcp/credentials.enc` (mode `0600`), key derived (scrypt) from `FORMSTR_MCP_PASSPHRASE`. If neither keychain nor passphrase is available, `login` explains the options and exits non-zero.

### 3.5 NIP-46 signer (`core/NIP46Signer.ts`)

Wrap nostr-tools' `BunkerSigner` (`nostr-tools/nip46`) behind the existing `NostrSigner` interface (`getPublicKey`, `signEvent`, `nip44Encrypt/Decrypt`, `encrypt/decrypt`). `SignerManager.loginWithNip46(cred)` constructs it from `{clientSecretKey, remoteSignerPubkey, relays}` and resolves the connection; restore reads the same from the keystore. (Exact nostr-tools nip46 API confirmed via Context7 at implementation time.)

### 3.6 Startup resolution (`config.ts` / `bootstrap.ts`)

Precedence: **plaintext** `--nsec` / `FORMSTR_NSEC` / `config.json` → **keychain** credential (active/`--account`) → else a friendly "run `formstr-mcp login`" message and clean exit. When the plaintext path is used, emit a **prominent multi-line stderr warning** (key visible to anyone reading host config; recommend `formstr-mcp login`). `bootstrap` then calls `loginWithNsec` or `loginWithNip46`. **No tool ever returns key material**; login happens out-of-band, so secrets never enter the chat transcript.

## 4. Forms service additions (`services/forms/service.ts`)

Reuses existing core primitives: `wrapEvent`/`wrapManyEvents` (NIP-59), `createRef`/`parseRef` (naddr), and `forms/keys.ts` (`encodeFormKeys`, `makeViewKeySigner`, `makeSigningKeySigner`).

- **`updateForm(params)`** — `{ formId, pubkey, name?, fields?, settings? }`. Fetch current kind-30168, merge changes, republish the replaceable event (same `d`-tag). Public forms: sign with the user key. Encrypted forms: re-encrypt fields to the view key and sign with the form signing key (looked up from the user's my-forms entry; fail clearly if not owner). Addresses parity gap "Missing #12 — No form editing."

- **`shareForm({ formId, formPubkey, recipients })`** — NIP-59 gift-wrap the form's **view key** (+ naddr) to each recipient hex pubkey via `wrapManyEvents`, publish kind-1059 to forms relays. Returns `{ published, failed }`. Restores the "Compat #3 / Missing #25 — collaborator gift-wrap" capability removed in week 3-4. View-key only (read access); never wraps the signing key.

- **`fetchFormSummaryFromRef(pubkey, identifier)` + `importForm(summary)`** — `import_form_from_naddr` parses `naddr1…` (via `parseRef`) / `pubkey:formId` / `kind:pubkey:formId`, fetches the template to build a `FormSummary`, and appends it to the user's kind-14083 list (reusing the existing append/`saveToMyForms` path).

Each new function gets unit tests mirroring `service.test.ts` (mocked `nostrRuntime`/signer).

## 5. MCP forms tool catalog

All tools return a readable text body **and** `structuredContent` (with a declared `outputSchema`). npub↔hex normalization on all pubkey inputs.

**Polished (already implemented):**

| Tool                           | v2 improvements                                                                                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_forms`                   | Add `responseCount`, `naddr`, `createdAt`; render a markdown table (id · name · enc · responses · naddr).                                                                                                                                                             |
| `get_form`                     | Render fields (label/type/required/options), settings, encryption + decrypt status; clear not-found / needs-viewKey text.                                                                                                                                             |
| `fetch_form_responses`         | Return **actual answers** mapped field-label→answer + responder npub (parity "Missing #14"); optional CSV in text body (parity "Missing #13").                                                                                                                        |
| `create_form`                  | Expose full field set the service already supports but the UI lacks — file/signature/grid/section, `validation`, `titleImageUrl`/`coverImageUrl`, `thankYouText`, `shareViewKey`; validate `type` against `AnswerType`; accept options as `string[]` or `{id,label}`. |
| `delete_form` (gated)          | Richer confirm message naming the form; unchanged gating.                                                                                                                                                                                                             |
| `submit_form_response` (gated) | Clearer per-answer echo; unchanged gating.                                                                                                                                                                                                                            |

**New:**

| Tool                     | Tier                                                         | Service call                                         |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| `update_form`            | gated                                                        | `forms.updateForm`                                   |
| `share_form`             | gated                                                        | `forms.shareForm`                                    |
| `import_form_from_naddr` | create (read+write to own list; not destructive — always on) | `forms.fetchFormSummaryFromRef` + `forms.importForm` |

## 6. Output / result rework (`result.ts`)

`ok(text, { structuredContent?, ... })` keeps `content:[{type:"text", text}]` but `text` is now a **complete, human/agent-readable rendering** (lists/tables) — not a bare summary. Tools that return structured data also declare an `outputSchema` so spec-compliant hosts validate `structuredContent`. `fail(message, { code? })` standardized for all error paths (not-found, no-signer, wrong-viewKey, relay-timeout, not-owner).

## 7. Distribution & packaging

- Drop `private:true`; `version` `2.0.0`; add `description`, `keywords`, `repository`, `homepage`, `license`, `engines` (`node>=20`), `prepublishOnly: build`.
- Keep the in-progress **CJS single-file bundle** (`tsup`, `format:["cjs"]`, `noExternal:[/^.*/]`) and the WebSocket-pool patch (needed for Node relay connections). **Exception:** `@napi-rs/keyring` stays in real `dependencies` + `files` (native `.node` can't be inlined; npm/npx installs it).
- Host config (`npx -y @formstr/mcp`) documented; after `formstr-mcp login`, no key in the config at all.

## 8. Security model

- Key material lives only in the keychain (or, for NIP-46, never in-process — only a session token). Encrypted-file fallback is `0600` + passphrase-derived.
- No tool returns secrets. Signing/view keys for **owned** forms surface only through explicit owner tools (`share_form` distributes view-key via gift-wrap; never raw in tool output).
- stderr-only logging — stdout is the stdio transport; a stray stdout write corrupts the protocol. Audit line per gated execution (kind + target).
- Plaintext env/CLI path retained but warns loudly (D5). `update_form`/`share_form`/`delete_form`/`submit_form_response` stay write-gated + `confirm:true`.

## 9. Production hardening

Input normalization (npub↔hex, relay URLs, field-type validation), per-call relay timeouts with explicit failure text, graceful messages for every failure path, README rewrite (login flow, full tool catalog, host snippets, security), and `engines`/version metadata.

## 10. Testing

- **Unit:** the 3 new forms service functions (mocked runtime/signer); `keystore` round-trip (mocked `@napi-rs/keyring` + encrypted-file fallback); `credential` zod (de)serialize; `config` resolution precedence + warning emission; `result` rendering.
- **NIP-46:** `NIP46Signer` against a mocked `BunkerSigner` (getPublicKey/signEvent/nip44 proxy).
- **Login:** happy-path drive of `loginServer` (POST nsec → keystore written) with a stubbed browser-open.
- **Smoke:** extend the existing stdio handshake test — assert the new tools appear/gate correctly under `--allow-writes`.
- Gate: `pnpm --filter @formstr/mcp typecheck && pnpm --filter @formstr/mcp test`, plus `@formstr/app` + `@formstr/core` typecheck/tests for the service + signer additions.

## 11. Build sequence

1. **Core:** `NIP46Signer` + `SignerManager.loginWithNip46` + restore case (+ tests).
2. **Service:** `updateForm`, `shareForm`, `fetchFormSummaryFromRef`/`importForm` (+ tests).
3. **MCP auth:** `credential` → `keystore` → `loginServer`/page → `login`/`logout`/`whoami` CLI → `bootstrap`/`config` resolution + warning.
4. **MCP forms:** `result.ts` rework → polish 6 → wire 3 new tools.
5. **Packaging + README + full test/typecheck sweep.**

## 12. Non-goals (v2)

- No HTTP/Streamable transport; no DXT/.mcpb installer (npm/npx only).
- No changes to calendar/pages/polls/drive tools beyond the shared `result` rework.
- No un-stubbing of the app's `actionDispatcher.ts` / app-side AI (separate track).
- No new Nostr kinds or wire-format changes.

## 13. Risks & open questions

- **`@napi-rs/keyring` + CJS bundle interplay** — keep it external; verify `npx` resolves the native dep on macOS/Win/Linux. Encrypted-file fallback covers Secret-Service-less hosts.
- **NIP-46 reliability** — relay round-trips can be slow/flaky; needs timeouts + clear retry messaging in `login` and at startup (resolve-on-demand vs. fail-fast — decided in plan).
- **`share_form` (NIP-59)** is the largest new piece; reuses core `wrapManyEvents` but needs careful recipient validation and partial-failure reporting.
- **Login page UX** is intentionally minimal (functional, not a design artifact); can be refined later with `frontend-design` if desired.
