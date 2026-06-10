import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { StorageAdapter } from "@formstr/signer";

const SERVICE = "formstr-mcp";
// A fresh keychain account / filename, distinct from the legacy `store` /
// `credentials.enc` namespace the old Credential keystore used — old data is
// simply ignored (breaking change; the user runs `formstr-mcp login` again).
const KEYRING_ACCOUNT = "kv";

/** The persisted blob: a flat string→string map (the keys `@formstr/signer` writes). */
type KvMap = Record<string, string>;

/**
 * Encrypted key/value storage backing `@formstr/signer`. Prefers the OS keychain
 * (macOS Keychain / Windows Credential Manager / Linux Secret Service via
 * `@napi-rs/keyring`); falls back to an AES-256-GCM encrypted file
 * (`~/.config/formstr-mcp/keystore.enc`, mode 0600) keyed by `FORMSTR_MCP_PASSPHRASE`
 * when no keychain is available (e.g. headless Linux).
 *
 * Override with `FORMSTR_MCP_KEYSTORE=file|keychain` and the directory with
 * `FORMSTR_MCP_CONFIG_DIR`.
 *
 * `createKeystoreStorage()` resolves the backend (an async dynamic keyring import),
 * loads the whole blob once into an in-memory map, and returns a **synchronous**
 * `StorageAdapter` — the signer hydrates and persists synchronously through it.
 */
export async function createKeystoreStorage(): Promise<StorageAdapter> {
  const backend = await selectBackend();
  const map: KvMap = backend.load();
  return {
    get(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    set(key, value) {
      map[key] = value;
      backend.save(map);
    },
    remove(key) {
      delete map[key];
      backend.save(map);
    },
  };
}

interface Backend {
  load(): KvMap;
  save(map: KvMap): void;
}

async function selectBackend(): Promise<Backend> {
  const mode = process.env.FORMSTR_MCP_KEYSTORE;
  if (mode !== "file") {
    const kb = await keyringBackend();
    if (kb) return kb;
    if (mode === "keychain") {
      throw new Error("OS keychain unavailable but FORMSTR_MCP_KEYSTORE=keychain was requested.");
    }
  }
  return fileBackend();
}

function parseMap(raw: string | null | undefined): KvMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as KvMap) : {};
  } catch {
    return {};
  }
}

// ── Keychain backend ────────────────────────────────────

async function keyringBackend(): Promise<Backend | null> {
  let Entry: KeyringEntryCtor;
  try {
    ({ Entry } = (await import("@napi-rs/keyring")) as { Entry: KeyringEntryCtor });
  } catch {
    return null; // module/native binary missing
  }
  if (!keyringUsable(Entry)) return null;

  const entry = new Entry(SERVICE, KEYRING_ACCOUNT);
  return {
    load() {
      try {
        return parseMap(entry.getPassword());
      } catch {
        return {}; // not-found or parse error → empty
      }
    },
    save(map) {
      entry.setPassword(JSON.stringify(map));
    },
  };
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}
type KeyringEntryCtor = new (service: string, account: string) => KeyringEntry;

/** Probe that the secret service actually works (constructing an Entry never throws). */
function keyringUsable(Entry: KeyringEntryCtor): boolean {
  try {
    const probe = new Entry(SERVICE, "__probe__");
    probe.setPassword("ok");
    const ok = probe.getPassword() === "ok";
    probe.deletePassword();
    return ok;
  } catch {
    return false;
  }
}

// ── Encrypted-file backend ──────────────────────────────

function configDir(): string {
  return process.env.FORMSTR_MCP_CONFIG_DIR ?? join(homedir(), ".config", SERVICE);
}
function filePath(): string {
  return join(configDir(), "keystore.enc");
}

const NO_PASSPHRASE =
  "No OS keychain available. Set FORMSTR_MCP_PASSPHRASE to enable the encrypted-file " +
  "fallback, or run on a machine with a system keychain.";

function fileBackend(): Backend {
  return {
    // Reading an absent file needs no passphrase (nothing stored yet) → "not signed in"
    // degrades gracefully on keychain-less hosts. A passphrase is only required to decrypt
    // an existing file or to save.
    load() {
      const path = filePath();
      if (!existsSync(path)) return {};
      const passphrase = process.env.FORMSTR_MCP_PASSPHRASE;
      if (!passphrase) {
        throw new Error("Encrypted keystore file exists but FORMSTR_MCP_PASSPHRASE is not set.");
      }
      return parseMap(decryptBlob(readFileSync(path, "utf8"), passphrase));
    },
    save(map) {
      const passphrase = process.env.FORMSTR_MCP_PASSPHRASE;
      if (!passphrase) throw new Error(NO_PASSPHRASE);
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(filePath(), encryptBlob(JSON.stringify(map), passphrase), { mode: 0o600 });
    },
  };
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

function encryptBlob(plaintext: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

function decryptBlob(blob: string, passphrase: string): string {
  const [saltB, ivB, tagB, ctB] = blob.split(":");
  const salt = Buffer.from(saltB, "base64");
  const iv = Buffer.from(ivB, "base64");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

/** Test/diagnostic helper: the resolved keystore-file path. */
export function keystoreFilePath(): string {
  return filePath();
}

/** Test/diagnostic helper: file permission bits (e.g. 0o600), or null if absent. */
export function keystoreFileMode(): number | null {
  const path = filePath();
  return existsSync(path) ? statSync(path).mode & 0o777 : null;
}
