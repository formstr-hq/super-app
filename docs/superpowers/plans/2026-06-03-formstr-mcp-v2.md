# Formstr MCP v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready `@formstr/mcp` v2 with secure login (OS keychain + NIP-46), the complete forms tool surface, agent-usable output, and npm distribution.

**Architecture:** Thin MCP adapter over shared `@formstr/app/services` + `@formstr/core`. New forms orchestration lives in the shared service layer; a new `NIP46Signer` lives in core; the MCP gains an `auth/` subtree (keychain + localhost login flow) and reworked result rendering. stdio transport, CJS single-file bundle, native keychain dep external.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `nostr-tools` (`^2.23.3`, incl. `/nip46`, `/pool`), `@formstr/core`, `zod`, `@napi-rs/keyring`, `qrcode`, `vitest`, `tsup`. Node ≥20.

**Spec:** [`2026-06-03-formstr-mcp-v2-design.md`](../specs/2026-06-03-formstr-mcp-v2-design.md)

**Conventions:** All work on `feat/formstr-mcp-server`. Commits use Conventional Commits, scope `(mcp)`, `(core)`, or `(app)`. **No `Co-Authored-By` trailer.** Run from repo root `super-app/`. Tests are vitest (`describe/it/expect`, `vi.mock`).

---

## File Structure

```
packages/core/src/signer/
  NIP46Signer.ts        # CREATE — wraps nostr-tools BunkerSigner; implements NostrSigner
  NIP46Signer.test.ts   # CREATE
  SignerManager.ts      # MODIFY — loginWithNip46() + nip46 restore case
  index.ts              # MODIFY — export NIP46Signer
packages/core/src/index.ts  # MODIFY — re-export NIP46Signer if barrel pattern requires

packages/app/src/services/forms/
  service.ts            # MODIFY — add updateForm, shareForm, fetchFormSummaryFromRef, importForm
  service.test.ts       # MODIFY — tests for the four additions

packages/mcp/src/
  index.ts              # MODIFY — subcommand router
  cli.ts                # CREATE — subcommand + flag parsing
  auth/
    credential.ts       # CREATE — Credential type, zod schema, (de)serialize
    credential.test.ts  # CREATE
    keystore.ts         # CREATE — keychain + encrypted-file fallback
    keystore.test.ts    # CREATE
    page.ts             # CREATE — login page HTML as a string (inlined for bundling)
    loginServer.ts      # CREATE — localhost HTTP server (serve page, accept submit, nip46 handshake)
    loginServer.test.ts # CREATE
    login.ts            # CREATE — orchestrates login/logout/whoami
    openBrowser.ts      # CREATE — cross-platform browser open (no dep)
  bootstrap.ts          # MODIFY — init signer from Credential (local | nip46)
  config.ts             # MODIFY — resolution precedence + loud plaintext warning
  config.test.ts        # CREATE (if absent) / MODIFY
  result.ts             # MODIFY — readable text body + structuredContent + outputSchema helper
  result.test.ts        # CREATE
  tools/shared.ts       # MODIFY — field-type validation, options normalization
  tools/forms.ts        # MODIFY — polish 6, add update/share/import tools
  index.test.ts (smoke) # MODIFY — assert new tools + gating
package.json            # MODIFY — v2 metadata, deps, publish config
README.md               # MODIFY — login flow, tool catalog, host config, security
```

> **Bundling note:** the login page is an inlined HTML **string** in `auth/page.ts` (not a static-asset dir) so the single-file CJS bundle needs no asset copying. `@napi-rs/keyring` stays **external** (native `.node`); everything else bundles.

---

## Phase 1 — Core: NIP-46 signer

### Task 1: `NIP46Signer` implements `NostrSigner`

**Files:**

- Create: `packages/core/src/signer/NIP46Signer.ts`
- Create: `packages/core/src/signer/NIP46Signer.test.ts`
- Modify: `packages/core/src/signer/index.ts` (add `export { NIP46Signer } from "./NIP46Signer";`)

**API confirmed via Context7** (`/nbd-wtf/nostr-tools`): `nostr-tools/nip46` exports `BunkerSigner`, `parseBunkerInput`, `createNostrConnectURI`. Instance methods: `getPublicKey()`, `signEvent(t)`, `nip04Encrypt/nip04Decrypt`, `nip44Encrypt/nip44Decrypt`, `connect()`, `close()`. Construction in `^2.23.x`: `new BunkerSigner(clientSecretKey: Uint8Array, bunkerPointer, { pool })` then `await connect()`. **At implementation, confirm the exact constructor/factory shape against the installed `nostr-tools` version** (the newer `BunkerSigner.fromBunker/fromURI` statics may not exist in 2.23.x; if not, use `new BunkerSigner(...)`).

