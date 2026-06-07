# Pages (nostr-docs) Interop & Parity — Design Spec

> **Goal:** integrate the Formstr **Pages** module into the super-app to true parity / sync
> with the standalone **"Pages by Form\*"** (`upstream/nostr-docs`), the same way Forms and
> Calendar were done. Bidirectional wire-compatibility, no tag mistakes, delete that sticks.
> **Branch:** `pages-interop-parity` (off `main`). **Date:** 2026-06-06.
> **Companion:** UI mockups (approved) in `.superpowers/brainstorm/*/content/` (`pages-layout.html`,
> `pages-surfaces.html`).

---

## 1. Scope (locked with the user)

**In scope**

- **Core docs:** create / edit / list / open / delete private encrypted Markdown documents (kind 33457).
- **Sharing:** view-only and can-edit links via a `#nkeys1…` URL fragment (viewKey / editKey).
- **Shared-with-me inbox** (kind 11234): receive, persist, list, and open documents others shared with you.
- **Doc tags/labels** (kind 34579): private per-doc labels; filter the left rail by label.
- **Delete that sticks:** apply NIP-09 (kind 5) deletions on load (the same bug we fixed for calendar).
- **Full interop:** rebuild encryption to the standalone's exact owner/viewKey model; **drop the plaintext
  `title` tag** (privacy + wire parity).
- **MCP:** expose every pages function (create / list / get / save / share / delete / set-tags / list-shared).
- Keep the super-app's existing **RichEditor** (slash `/` blocks, `@` entity links, AI assist) — richer than
  the standalone's plain tiptap.

