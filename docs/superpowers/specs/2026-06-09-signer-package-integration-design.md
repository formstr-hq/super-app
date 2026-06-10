# Signer-package integration — adopt `@formstr/signer` as the super-app's identity layer

> Design spec. Date: 2026-06-09. Branch: `signer-package-integration` (off `ai-orchestration` HEAD, since the avatar menu in `layout/Header.tsx` is also touched by the open AI-orchestration PR #19). Replaces the super-app's bespoke web login/identity with the shared, published `@formstr/signer@0.1.0`. **MCP signer migration is a separate, later task — out of scope here.**

## 1. Goal

Replace the super-app's **custom web identity/login layer** with the common `@formstr/signer` package (published to npm yesterday as `@formstr/signer@0.1.0`; source at `formstr-hq/common-packages/packages/signer`, commit `507322e`), **only where it fits properly**. After analysis it fits well. The integration is scoped to the **app (browser)**; the `@formstr/core` `NostrSigner` runtime contract and the MCP are left intact.

## 2. Analysis — the two signers

### 2.1 `@formstr/signer` (the new package)

- Headless multi-account signer: `createSigner(config)` → `Signer`. Persistence via a pluggable `StorageAdapter` (sync `get/set/remove`; default `localStorage`-backed, Node-safe — returns null off-DOM).
- **Login methods:** `loginWithExtension()` (NIP-07), `loginWithBunkerUri(uri, opts)` + `loginWithNostrConnect({relays,onUri,...})` (NIP-46), `createAccount(passphrase)` + `loginWithNcryptsec(ncryptsec, passphrase)` (NIP-49), `loginWithAndroidSigner(opts)` (NIP-55, needs a Capacitor plugin).
- **Account API:** `listAccounts()`, `getActiveAccount()` (present even when locked), `getActiveSigner()` (the unlocked signer, or `null`), `switchAccount(pubkey)`, `logout(pubkey?)`, `onChange(cb)` (`login`/`switch`/`logout`).
- **`ActiveSigner` interface:** `getPublicKey()`, `signEvent(EventTemplate)→NostrEvent`, `nip04Encrypt/Decrypt`, `nip44Encrypt/Decrypt`. **No `getPrivateKey()`** — the central security invariant.
- **Security model:** identity nsec is **always** NIP-49-encrypted at rest; the decrypted key lives **in memory only** and is **lost on reload** — accounts re-hydrate **locked**, requiring re-auth (passphrase for ncryptsec, silent grant for extension, resume for nip46). NIP-46 client _session_ secret is stored plaintext on purpose (disposable, not the identity key).
- **Browser-safe:** `src/` has no Node-only imports (`grep` for `ws|fs|child_process|node:` → none); NIP-46 uses `nostr-tools`/`nostr-tools/nip46` (native `WebSocket`, optional injected `pool`); Capacitor is only an injected type in `nip55.ts` (never imported). Deps: `nostr-tools`, `qrcode`; optional peer `nostr-signer-capacitor-plugin`.
- **UI module** (`@formstr/signer/ui`): returns **vanilla HTML strings** + `attach*Listeners()`. Not used here (see §5).

### 2.2 The super-app's current signer

- `@formstr/core/signer`: `NostrSigner` interface (`getPublicKey`, `signEvent→VerifiedEvent`, optional `encrypt/decrypt` (NIP-04), optional `nip44Encrypt/Decrypt`); concrete `LocalSigner` (in-memory key, **exposes `getSecretKey()`**), `NIP07Signer`, `NIP46Signer` (wraps an injected bunker), `DeferredSigner` (instant cached pubkey, queues ops), `SignerManager` + `signerManager` singleton, `DriveSignerAdapter`, `SignerUnavailableError`.
- `SignerManager`: single-account; methods `loginWithNsec` / `loginWithNip07` / `loginWithNip46` / `createGuestAccount`; **two-phase restore** (instant `DeferredSigner(cachedPubkey)` → resolve real signer in background); persists `formstr:signer-method`, `formstr:pubkey`, and **`formstr:client-secret` (raw key, plaintext)** for local/guest.
- App: `stores/authStore.ts` (zustand mirror of `signerManager`), `components/LoginDialog.tsx` (Extension / Private-key / Guest — **no NIP-46/49/55 in the UI**), avatar menu in `layout/Header.tsx`.

### 2.3 Fit findings

- **All ~60 service call sites** consume the user signer uniformly via `signerManager.getSigner()` → the `NostrSigner` interface. `nip59` gift-wrap also works **purely through that interface** (`nip44*` + `signEvent` + an internally-generated ephemeral wrap key). **No service needs the user's raw key.**
- **`getSecretKey()` (user identity) is used in exactly one place:** `SignerManager.createGuestAccount` persisting the secret plaintext — the precise anti-pattern `@formstr/signer` removes. All other `LocalSigner` uses (`services/*/keys.ts`, `viewKey.ts`, `forms/service.ts`) operate on **app-generated ephemeral keys** the app already holds (form-signing keys, viewKeys) — unrelated to identity; **they stay as-is** on core's `LocalSigner`.
- Interface delta is tiny: NIP-04 is `nip04Encrypt/Decrypt` (package) vs `encrypt/decrypt` (ours); `signEvent` returns `NostrEvent` vs `VerifiedEvent`. A thin adapter closes both.
- **Constraint:** `signerManager` is a _shared_ singleton — the MCP feeds it (`loginWithNsec`/`loginWithNip46`) and reads it in Node, with its own `@napi-rs/keyring` keystore. MCP migration is out of scope, so core must not change behavior the MCP relies on.

**Conclusion: it fits.** The one real friction (local-key UX) is resolved by the locked decisions below.

## 3. Locked decisions

1. **Full adoption (NIP-49 + passphrase).** All identities go through `@formstr/signer`; local keys are ncryptsec (passphrase). No raw key persisted. After reload an account is shown but **locked** — the user unlocks (passphrase) before the first sign/own-content-decrypt. Strictly more secure; accepted UX change.
2. **Multi-account.** Expose add / switch / unlock / logout per account (the package provides this).
3. **App-scoped bridge (Approach B), not a core rewrite** (Approach A rejected — would drag a browser package into core/MCP and risk the out-of-scope MCP).
4. **Headless core + our React/MUI UI** (the package's vanilla-HTML `/ui` would clash with the monochrome lucide design system).
5. **Drop NIP-55 Android** (web app, no Capacitor).

## 4. Architecture

`@formstr/signer` is added **only to `packages/app`**. `@formstr/core`'s `NostrSigner` + `signerManager` remain the runtime "who is signing right now" contract that services and the MCP read — **structurally unchanged** except for one additive injection method. The app owns a `@formstr/signer` `Signer` instance, drives login/accounts/unlock, and **pushes the unlocked `ActiveSigner` (adapted) into `signerManager`** so every existing call site keeps working untouched.

```
@formstr/signer (browser identity: accounts, login, unlock, persistence)
        │  getActiveSigner(): ActiveSigner
        ▼  toNostrSigner() adapter
  signerManager (@formstr/core)  ← unchanged contract, +setActiveSigner()
        │  getSigner(): NostrSigner
        ▼
  services (forms/calendar/pages/polls/drive) + nip59 + DriveSignerAdapter   ← untouched
```

### 4.1 Components (each small, single-purpose)

- **`packages/app/src/auth/appSigner.ts`** — singleton `createSigner({ appName: "Formstr", appUrl: <origin>, appImage: <icon>, storageKeyPrefix: "formstr:signer:" })`. What it does: owns identity + persistence. Depends on: `@formstr/signer`.
- **`packages/app/src/auth/toNostrSigner.ts`** — `toNostrSigner(active: ActiveSigner): NostrSigner`. Maps `nip04Encrypt/Decrypt → encrypt/decrypt`, passes `nip44*`/`getPublicKey` through, and returns `signEvent` typed as `VerifiedEvent` (the package finalizes/relays a complete event; cast/verify at the boundary). Pure function — unit-tested.
- **`packages/core/src/signer/SignerManager.ts`** — **add** `setActiveSigner(signer: NostrSigner, method: SignerMethod, pubkey: string)`: sets signer+method+pubkey, persists method+pubkey (**not** any secret), notifies observers; and keep `logout()`. Existing `loginWithNsec`/`createGuestAccount`/`loginWithNip07`/`loginWithNip46` stay for the MCP; the **app stops calling** the first three. Optional: stop writing `formstr:client-secret` from app paths (app never calls those now).
- **`packages/app/src/stores/authStore.ts`** — rewritten. Owns the bridge wiring and the zustand UI state.

### 4.2 Boot / hydration / locked state (reuse `DeferredSigner`)

`authStore.init()`:

1. `appSigner` constructor hydrates accounts (locked).
2. If `appSigner.getActiveAccount()` exists → `signerManager.setActiveSigner(new DeferredSigner(account.pubkey), account.method, account.pubkey)` for **instant render + queued ops** (today's behavior).
3. **Background auto-unlock** by method: `extension` → `appSigner.loginWithExtension()` (usually silent); `nip46` → resume via `loginWithBunkerUri(account.nip46.uri, { clientSecretKey: hexToBytes(account.nip46.clientSecretKey) })`. On success → adapt `getActiveSigner()` → resolve the `DeferredSigner` (or `setActiveSigner` to replace). `ncryptsec` → **stays locked** (no auto-unlock possible).
4. Subscribe `appSigner.onChange()` → `login`/`switch` re-assert the active signer into `signerManager`; `logout` clears it (or switches to remaining active).

**Unlock-on-demand:** a locked `ncryptsec` account holds a `DeferredSigner`. The first write (or own-content read) calls `signerManager.getSigner()` → triggers the **unlock modal** (passphrase) → `appSigner.loginWithNcryptsec(account.ncryptsec, passphrase)` → resolve. This reuses the existing `registerLoginModal`/blocking-`getSigner` mechanism — "block on write" now means "unlock."

### 4.3 `SignerMethod` mapping

`@formstr/signer` `LoginMethod` (`extension|nip46|ncryptsec|android`) → core `SignerMethod` (`nip07|nip46|local|nip55|guest`): `extension→nip07`, `nip46→nip46`, `ncryptsec→local`. (`guest` is retired; `nip55`/`android` unused.)

## 5. UI

Keep React/MUI; use the headless core only.

- **`LoginDialog.tsx`** rebuilt with sections: **Browser Extension** (NIP-07, primary) · **New account** (passphrase → one-time ncryptsec backup panel: "save this; it's the only way back in") · **Import key** (nsec or ncryptsec + passphrase) · **Bunker URI** (NIP-46 paste) · **Remote signer (QR)** (nostrconnect — render the URI as a QR via `qrcode`, await pairing). Lucide icons, monochrome, no emoji.
- **Account switcher** in `layout/Header.tsx` avatar menu: active account; other accounts each with lock state + **Unlock**; **Add account** (→ LoginDialog); **Log out**. Mirrors `appSigner.listAccounts()`/`getActiveAccount()`.
- **`UnlockDialog`** — passphrase prompt for a locked ncryptsec account (used by the blocking `getSigner` path and the switcher).

## 6. Migration of existing sessions

One-time, in `authStore.init()`, before constructing state:

- Detect legacy `formstr:signer-method` + `formstr:client-secret`.
- `local`/`guest` with a stored secret → prompt **"Secure your existing key with a passphrase"**; NIP-49-encrypt the raw key (`encryptSecretKey`) → `loginWithNcryptsec` → then delete the plaintext keys. (Skippable → logs out, user re-imports.)
- `nip07` → no secret to migrate; user logs in via extension (auto-grant likely).
- Always clear legacy `formstr:client-secret` / `formstr:signer-method` / `formstr:pubkey` once migrated/handled.

## 7. Dependency / packaging

`pnpm --filter @formstr/app add @formstr/signer@^0.1.0`. Reuses existing `nostr-tools`/`qrcode`; the `nostr-signer-capacitor-plugin` peer is optional and intentionally unmet (web only). No change to `@formstr/core`/`@formstr/mcp` deps.

## 8. Testing (TDD; backend/logic only, per standing directive)

- `toNostrSigner` adapter — method-name mapping, signEvent typing, nip44/nip04 delegation (mock `ActiveSigner`).
- `SignerManager.setActiveSigner` — sets/persists/notifies; no secret persisted; integrates with `DeferredSigner` resolution.
- Boot auto-unlock logic — extension/nip46 resume paths, ncryptsec-stays-locked (mock `appSigner`).
- Migration function — local/guest→ncryptsec encrypt+import+cleanup; nip07 path; legacy-key clearing.
- No new frontend component tests (LoginDialog / switcher / UnlockDialog covered by typecheck + build + manual QA). Close with `pnpm -r test && pnpm -r typecheck && pnpm -r build`.

## 9. Out of scope (explicit)

- **MCP signer migration** — the planned **next** task, contingent on this landing well (user's words: "once we finish this, we will start same implementations for mcp too if this seems right to me"). The MCP keeps its `@napi-rs/keyring` keystore + `loginWithNsec`/`loginWithNip46` feeding of `signerManager` for now.
- NIP-55 Android; the package's vanilla-HTML `/ui`; real-time co-edit; NIP-65 per-user relays.

## 10. Risks / notes

- **UX shift:** ncryptsec users re-enter a passphrase after each reload to sign/read own encrypted content. Intended (the secure model). Extension/NIP-46 users are unaffected (silent grant / resume).
- **`signEvent` typing:** package returns `NostrEvent`; our interface wants `VerifiedEvent`. The adapter verifies/casts at the boundary.
- **Two `LocalSigner`s coexist:** core's (ephemeral app keys, has `getSecretKey`) and the package's (identity, no getter). Kept distinct on purpose — only the _identity_ path moves to the package.
- **Branch base:** built on `ai-orchestration` HEAD to avoid `Header.tsx` conflict with PR #19; PR base chosen later (likely `main` after #19 merges).