- [ ] **Step 1: Write failing test** (`NIP46Signer.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { NIP46Signer } from "./NIP46Signer";

// Mock the underlying bunker so the test never touches relays.
const bunker = {
  getPublicKey: vi.fn().mockResolvedValue("pk_hex"),
  signEvent: vi.fn().mockResolvedValue({ id: "e1", sig: "s1", kind: 1 }),
  nip44Encrypt: vi.fn().mockResolvedValue("ct"),
  nip44Decrypt: vi.fn().mockResolvedValue("pt"),
  close: vi.fn().mockResolvedValue(undefined),
};

describe("NIP46Signer", () => {
  it("proxies getPublicKey/signEvent/nip44 to the bunker", async () => {
    const signer = new NIP46Signer(bunker as any);
    expect(await signer.getPublicKey()).toBe("pk_hex");
    const ev = await signer.signEvent({ kind: 1, created_at: 0, tags: [], content: "hi" });
    expect(ev.sig).toBe("s1");
    expect(await signer.nip44Encrypt("peer", "pt")).toBe("ct");
    expect(await signer.nip44Decrypt("peer", "ct")).toBe("pt");
    expect(bunker.signEvent).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @formstr/core test NIP46Signer` → fails (module not found).

- [ ] **Step 3: Implement** (`NIP46Signer.ts`)

```ts
import type { EventTemplate, VerifiedEvent } from "nostr-tools";
import type { NostrSigner } from "./types";

/** Minimal structural type of nostr-tools' BunkerSigner we depend on. */
export interface BunkerLike {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * NostrSigner backed by a NIP-46 remote signer (bunker). The private key never
 * enters this process — all signing/encryption is delegated over relays.
 */
export class NIP46Signer implements NostrSigner {
  constructor(private readonly bunker: BunkerLike) {}

  getPublicKey(): Promise<string> {
    return this.bunker.getPublicKey();
  }
  signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.bunker.signEvent(event);
  }
  encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.bunker.nip04Encrypt) throw new Error("Remote signer lacks nip04 encrypt");
    return this.bunker.nip04Encrypt(pubkey, plaintext);
  }
  decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.bunker.nip04Decrypt) throw new Error("Remote signer lacks nip04 decrypt");
    return this.bunker.nip04Decrypt(pubkey, ciphertext);
  }
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.bunker.nip44Encrypt) throw new Error("Remote signer lacks nip44 encrypt");
    return this.bunker.nip44Encrypt(pubkey, plaintext);
  }
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.bunker.nip44Decrypt) throw new Error("Remote signer lacks nip44 decrypt");
    return this.bunker.nip44Decrypt(pubkey, ciphertext);
  }
  close(): Promise<void> {
    return this.bunker.close();
  }
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @formstr/core test NIP46Signer`.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): NIP46Signer wrapping a NIP-46 bunker"`

### Task 2: `SignerManager.loginWithNip46` + restore

**Files:**

- Modify: `packages/core/src/signer/SignerManager.ts`
- Modify: `packages/core/src/signer/SignerManager.test.ts`

**Design:** Construction of the bunker (relays/pool) is environment-specific, so accept a **builder** rather than coupling SignerManager to `nostr-tools/pool` (keeps core headless-test-friendly). The MCP supplies the builder.

```ts
export interface Nip46Connection {
  clientSecretKey: string; // hex; persisted (this is the session token, NOT the user key)
  remoteSignerPubkey: string;
  relays: string[];
  secret?: string;
}
// builder returns a connected NostrSigner (e.g. new NIP46Signer(bunker))
type Nip46Builder = (conn: Nip46Connection) => Promise<NostrSigner>;
```

- [ ] **Step 1: Write failing test** — add to `SignerManager.test.ts`:

```ts
it("loginWithNip46 sets signer + pubkey + method from the builder", async () => {
  const mgr = new SignerManager();
  const fakeSigner = { getPublicKey: async () => "remotePk", signEvent: async () => ({}) } as any;
  await mgr.loginWithNip46(
    { clientSecretKey: "00".repeat(32), remoteSignerPubkey: "rs", relays: ["wss://r"] },
    async () => fakeSigner,
  );
  expect(mgr.getState().method).toBe("nip46");
  expect(mgr.getPublicKey()).toBe("remotePk");
  expect(mgr.getSignerIfAvailable()).toBe(fakeSigner);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — add to `SignerManager`:

```ts
async loginWithNip46(conn: Nip46Connection, build: Nip46Builder): Promise<void> {
  const signer = await build(conn);
  await this.setSigner(signer, "nip46");
}
```

(`setSigner` already sets pubkey/method/persist/notify. Import `Nip46Connection`/`Nip46Builder` types; export them from the module. The localStorage-backed `restore()` path stays browser-only; the MCP restores from its own keystore at bootstrap, so no change to `resolveSignerAsync` is required for v2 — leave the `nip46` branch in `restore()` as a documented no-op comment.)

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @formstr/core test SignerManager`.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): SignerManager.loginWithNip46 via injected builder"`