**Out of scope** (mirrors calendar's "parity + polish, no heavy subsystems")

- **Real-time collaboration** (kind 22457 Yjs/CRDT live co-editing).
- **Inline comments** (kind 1494).
- Device-only / offline-first local drafts, Tauri/Capacitor native shells, NIP-65 per-user relay switching
  (the super-app already has its own relay manager).

**Testing:** backend only — `services/pages/**` (service) + `stores/pagesStore` + `mcp` tests, TDD.
**No new frontend component tests** (standing directive).

---

## 2. Standalone wire format (source of truth)

Vendored snapshot: `upstream/nostr-docs/`. Coordinate/address form throughout: `"<kind>:<pubkey>:<dTag>"`.

### Event kinds (`src/nostr/kinds.ts`)

| Kind      | Purpose                                                                                                                | Super-app handling |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **33457** | Encrypted document (param-replaceable). Tags: `["d", <dTag>]` **only**. Content = NIP-44 encrypted Markdown.           | full CRUD          |
| **11234** | "Shared-with-me" list (replaceable). Content = NIP-44 **self**-encrypted JSON array of `[address, viewKey, editKey?]`. | fetch + maintain   |
| **34579** | Per-doc tags/labels. Tags: `["d", <address>]`. Content = NIP-44 **self**-encrypted JSON `{ tags: string[] }`.          | fetch + maintain   |
| **5**     | NIP-09 deletion. Tag `["a", <address>]`. Fetched on load with `#k:[33457]`.                                            | fetch + filter     |
| **22457** | Yjs CRDT op (ephemeral).                                                                                               | **out of scope**   |
| **1494**  | Inline comment.                                                                                                        | **out of scope**   |

### Encryption (`src/utils/encryption.ts` → `encryptContent`)

```
encryptContent(content, viewKey?):
  if viewKey:  key = nip44.getConversationKey(hexToBytes(viewKey), getPublicKey(hexToBytes(viewKey)))
               return nip44.encrypt(content, key)              // viewKey self-conversation
  else:        return signer.nip44Encrypt(ownPubkey, content)  // owner self-encryption
```

- **Personal doc** (not shared) → **owner self-encryption** (no viewKey). Only the owner can read it.
- **Shared doc** → **viewKey self-conversation**: a random 32-byte `viewKey`; conversation key derived from
  `(viewKey, pubkey(viewKey))`. Anyone holding the viewKey hex decrypts. This is the **same model as the
  calendar viewKey** — in super-app terms, a `LocalSigner(viewKeyBytes)` + `nip44SelfEncrypt/Decrypt`.

### Sharing (`src/components/editor/utils.ts` → `handleGeneratePrivateLink`)

1. `viewKey = generateSecretKey()` (reuse if the doc already has one); `editKey = generateSecretKey()` **iff
   "can edit"**.
2. Re-encrypt the current content with `encryptContent(content, viewKeyHex)`.
3. Sign the kind-33457 event:
   - **can-edit** → `finalizeEvent(event, editKey)` ⇒ event pubkey = **editKey's** pubkey ⇒ address
     `33457:<editKeyPubkey>:<dTag>`. Recipients publish updates with the editKey without the owner's signer.
   - **view-only** → signed by the **owner** ⇒ address stays `33457:<owner>:<dTag>` (now viewKey-encrypted).
4. URL = `<base>/doc/<naddr>#<encodeNKeys({viewKey, editKey?})>`.
   - `naddr` = `nip19.naddrEncode({ pubkey, kind: 33457, identifier: dTag })`.
   - `encodeNKeys` = bech32 `nkeys1…`, TLV (type 0 = keys, type 1 = values) — **already implemented and
     identical** in `@formstr/core` (`packages/core/src/crypto/nkeys.ts`), shared with Forms.

### Shared-with-me list (`src/contexts/SharedDocsContext.tsx`, kind 11234)

- `addSharedDoc([address, viewKey, editKey?])` collects every locally-known doc that has a viewKey
  (i.e. received via a link) and republishes the **whole set** as one kind-11234 event, content =
  `signer.nip44Encrypt(ownPubkey, JSON.stringify(entries))` where each entry is the tag array
  `[address, viewKey, editKey?]`.
- On load: fetch kind 11234 (author = self) → self-decrypt → for each `[address, viewKey, editKey?]`,
  fetch the kind-33457 event (`#d`+author from the address) and decrypt with the viewKey.

---

## 3. Current super-app pages module — gap analysis

Files: `packages/app/src/{services/pages,components/pages,stores/pagesStore.ts,pages/PagesPage.tsx}`,
`packages/mcp/src/tools/pages.ts`. `PAGES_KINDS` already match (33457/11234/34579/22457). Gaps:

1. **Encryption is divergent and self-inconsistent.** `savePage` encrypts with
   `nip44Encrypt(signer, viewPubkey, content)` = conversation key `(ownerPriv, viewPubkey)` — matches **neither**
   owner self-encryption **nor** the standalone viewKey model; and `fetchPage` self-decrypts with the owner key,
   so a personal doc the super-app saves cannot be re-decrypted by the super-app itself. **Rebuild required.**
2. **Plaintext `["title"]` tag** on kind 33457 — the standalone doesn't write it and never reads it; it leaks the
   title in cleartext. **Drop it**; derive the title from the decrypted first line (the standalone does this).
3. **Delete doesn't persist.** `deletePage` publishes a correct kind-5, but `fetchMyPages` never fetches/apply
   deletions, so a deleted doc reappears after refresh (identical to the calendar bug).
4. **No shared-with-me (kind 11234)** at all — receiving shared docs is unimplemented.
5. **Sharing is broken** — `generateShareLink` needs the page already open (a viewKey in memory) and never
   re-encrypts/re-signs; there is no view-only/can-edit choice and no editKey path.
6. **Tags (34579)** — `saveDocMetadata` writes but nothing fetches/renders/filters them.
7. **UI** is a flat list + modal editor; we're moving to the approved **two-pane workspace (Layout A)**.

---

## 4. Design

### 4.1 Service layer — `services/pages/service.ts` (rebuilt)

A small, pure, well-bounded module. New helper `pages/viewKey.ts` (mirrors calendar's): hex viewKey ⇄
`LocalSigner` for `encryptWithViewKey(hex, text)` / `decryptWithViewKey(hex, text)` = the standalone's
self-conversation scheme.

- `savePage({ content, existingId?, viewKey?, editKey? })` →
  - `encrypted = viewKey ? encryptWithViewKey(viewKey, content) : nip44SelfEncrypt(signer, content)`.
  - event `{ kind: 33457, tags: [["d", dTag]], content: encrypted }`, signed by `editKey` (LocalSigner/finalize)
    when present else the owner signer. **No title tag.**
  - returns `{ id, address, title (from content), content, pubkey, createdAt, viewKey?, editKey?, event }`.
- `fetchMyPages()` → query `{ kinds:[33457], authors:[self] }`; **fetch kind-5 deletions** (`fetchDeletions`,
  ported from calendar: `{ kinds:[5], authors:[self] }`, index deleted `a`-addresses by newest `created_at`
  with the same-author guard); newest-wins per d-tag; drop deleted; **decrypt each** to get the title (first
  markdown line) — owner self-decrypt first, falling back to a **persisted viewKey** for docs the owner has
  shared (see below). Returns `PageSummary[]` (+ tags from §4.4).

> **ViewKey persistence (avoids a lost-key bug).** A personal doc is owner-encrypted with **no** viewKey.
> Sharing it **view-only** re-encrypts it under the viewKey at the _same_ owner address — after that the owner
> can no longer self-decrypt it, exactly like the calendar private-event case. So when the owner shares a doc we
> persist `{ address → viewKey, editKey? }` both in `localStorage` **and** in the owner's kind-11234 set (the
> standalone's `addSharedDoc` already includes any locally-known doc that has a viewKey), so the owner's own
> shared docs stay decryptable across refreshes and devices. `fetchMyPages`/`loadPage` consult this map.

- `fetchPage(pubkey, docId, viewKey?)` → fetch one; decrypt with viewKey (shared) or owner self-decrypt; title
  from content.
- `generateShareLink(page, content, canEdit)` → implements `handleGeneratePrivateLink`: mint viewKey
  (reuse existing) + editKey (iff canEdit), re-encrypt, re-sign (editKey vs owner), publish, return
  `{ url: <origin>/pages/<naddr>#<nkeys>, address, viewKey, editKey? }`. Also understands inbound
  `/doc/<naddr>#<nkeys>` (standalone) links when opening.
- `deletePage(address)` → kind-5 `["a", address]` + `["k","33457"]` (unchanged shape; now actually honored on
  load by `fetchDeletions`).
- `fetchDeletions(relays, authors)` / `isPageDeleted(event, index)` → ported from the calendar fix.

### 4.2 Shared-with-me — kind 11234 (`service.ts` + store)

- `fetchSharedPages()` → query `{ kinds:[11234], authors:[self] }`, newest-wins, self-decrypt → entries
  `[address, viewKey, editKey?]`; for each, fetch the 33457 doc and decrypt with its viewKey → `PageSummary`
  (flagged `shared: true`, `canEdit: !!editKey`).
- `addSharedPage(entry)` / `saveSharedList(entries)` → republish the whole kind-11234 set self-encrypted.
- Opening a `#nkeys` link (in-app or pasted) adds the entry to the shared list so it persists across devices.

### 4.3 Tags/labels — kind 34579 (`service.ts` + store)

- `fetchDocTags(addresses)` → query `{ kinds:[34579], authors:[self], "#d": addresses }`, self-decrypt
  `{ tags }`, newest-wins per address.
- `setDocTags(address, tags[])` → publish `{ kind:34579, tags:[["d", address]], content: selfEncrypt({tags}) }`.
- Tags decorate `PageSummary`; the left rail offers a tag filter (chips).

### 4.4 Store — `stores/pagesStore.ts` (rebuilt)

State: `pages`, `sharedPages`, `tagsByAddress`, `currentPage`, `currentTags`, `isLoading`, `error`,
`activeTagFilter`. Actions: `fetchMyPages`, `fetchSharedPages`, `loadPage`, `savePage`, `deletePage`
(optimistic remove + survives refresh via deletion filter), `sharePage(canEdit)`, `openSharedLink(naddrOrUrl)`,
`setTags`, `setActiveTagFilter`, `clearCurrent`. Deletions and dedup mirror the calendar store.

### 4.5 UI — Layout A (two-pane workspace), monochrome aesthetic

- `pages/PagesPage.tsx` (orchestrator, < 200 LOC): `<PagesSidebar>` + main pane (`<PageEditorSurface>` or
  empty state). Module already lives in the navbar (shared layout from the calendar work pattern).
- `components/pages/PagesSidebar.tsx` — `+ New Page`; **My Pages** rows (title · date · 🔒/label chips, active
  highlight); **Shared with me** section (view-only vs edit badge); **Tags** filter chips.
- `components/pages/PageEditorSurface.tsx` — inline title, slim toolbar (`Share` · `Tags` · `Delete` · `Save`),
  `Encrypted` chip, the existing `<RichEditor>` body; autosave on blur/Cmd-S (debounced). Read-only when opening
  a view-only shared doc.
- `components/pages/SharePageDialog.tsx` — **View only** / **Can edit** radios → `sharePage(canEdit)` → shows the
  generated `…/pages/<naddr>#nkeys1…` link + Copy; note that keys live in the fragment.
- `components/pages/PageTagsPopover.tsx` — chips with remove + add-label field → `setTags`.

### 4.6 MCP — `mcp/src/tools/pages.ts` (parity)

Expose every function (gated/confirm for writes, mirroring calendar):
`create_page`, `list_pages`, `get_page`, `save_page` (update), `delete_page`, `share_page` (returns the
`#nkeys` link), `list_shared_pages`, `set_page_tags`, `get_page_tags`. Mock the new service fns in the MCP test.

---

## 5. Data flow

**Create/Save** — editor → `savePage` → owner-self-encrypt (or viewKey if the doc is shared) → sign (owner or
editKey) → publish 33457 → store updates.
**Open** — sidebar row → `loadPage(pubkey, id, viewKey?)` → fetch + decrypt → editor surface.
**Share** — Share dialog → `sharePage(canEdit)` → mint keys, re-encrypt + re-sign + publish → `#nkeys` link;
own shared docs are recorded so they round-trip.
**Receive** — open a `#nkeys` link → decrypt with viewKey → `addSharedPage([address, viewKey, editKey?])` →
kind-11234 republish → appears under "Shared with me" on every device.
**Delete** — `deletePage(address)` → kind-5 `["a", address]` → optimistic remove → **stays gone** because
`fetchMyPages`/`fetchSharedPages` apply `fetchDeletions` on load.
**Tags** — Tags popover → `setTags(address, tags)` → kind-34579 self-encrypted → decorate + filter.

---

## 6. Interop notes / risks

- **Same-user sync** (super-app ⇄ calendar.formstr.app Pages logged in with the same key) works once encryption
  - kinds + the kind-11234 list + relays match — which this spec enforces. The super-app's `pages` relay set
    should **union** the standalone's defaults (mirror the calendar `module-defaults.ts` fix) so writes reach
    every relay the standalone reads.
- **Cross-app share links:** the standalone serves shares at `/doc/<naddr>#nkeys`, the super-app at
  `/pages/<naddr>#nkeys`. `naddr` + `nkeys` are identical, so the super-app will **parse both** paths when
  opening; producing a standalone-openable link is a follow-up (different deployment/origin), not required for
  same-user sync.
- **Title privacy:** dropping the plaintext title means the list must self-decrypt each owned doc to show its
  title — cheap (owner self-decrypt), and exactly what the standalone does.
- **Upstream context doc:** if any standalone-side hardening gaps surface during implementation (e.g. uncaught
  throws on a malformed `#nkeys`), record them in a `docs/superpowers/specs/2026-06-06-pages-interop-issues.md`
  the way we did for calendar — super-app fixes its own side regardless.

---

## 7. Files

**Rebuilt:** `services/pages/{service.ts,types.ts}`, `stores/pagesStore.ts`, `pages/PagesPage.tsx`,
`mcp/src/tools/pages.ts`.
**New:** `services/pages/viewKey.ts`, `components/pages/{PagesSidebar,PageEditorSurface,SharePageDialog,PageTagsPopover}.tsx`,
service/store/MCP tests, `core/src/relay/module-defaults.ts` (pages relay union).
**Kept:** `components/pages/{RichEditor,slashCommands,markdownBridge}.ts(x)`.
