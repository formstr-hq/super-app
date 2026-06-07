# Drive (formstr-drive) — interop & parity design

> Status: approved design (2026-06-07). Branch `drive-interop-parity` (off `polls-interop-parity`).
> Standalone reference: `super-app/upstream/formstr-drive/` (+ its `ARCHITECTURE.md`).
> Applies the recurring module pattern: same kinds/tags/encryption, delete-that-sticks, relay-set parity, full MCP, Option-A full-bleed two-pane UI.

## 1. Context

Drive **already exists** in the super-app (`services/drive`, `driveStore`, `DrivePage`, `mcp/tools/drive`, `core/blossom` + `core/crypto`). Like Polls, this is an **audit-and-parity** pass, not greenfield. Drive stores encrypted file **blobs on Blossom servers** and an encrypted **file index on Nostr** (kind 34578, parameterized-replaceable, `d` = blob SHA-256). The standalone is **single-user**: self-encryption only, **no sharing / no viewKey**.

### Audit — super-app vs standalone

Already correct/shared: kind **34578** metadata (`d`=hash, `client`/`encrypted` tags), self NIP-44 metadata encryption, kind **24242** Blossom auth, **relay defaults already identical** to the standalone's `APP_RELAYS` (`damus`, `nostr.band`, `nos.lol`), soft-delete via the `deleted` flag.

Gaps addressed by this spec:

| #   | Gap                                                                                                                             | Severity                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| A   | **File-blob encryption uses a different, incompatible scheme** — neither app can decrypt the other's files.                     | Breaking                 |
| B   | `fetchFileIndex` does not sort-by-`created_at` + dedup-by-`d` keep-latest → a stale event can resurrect a deleted/renamed file. | Bug                      |
| C   | No **rename / move** (standalone has `updateFileMetadata{name,folder}`).                                                        | Parity                   |
| D   | No **Blossom server discovery** (kind 36363) / selector / persistence.                                                          | Parity                   |
| E   | **MCP** only has `browse_files`.                                                                                                | Parity                   |
| F   | 24242 auth polish (missing `payload` tag, expiration, `X-SHA-256` header).                                                      | Polish (mostly cosmetic) |
| G   | **UI** is a single centered page, not full-bleed Layout-A two-pane.                                                             | Parity                   |

## 2. Decisions (locked)

- **Encryption: clean-cut to the standalone scheme.** Drop the super-app's `{ciphertext,iv}` AES format entirely. **No legacy decode path** — files previously uploaded by the super-app's old scheme become undecryptable (acceptable; PoC, no real data).
- **Server discovery: full parity** — kind-36363 discovery + selector UI + persistence.
- **MCP: metadata + manage only, no binary** — list / get-info / delete / rename / move. No upload/download over MCP.
- **UI: Layout-A, list/table view** (approved mockup `.superpowers/brainstorm/648921-*/content/drive-layout.html`). Orchestrator kept lean (~200 LOC is a _soft_ guideline, not a hard cap).
- **Out of scope:** sharing / viewKey / share-links (standalone is single-user), binary over MCP, legacy blob decode, NIP-09 kind-5 (drive deletes are soft-deletes via the replaceable event), real-time multi-device conflict resolution, thumbnail/preview generation.

## 3. Core file-crypto parity (gap A) — the headline fix

`aesGcm*` / `generateFileKey` are **drive-only** (only `services/drive/service.ts` imports them), so they can be replaced without touching Forms/Pages. `BlossomClient` / `createBlossomAuthEvent` **are shared with Forms** → any change to them must stay backward-compatible.

Replace the per-file crypto in `core/src/crypto/` with a **byte-for-byte port** of the standalone `src/crypto.ts`:

- **`encryptFileWithKey(fileBytes: Uint8Array) → { ciphertext: string; privateKeyHex: string }`**
  1. `secretKey = generateSecretKey()`; `pubkey = getPublicKey(secretKey)` (per-file **nostr keypair**).
  2. `conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey)` (self-conversation).
  3. `plaintext = base64(fileBytes)` (standalone base64s the bytes **before** encrypting).
  4. `ciphertext = aesGcmEncrypt(plaintext, conversationKey)`.
  5. return `{ ciphertext, privateKeyHex: bytesToHex(secretKey) }`.