---

## Phase 2 — Shared forms service functions

All four are added to `packages/app/src/services/forms/service.ts`, reusing existing helpers already imported there (`signerManager`, `nostrRuntime`, `relayManager`, `nip44*`, `LocalSigner`, `wrapManyEvents` from core, `parseRef`/`createRef`, `encodeFormKeys`/`makeViewKeySigner`/`makeSigningKeySigner`, `FORM_KINDS`). Tests follow the existing `service.test.ts` style (mock `@formstr/core`'s `nostrRuntime`/`signerManager`).

### Task 3: `updateForm`

**Files:** Modify `service.ts` + `service.test.ts`.

**Behavior:** Re-publish the replaceable kind-30168 (same `d`-tag) with merged name/fields/settings. Public form → sign with the user signer. Encrypted form → re-encrypt fields to the form view key, sign with the form **signing key** (looked up from the user's my-forms summary; throw `"Not the form owner or signing key unavailable"` if absent).

```ts
export interface UpdateFormParams {
  formId: string;
  pubkey: string; // form author pubkey (user for public, signing pubkey for encrypted)
  name?: string;
  fields?: FormField[];
  settings?: FormSettings;
}

export async function updateForm(params: UpdateFormParams): Promise<void> {
  const relays = relayManager.getRelaysForModule("forms");
  const existing = await fetchForm(params.pubkey, params.formId); // current template (fields may be empty if encrypted)
  if (!existing) throw new Error(`Form not found: ${params.formId}`);

  const name = params.name ?? existing.name;
  const settings = { ...existing.settings, ...params.settings };
  const summary = (await fetchMyForms()).find(
    (f) => f.id === params.formId && f.pubkey === params.pubkey,
  );

  if (existing.isEncrypted) {
    if (!summary?.signingKey || !summary?.viewKey)
      throw new Error("Not the form owner or signing key unavailable");
    const fields = params.fields ?? existing.fields;
    const fieldTags = fields.map((f) => [
      "field",
      f.id,
      f.type,
      f.label,
      f.options ? JSON.stringify(f.options.map((o) => [o.id, o.label])) : "[]",
      JSON.stringify({ required: f.required, placeholder: f.placeholder }),
    ]);
    const formSigner = makeSigningKeySigner(summary.signingKey);
    const viewPubkey = getPublicKey(hexToBytes(summary.viewKey));
    const content = await formSigner.nip44Encrypt!(viewPubkey, JSON.stringify(fieldTags));
    const tags: string[][] = [
      ["d", params.formId],
      ["name", name],
      ["encryption", "view-key"],
    ];
    if (settings) tags.push(["settings", JSON.stringify(settings)]);
    const event = {
      kind: FORM_KINDS.template,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    };
    await nostrRuntime.publish(relays, finalizeEvent(event, hexToBytes(summary.signingKey)));
    return;
  }

  // Public form
  const signer = await signerManager.getSigner();
  const fields = params.fields ?? existing.fields;
  const tags: string[][] = [
    ["d", params.formId],
    ["name", name],
  ];
  if (settings) tags.push(["settings", JSON.stringify(settings)]);
  for (const f of fields) {
    const options = f.options ? JSON.stringify(f.options.map((o) => [o.id, o.label])) : "[]";
    tags.push([
      "field",
      f.id,
      f.type,
      f.label,
      options,
      JSON.stringify({ required: f.required, placeholder: f.placeholder }),
    ]);
  }
  if (settings.publicForm) tags.push(["t", "public"]);
  const event = {
    kind: FORM_KINDS.template,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  await nostrRuntime.publish(relays, await signer.signEvent(event));
}
```

(Import `hexToBytes` from `./keys`; `finalizeEvent`/`getPublicKey` already imported.)

- [ ] **Step 1: Failing test** — `updateForm` for a public form publishes a kind-30168 with the new name + field count. Mock `fetchForm` via the relay mock returning a public template; mock `fetchMyForms` to return `[]`; assert `nostrRuntime.publish` called with an event whose `name` tag = new name and field-tag count matches.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement (code above).**
- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @formstr/app test forms`.
- [ ] **Step 5: Commit** — `git commit -am "feat(app): forms.updateForm (republish kind-30168)"`

### Task 4: `shareForm` (NIP-59 collaborator gift-wrap)

**Files:** Modify `service.ts` + `service.test.ts`.

**Behavior:** Gift-wrap the form's **view key** (+ naddr) to each recipient hex pubkey using core `wrapManyEvents`, publish the kind-1059 wraps to forms relays. Returns `{ published, failed }`. View-key only — never the signing key. Throws `"Not the form owner or view key unavailable"` if the user lacks the view key.

```ts
export interface ShareFormParams {
  formId: string;
  formPubkey: string;
  recipients: string[];
}
export interface ShareFormResult {
  published: number;
  failed: string[];
}

export async function shareForm(params: ShareFormParams): Promise<ShareFormResult> {
  const relays = relayManager.getRelaysForModule("forms");
  const summary = (await fetchMyForms()).find(
    (f) => f.id === params.formId && f.pubkey === params.formPubkey,
  );
  if (!summary?.viewKey) throw new Error("Not the form owner or view key unavailable");

  const naddr = createRef("forms", FORM_KINDS.template, params.formPubkey, params.formId);
  const signer = await signerManager.getSigner();
  const rumor = {
    kind: FORM_KINDS.giftWrap === 1059 ? 14 : 14, // inner DM-style rumor carrying the key
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["a", `${FORM_KINDS.template}:${params.formPubkey}:${params.formId}`],
      ["viewKey", summary.viewKey],
    ],
    content: `Formstr view key for ${naddr}`,
  };
  const failed: string[] = [];
  let published = 0;
  for (const recipient of params.recipients) {
    try {
      const wraps = await wrapManyEvents(signer, rumor, [recipient]); // gift-wrap to one recipient
      for (const w of wraps) await nostrRuntime.publish(relays, w);
      published++;
    } catch {
      failed.push(recipient);
    }
  }
  return { published, failed };
}
```

(Import `wrapManyEvents`, `createRef` from `@formstr/core`. **At implementation, confirm `wrapManyEvents` signature** — `packages/core/src/crypto/nip59.ts` line 97 — and the inner rumor kind convention used elsewhere; adjust the rumor shape to match how the app/forms reads shared keys. If `wrapManyEvents` takes `(signer, rumor, recipients[])` returning wraps, the loop can pass all recipients at once; per-recipient loop is for partial-failure reporting.)

- [ ] **Step 1: Failing test** — mock `fetchMyForms` to return a summary with a `viewKey`; mock `wrapManyEvents` to return `[{ kind: 1059 }]`; assert `shareForm` returns `{ published: 2, failed: [] }` for two recipients and calls `nostrRuntime.publish` twice. Add a test: no `viewKey` → throws.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement (code above).**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(app): forms.shareForm (NIP-59 view-key gift-wrap)"`

### Task 5: `fetchFormSummaryFromRef` + `importForm`

**Files:** Modify `service.ts` + `service.test.ts`.

```ts
/** Resolve a public form by ref into a FormSummary (no keys — read-only import). */
export async function fetchFormSummaryFromRef(
  pubkey: string,
  formId: string,
): Promise<FormSummary | null> {
  const tpl = await fetchForm(pubkey, formId);
  if (!tpl) return null;
  return {
    id: tpl.id,
    name: tpl.name,
    pubkey: tpl.pubkey,
    createdAt: tpl.createdAt,
    isEncrypted: tpl.isEncrypted,
  };
}

/** Append an externally-discovered form to the user's kind-14083 list. */
export async function importForm(summary: FormSummary): Promise<void> {
  const current = await fetchMyForms();
  if (current.some((f) => f.id === summary.id && f.pubkey === summary.pubkey)) return;
  await saveToMyForms([...current, summary]);
}
```

The MCP tool parses the ref (`naddr1…` via `parseRef`, or `pubkey:formId` / `kind:pubkey:formId`) → `(pubkey, formId)` then calls these (parsing lives in the tool, Task 14).

- [ ] **Step 1: Failing test** — `importForm` on an empty list calls `saveToMyForms` with one entry; calling again with the same form is a no-op (dedup). `fetchFormSummaryFromRef` returns null when `fetchForm` returns null.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement (code above).**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(app): forms.fetchFormSummaryFromRef + importForm"`

---

## Phase 3 — MCP auth (keychain + login flow)

### Task 6: `credential.ts`

**Files:** Create `packages/mcp/src/auth/credential.ts` + `credential.test.ts`.

```ts
import { z } from "zod";

export const credentialSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("local"), pubkey: z.string(), nsec: z.string() }),
  z.object({
    method: z.literal("nip46"),
    pubkey: z.string(),
    clientSecretKey: z.string(),
    remoteSignerPubkey: z.string(),
    relays: z.array(z.string()),
    secret: z.string().optional(),
  }),
]);
export type Credential = z.infer<typeof credentialSchema>;

export function serializeCredential(c: Credential): string {
  return JSON.stringify(c);
}
export function parseCredential(raw: string): Credential {
  return credentialSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 1: Failing test** — round-trip a `local` and a `nip46` credential through serialize→parse; `parseCredential("{}")` throws.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @formstr/mcp test credential`.
- [ ] **Step 3: Implement (above).**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): credential model + zod schema"`

### Task 7: `keystore.ts` (keychain + encrypted-file fallback)

**Files:** Create `packages/mcp/src/auth/keystore.ts` + `keystore.test.ts`.

**Design:** Try `@napi-rs/keyring` (lazy `require` so a missing native binary degrades gracefully); on failure, fall back to AES-256-GCM file `~/.config/formstr-mcp/credentials.enc` (mode `0600`) keyed by scrypt(`FORMSTR_MCP_PASSPHRASE`). The keychain stores one JSON map `{ default: pubkey, accounts: { [pubkey]: Credential } }` under service `formstr-mcp`, account `store` (simplest portable shape).

```ts
import { Entry } from "@napi-rs/keyring"; // lazy-required at runtime
import { Credential, credentialSchema } from "./credential";

export interface Keystore {
  get(pubkey?: string): Promise<Credential | null>; // pubkey omitted → default
  set(cred: Credential, makeDefault?: boolean): Promise<void>;
  remove(pubkey: string): Promise<void>;
  list(): Promise<string[]>;
}
export function createKeystore(): Keystore {
  /* keychain-backed, file fallback */
}
```

Internals: a `StoreShape = { default?: string; accounts: Record<string, Credential> }` validated with zod; helper `loadStore()/saveStore(s)` switch between keychain Entry and encrypted file. AES-GCM helpers in the same file (`crypto.scryptSync`, `randomBytes(12)` IV, store `iv:tag:ciphertext` base64).