- **`decryptFileWithKey(ciphertext: string, privateKeyHex: string) → Uint8Array`** — reverse: `hexToBytes` → `getPublicKey` → `getConversationKey` → `aesGcmDecrypt` → `base64ToBytes`.
- **`aesGcmEncrypt(plaintext: string, conversationKey: Uint8Array) → string`** (the standalone's large-payload transform, **not** nostr-tools nip44):
  - 32-byte random `nonce`; HKDF-SHA256(ikm=`conversationKey`, salt=`nonce`, info=utf8`"nip44-v2"`) → **44 bytes**; `key=[0:32]`, `iv=[32:44]`.
  - `ct = AES-GCM.encrypt(key, iv, utf8(plaintext))` (WebCrypto appends the GCM tag).
  - payload = `[version=2 (1B) | nonce (32B) | ct]`; return `base64(payload)`.
- **`aesGcmDecrypt(ciphertext, conversationKey) → string`** — parse version (must be 2) / nonce / ct, re-derive, AES-GCM decrypt, utf8-decode.

**`FileMetadata.encryptionKey` now stores the hex per-file _secret key_** (not a raw AES key). `FileMetadata` shape is otherwise unchanged.

Old core exports `generateFileKey` / object-form `aesGcmEncrypt(data, keyHex): EncryptedPayload` / `aesGcmDecrypt(payload, keyHex)` and the `EncryptedPayload` type are **removed**; `core/src/index.ts` re-exports `encryptFileWithKey` / `decryptFileWithKey` (and the string `aesGcmEncrypt`/`aesGcmDecrypt` if needed internally). `core/src/crypto/aesGcm.test.ts` is rewritten for the new API.

### Upload / download wiring (`services/drive/service.ts`)

- **Upload:** `{ ciphertext, privateKeyHex } = encryptFileWithKey(fileBytes)` → `bytes = TextEncoder().encode(ciphertext)` → `BlossomClient.upload(bytes, authEvent, file.type)`; `metadata.encryptionKey = privateKeyHex`; `metadata.hash` = server-returned SHA-256 (== SHA-256 of `bytes`). This is what makes a super-app upload downloadable+decryptable by the standalone and vice-versa.
- **Download:** `bytes = BlossomClient.download(hash, getAuth)` → `ciphertext = TextDecoder().decode(bytes)` → `decryptFileWithKey(ciphertext, metadata.encryptionKey)`.
- **`BlossomClient.upload`** (shared): add the **`X-SHA-256`** header (SHA-256 of the uploaded bytes) and tolerate non-JSON responses (`json.sha256 ?? json.x ?? text`). Additive — Forms uploads keep working. `createBlossomAuthEvent` left as-is for Forms back-compat (gap F's `payload`-tag/expiration tweaks are cosmetic per-request and skipped).

## 4. Read-path correctness + service surface (gaps B, C)

- **`fetchFileIndex()`** — fetch all kind-34578 for the user from drive relays, **sort by `created_at` desc, dedup by `d`/hash keeping only the latest event per file**, decrypt each, then drop `deleted:true`. This is drive's delete-that-sticks: stale events on any relay in the set can't resurrect a deleted/renamed file.
- **`updateFileMetadata(hash, { name?, folder? })`** — fetch the latest metadata for `hash`, merge, republish a kind-34578 with the **same `d`** (replaces). `renameFile(metadata, newName)` and `moveFile(metadata, newFolder)` are thin wrappers.
- **`extractFolders(files)`** — align to the standalone: always include `/`, add every ancestor path of each file's folder, sorted.
- **`deleteFile`** unchanged (soft-delete republish with `deleted:true`).

### Store (`stores/driveStore.ts`)

Add `renameFile` / `moveFile` actions (optimistic update of `files`). Add server-selection state from §5: `servers`, `selectedServer`, `setSelectedServer`, `addCustomServer`, `loadServers`. Keep `fetchFiles` / `uploadFile` / `deleteFile` / `downloadFile` / folder helpers.

## 5. Blossom server discovery + selection (gap D)

- **Service** `fetchBlossomServers() → { url, source }[]` — query kind **36363** from drive relays (`limit: 50`), take each `d`-tag URL, **normalize** (ensure scheme, strip trailing slash), merge with `DEFAULT_BLOSSOM_SERVERS` (`blossom.primal.net`, `nostr.download`, `blossom.oxtr.dev`) and user custom servers; tag source `default` / `relay` / `custom`.
- **Persistence** — `selectedServer` and the custom-server list persist client-side (localStorage-backed settings), surviving reloads, like the standalone.
- **Upload** uses `selectedServer` when no explicit server is passed (replaces the hardcoded `DEFAULT_BLOSSOM_SERVERS[0]`).

## 6. MCP coverage (gap E)

`packages/mcp/src/tools/drive.ts` — keep `browse_files`, add:

- `get_file_info` — one file's **safe** metadata by name/folder (or hash). **Omits `encryptionKey`** (and hash/server, as `browse_files` already does).
- `delete_file` — soft-delete. **Gated** + `requireConfirm`.
- `rename_file` — change name. **Gated** + `requireConfirm`.
- `move_file` — change folder. **Gated** + `requireConfirm`.

Add `delete_file` / `rename_file` / `move_file` to `GATED_TOOLS` in `packages/mcp/src/safety.ts`. Targets are resolved by listing first (reuse `fetchFileIndex`), so the model never touches file keys or blobs. No binary upload/download.

## 7. UI — Layout-A, full-bleed, list view (gap G)

Add `/drive` to `layout/fullBleed.ts`. `DrivePage.tsx` becomes a lean orchestrator composing new `components/drive/`:

- **`DriveSidebar.tsx`** — "Folders" rail: tree of (extracted ∪ local custom folders), item counts, active highlight, ＋ inline new-(empty)-folder input. Local custom folders persist client-side (matches standalone `addCustomFolder`).
- **`DriveToolbar.tsx`** — breadcrumb + server selector (dropdown with `relay`/`custom` labels + inline "＋ Custom") + Upload button.
- **`FileList.tsx`** — table rows (Name · Size · Type · Modified), folders-first, download action + "⋯" overflow → **Rename / Move / Delete**. Drag-drop upload onto the pane retained.
- **`RenameFileDialog.tsx`**, **`MoveFileDialog.tsx`** (folder picker) — small MUI dialogs.

Monochrome, outlined **lucide** line-icons, **never emoji**.

## 8. Testing (TDD; backend only — no new frontend component tests)

- **core** `crypto/aesGcm.test.ts` — `encryptFileWithKey`/`decryptFileWithKey` round-trip; `aesGcmEncrypt`/`aesGcmDecrypt` round-trip; payload format (`version=2`, 32-byte nonce); decrypt rejects unknown version.
- **app** `services/drive/service.test.ts` — latest-per-`d` dedup keeps newest; `deleted:true` filtered out; stale non-deleted event can't resurrect a deleted file; `updateFileMetadata`/`rename`/`move` republish same `d` with merged content; `extractFolders` ancestors + `/`; `fetchBlossomServers` merges defaults ∪ relay(36363) ∪ custom and normalizes URLs.
- **app** `stores/driveStore.test.ts` — rename/move optimistic update; server selection/add-custom; persistence.
- **mcp** `test/drive.test.ts` — `get_file_info` omits `encryptionKey`; `delete_file`/`rename_file`/`move_file` gated (blocked without `confirm:true`, succeed with it).

Close with `pnpm -r test && pnpm -r typecheck && pnpm -r build`.

## 9. Key files

- `packages/core/src/crypto/aesGcm.ts` (+ `.test.ts`), `packages/core/src/index.ts`, `packages/core/src/blossom/BlossomClient.ts`.
- `packages/app/src/services/drive/{service.ts,types.ts}` (+ `service.test.ts`), `stores/driveStore.ts` (+ `.test.ts`).
- `packages/app/src/pages/DrivePage.tsx`, `components/drive/{DriveSidebar,DriveToolbar,FileList,RenameFileDialog,MoveFileDialog}.tsx`, `layout/fullBleed.ts`.
- `packages/mcp/src/tools/drive.ts` (+ `test/drive.test.ts`), `packages/mcp/src/safety.ts`.

## 10. Follow-ups (not in scope)

Sharing (encrypt-to-recipient), Blossom server-side delete (free space), thumbnails/preview, multi-device conflict resolution, search/filter.