- [ ] **Step 1: Failing test** — force the file fallback (set `FORMSTR_MCP_PASSPHRASE`, point `HOME` at a tmp dir, stub keyring `require` to throw): `set` then `get` round-trips a credential; `list` returns the pubkey; `remove` deletes it; `get()` returns the default. Verify the file is mode `0600`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @formstr/mcp test keystore`.
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): keystore (keychain + encrypted-file fallback)"`

### Task 8: `openBrowser.ts` + `page.ts` + `loginServer.ts`

**Files:** Create `openBrowser.ts`, `page.ts`, `loginServer.ts` + `loginServer.test.ts`.

`openBrowser.ts`: `export function openBrowser(url: string): void` — spawn `open` (darwin) / `start` (win32) / `xdg-open` (linux) detached, swallow errors (URL is also printed).

`page.ts`: `export function loginPageHtml(opts: { token: string }): string` — returns a self-contained HTML page (inline CSS/JS) with three actions: paste nsec, generate guest (uses a tiny inlined nsec→hex via fetch to `/guest`), connect (NIP-46). JS posts `{ token, method, ... }` to `/submit` and, for nip46, calls `/nip46/start` then polls `/nip46/status`. Keep it minimal and dependency-free; QR rendered from a server-provided data URL (`qrcode`).

`loginServer.ts`:

```ts
export interface LoginResult {
  credential: Credential;
}
export interface LoginServerDeps {
  buildNip46?: (uri: string) => Promise<{ credential: Credential }>; // injected; runs the handshake
}
export async function runLoginServer(
  relays: string[] | undefined,
  deps?: LoginServerDeps,
): Promise<LoginResult>;
```

Starts `http.createServer` on `127.0.0.1:0`, generates a session token, resolves the promise with a `Credential` once `/submit` (nsec/guest) or the nip46 handshake completes, then closes. nsec/guest → derive pubkey (`getPublicKey`), build a `local` credential. Validates the token on every POST.

- [ ] **Step 1: Failing test** (`loginServer.test.ts`) — start the server with `vi`-stubbed `openBrowser`; grab the port; POST `{ token, method: "local", nsec }` to `/submit`; assert the returned `LoginResult.credential.method === "local"` and `pubkey` matches `getPublicKey(decode(nsec))`. POST with a wrong token → 403.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @formstr/mcp test loginServer`.
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): localhost login server + page + browser open"`

### Task 9: `login.ts` orchestration

**Files:** Create `packages/mcp/src/auth/login.ts`.

Wires keystore + loginServer + the NIP-46 builder (uses `nostr-tools/nip46` + `SimplePool` to run the handshake for the `connect` path) and core `NIP46Signer`:

```ts
export async function doLogin(relays?: string[]): Promise<Credential>; // run server, persist, return cred
export async function doLogout(pubkey?: string): Promise<void>; // keystore.remove (or clear default)
export async function whoami(): Promise<{ pubkey: string; method: string } | null>;
// Builds the nip46 NostrSigner from a stored Credential, used at bootstrap:
export async function buildNip46Signer(conn: Nip46Connection): Promise<NostrSigner>;
```

`buildNip46Signer`: create a `SimplePool` (with the `ws` impl already set in bootstrap), `parseBunkerInput` or reconstruct a pointer from `{remoteSignerPubkey, relays, secret}`, `new BunkerSigner(hexToBytes(clientSecretKey), pointer, { pool })`, `await connect()`, wrap in `new NIP46Signer(bunker)`.

- [ ] **Step 1: Implement** (orchestration; thin — covered indirectly by Task 8 + bootstrap tests). No new unit test required beyond a smoke import; rely on Task 10's bootstrap test.
- [ ] **Step 2: Typecheck** — `pnpm --filter @formstr/mcp typecheck`.
- [ ] **Step 3: Commit** — `git commit -am "feat(mcp): login/logout/whoami orchestration + nip46 builder"`

### Task 10: `cli.ts` + `index.ts` routing; `config.ts` + `bootstrap.ts`

**Files:** Create `cli.ts`; Modify `index.ts`, `config.ts`, `bootstrap.ts` + `config.test.ts`.

`cli.ts`: parse `argv` → `{ command: "run" | "login" | "logout" | "whoami"; nsec?; relays?; allowWrites; account? }`.

`index.ts`: dispatch — `login`→`doLogin`, `logout`→`doLogout`, `whoami`→print, default→resolve credential then start the stdio server.

`config.ts`: extend `resolveConfig` to return a discriminated source. New precedence:

1. plaintext `--nsec`/`FORMSTR_NSEC`/`config.json` → `{ source: "plaintext", nsec }` **and emit the loud warning** (Step 3 below).
2. else keystore `get(account)` → `{ source: "keystore", credential }`.
3. else throw a friendly error: `"No credentials. Run: formstr-mcp login"`.

Loud warning (stderr):

```
⚠️  Using a PLAINTEXT nsec from env/CLI/config. This key is readable by anyone
    who can read your MCP host config. For secure storage run:  formstr-mcp login
```

`bootstrap.ts`: accept the resolved credential; `local` → `loginWithNsec`; `nip46` → `signerManager.loginWithNip46(conn, buildNip46Signer)`. Keep the existing localStorage shim, ws impl, pool patch, relay override.

- [ ] **Step 1: Failing test** (`config.test.ts`) — with `--nsec` set, `resolveConfig` returns `source: "plaintext"` and a spy on `console.error`/stderr sees the warning; with no plaintext and a stubbed keystore returning a credential, returns `source: "keystore"`; with neither, throws the "Run: formstr-mcp login" error.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** cli/index/config/bootstrap.
- [ ] **Step 4: Run, expect PASS** + `pnpm --filter @formstr/mcp typecheck`.
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): subcommand CLI + credential resolution + warned plaintext path"`

---

## Phase 4 — MCP forms tools + result rework

### Task 11: `result.ts` rework

**Files:** Modify `result.ts` + Create `result.test.ts`.

Keep `ok`/`fail` signatures source-compatible but make the text body the primary, complete rendering. Add a `table` helper.

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured && { structuredContent: structured }),
  };
}
export function fail(message: string, code?: string): CallToolResult {
  return {
    content: [{ type: "text", text: code ? `${message} (${code})` : message }],
    isError: true,
  };
}
/** Render an array of records as a compact markdown table for the text body. */
export function table(rows: Record<string, unknown>[], cols: string[]): string {
  if (rows.length === 0) return "_(none)_";
  const head = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`).join("\n");
  return `${head}\n${body}`;
}
```

- [ ] **Step 1: Failing test** — `table([{id:"a",name:"x"}],["id","name"])` contains `| a | x |`; `table([], [...])` returns `_(none)_`; `fail("bad","E1")` has `isError:true` and text `bad (E1)`.
- [ ] **Step 2–4:** Run FAIL → implement → PASS (`pnpm --filter @formstr/mcp test result`).
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): result rendering (markdown table + coded failures)"`

### Task 12: Polish `list_forms`, `get_form`, `fetch_form_responses`

**Files:** Modify `tools/forms.ts`. Extend the smoke test only if tool I/O shape is asserted.

- `list_forms`: map to include `responseCount` (call `forms.fetchResponses` count per form is expensive — instead include `createdAt`, `isEncrypted`, and `naddr = createRef("forms", FORM_KINDS.template, f.pubkey, f.id)`; leave `responseCount` out unless the summary already carries it — `FormSummary.responseCount` is optional). Text body = `table(rows, ["id","name","isEncrypted","naddr"])`. structuredContent keeps the full array.
- `get_form`: text body lists each field as `- [type] label (required?)` plus settings + `isEncrypted`/`decryptError`. `fail("Form not found.", "NOT_FOUND")` else.
- `fetch_form_responses`: build `rows` of `{ responder: npubEncode(r.pubkey), createdAt, ...answers }`; render answers field-by-field; structuredContent keeps `{ count, responses }`. Include responder identity (parity Missing #14).

```ts
// list_forms body
import { createRef } from "@formstr/core";
const rows = list.map((f) => ({
  id: f.id,
  name: f.name,
  isEncrypted: String(f.isEncrypted),
  naddr: createRef("forms", FORM_KINDS.template, f.pubkey, f.id),
}));
return ok(
  `You have ${list.length} form(s).\n\n${table(rows, ["id", "name", "isEncrypted", "naddr"])}`,
  {
    forms: list.map((f) => ({
      id: f.id,
      name: f.name,
      pubkey: f.pubkey,
      isEncrypted: f.isEncrypted,
      createdAt: f.createdAt,
      naddr: createRef("forms", FORM_KINDS.template, f.pubkey, f.id),
    })),
  },
);
```

- [ ] **Step 1: Failing test** — extend smoke/forms test: a stubbed `forms.fetchMyForms` returns 2 forms; `list_forms` result `content[0].text` contains both names and a `naddr`. (Mock `@formstr/app/services`.)
- [ ] **Step 2–4:** FAIL → implement all three → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): readable output for list/get/responses tools"`

### Task 13: Polish `create_form` (full field set)

**Files:** Modify `tools/shared.ts` (`aiFieldsToFormFields`) + `tools/forms.ts`.

Extend the `fieldShape` zod to allow all `AnswerType` values, `validation`, `gridRows/gridCols`, `fileConfig`; accept `options` as `string[]` or `{id,label}[]`. Extend `aiFieldsToFormFields` to pass these through and validate `type` against the `AnswerType` enum (default `shortText` with a note in the response if an unknown type is coerced). Add `titleImageUrl`, `coverImageUrl`, `thankYouText`, `shareViewKey` to `create_form` inputs and into `settings`.

- [ ] **Step 1: Failing test** — `aiFieldsToFormFields([{label:"Pick",type:"radioButton",options:["a","b"]}])` yields one field with two `{id,label}` options and `type==="radioButton"`; a grid field keeps `gridRows`/`gridCols`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @formstr/mcp test`).
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): create_form exposes full field set + form settings"`

### Task 14: Add `update_form`, `share_form`, `import_form_from_naddr` tools

**Files:** Modify `tools/forms.ts`; extend smoke test.

- `update_form` (gated): inputs `{ formId, formPubkey, name?, description?, fields?, confirm? }` → `requireConfirm` → `forms.updateForm({ formId, pubkey: formPubkey, name, fields: fields && aiFieldsToFormFields(fields), settings: description?{description}:undefined })` → `ok("Updated form <id>.")`.
- `share_form` (gated): inputs `{ formId, formPubkey, recipients: string[], confirm? }` → normalize recipients (`normalizePubkeyList`) → `requireConfirm` → `forms.shareForm(...)` → `ok("Shared view key with N recipient(s).", { published, failed })`; `fail("No valid recipients.", "BAD_INPUT")` when empty.
- `import_form_from_naddr` (always on — only writes to your own list): inputs `{ ref }`. Parse: `ref.startsWith("naddr1")` → `parseRef` (assert `module === "forms"`); else split on `:` (2 → `pubkey:formId`, 3 → `kind:pubkey:formId`). Then `forms.fetchFormSummaryFromRef(pubkey, formId)` → if null `fail("Form not found on configured relays.", "NOT_FOUND")` → `forms.importForm(summary)` → `ok('Imported form "<name>".', { naddr })`.

(`update_form`/`share_form` register only when `ctx.allowWrites` — place inside the existing `if (!ctx.allowWrites) return;` block alongside `delete_form`/`submit_form_response`. `import_form_from_naddr` registers above that block.)

- [ ] **Step 1: Failing test** — smoke handshake with `--allow-writes`: `tools/list` includes `update_form`, `share_form`, `import_form_from_naddr`; without it, `update_form`/`share_form` are absent but `import_form_from_naddr` present.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(mcp): update_form, share_form, import_form_from_naddr tools"`

---

## Phase 5 — Packaging, docs, sweep

### Task 15: `package.json` for publish

**Files:** Modify `packages/mcp/package.json`; verify `tsup.config.ts`.

- Remove `"private": true`; set `"version": "2.0.0"`; add `"description"`, `"keywords"` (`["mcp","nostr","formstr","forms"]`), `"repository"`, `"homepage"`, `"license": "MIT"`, `"engines": { "node": ">=20" }`, `"publishConfig": { "access": "public" }`, `"prepublishOnly": "pnpm build"`.
- Add deps: `"@napi-rs/keyring": "^1.x"`, `"qrcode": "^1.5.x"`. Add devDep `"@types/qrcode"`.
- `tsup.config.ts`: keep `format:["cjs"]`; set `noExternal:[/^.*/]` but `external: ["@napi-rs/keyring"]` (native). Ensure `bin` → `formstr-mcp`.

- [ ] **Step 1:** Apply edits.
- [ ] **Step 2:** `pnpm install` (workspace) then `pnpm --filter @formstr/mcp build`; expect `dist/index.js` with shebang.
- [ ] **Step 3:** Manual smoke: `node packages/mcp/dist/index.js whoami` prints "not logged in" cleanly (no key configured).
- [ ] **Step 4: Commit** — `git commit -am "build(mcp): publishable package metadata + keychain/qrcode deps"`

### Task 16: README rewrite

**Files:** Modify `packages/mcp/README.md`.

Sections: Quick start (`npx -y @formstr/mcp login` → run), the login flow (nsec/guest/connect, keychain, NIP-46), host config (no key in config after login), the headless plaintext path + warning, full **forms** tool catalog (read/create/gated) with example I/O, and the security model. Remove the v1 "Deferred (not implemented)" forms items now shipped.

- [ ] **Step 1:** Rewrite.
- [ ] **Step 2: Commit** — `git commit -am "docs(mcp): v2 README — login flow, full forms catalog, security"`

### Task 17: Full sweep

- [ ] **Step 1:** `pnpm --filter @formstr/core test && pnpm --filter @formstr/core typecheck`
- [ ] **Step 2:** `pnpm --filter @formstr/app test forms && pnpm --filter @formstr/app typecheck`
- [ ] **Step 3:** `pnpm --filter @formstr/mcp test && pnpm --filter @formstr/mcp typecheck`
- [ ] **Step 4:** Manual end-to-end: `node dist/index.js login` (paste a throwaway nsec) → `whoami` shows the pubkey → run server with `--allow-writes`, `tools/list` shows the full forms surface.
- [ ] **Step 5:** Fix any failures (systematic-debugging if needed), then `git commit -am "test(mcp): v2 green sweep"` if fixes were made.

---

## Self-Review

**Spec coverage:** D1 keychain login → Tasks 6–10, 15. D2 NIP-46 → Tasks 1–2, 9. D3 full forms surface → Tasks 3–5 (service) + 12–14 (tools) + polish 12–13. D4 npm/npx bundle → Task 15. D5 warned plaintext → Task 10. Output "empty JSON" fix → Task 11–12. Security (stderr, no secret leakage, gating) → Tasks 10, 11, 14. Tests → every task + Task 17. README → Task 16. **No spec gaps.**

**Placeholders:** Two explicit "confirm against installed version" notes (NIP-46 constructor in Task 1; `wrapManyEvents` signature + rumor kind in Task 4) are deliberate verification steps, not vague placeholders — each names the exact file/line to check and the fallback. All other steps carry concrete code/commands.

**Type consistency:** `Credential` (Task 6) ↔ keystore (Task 7) ↔ config/bootstrap (Task 10) ↔ `buildNip46Signer`/`Nip46Connection` (Task 9 ↔ Task 2) align. `updateForm`/`shareForm`/`fetchFormSummaryFromRef`/`importForm` signatures (Tasks 3–5) match their tool call sites (Task 14). `ok`/`fail`/`table` (Task 11) match usage in Tasks 12–14.

**Risk note:** `share_form` rumor format (Task 4) is the least-pinned piece — verify how the app reads a gift-wrapped view key before finalizing the inner event shape, so MCP-shared keys are readable by the super-app.
