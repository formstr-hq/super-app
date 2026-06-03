import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { type Credential, credentialSchema } from "./credential";

const SERVICE = "formstr-mcp";
const KEYRING_ACCOUNT = "store";

const storeSchema = z.object({
  default: z.string().optional(),
  accounts: z.record(z.string(), credentialSchema),
});
type StoreShape = z.infer<typeof storeSchema>;
const emptyStore = (): StoreShape => ({ accounts: {} });

/**
 * Credential storage. Prefers the OS keychain (macOS Keychain / Windows Credential
 * Manager / Linux Secret Service via `@napi-rs/keyring`); falls back to an AES-256-GCM
 * encrypted file (`~/.config/formstr-mcp/credentials.enc`, mode 0600) keyed by
 * `FORMSTR_MCP_PASSPHRASE` when no keychain is available (e.g. headless Linux).
 *
 * Override with `FORMSTR_MCP_KEYSTORE=file|keychain` and the directory with
 * `FORMSTR_MCP_CONFIG_DIR`.
 */
export interface Keystore {
  /** Get a credential by pubkey, or the default when omitted. */
  get(pubkey?: string): Promise<Credential | null>;
  /** Store a credential; becomes the default unless `makeDefault` is false. */
  set(cred: Credential, makeDefault?: boolean): Promise<void>;
  remove(pubkey: string): Promise<void>;
  list(): Promise<string[]>;
}

interface Backend {
  load(): StoreShape;
  save(s: StoreShape): void;
}

export function createKeystore(): Keystore {
  let backendP: Promise<Backend> | null = null;
  const backend = () => (backendP ??= selectBackend());

  return {
    async get(pubkey) {
      const store = (await backend()).load();
      const key = pubkey ?? store.default;
      return (key && store.accounts[key]) || null;
    },
    async set(cred, makeDefault = true) {
      const b = await backend();
      const store = b.load();
      store.accounts[cred.pubkey] = cred;
      if (makeDefault || !store.default) store.default = cred.pubkey;
      b.save(store);
    },
    async remove(pubkey) {
      const b = await backend();
      const store = b.load();
      delete store.accounts[pubkey];
      if (store.default === pubkey) store.default = Object.keys(store.accounts)[0];
      b.save(store);
    },
    async list() {
      return Object.keys((await backend()).load().accounts);
    },
  };
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
        const raw = entry.getPassword();
        return raw ? storeSchema.parse(JSON.parse(raw)) : emptyStore();
      } catch {
        return emptyStore(); // not-found or parse error → empty
      }
    },
    save(store) {
      entry.setPassword(JSON.stringify(store));
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
  return join(configDir(), "credentials.enc");
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
      if (!existsSync(path)) return emptyStore();
      const passphrase = process.env.FORMSTR_MCP_PASSPHRASE;
      if (!passphrase) {
        throw new Error("Encrypted credentials file exists but FORMSTR_MCP_PASSPHRASE is not set.");
      }
      return storeSchema.parse(JSON.parse(decryptBlob(readFileSync(path, "utf8"), passphrase)));
    },
    save(store) {
      const passphrase = process.env.FORMSTR_MCP_PASSPHRASE;
      if (!passphrase) throw new Error(NO_PASSPHRASE);
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(filePath(), encryptBlob(JSON.stringify(store), passphrase), { mode: 0o600 });
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

/** Test/diagnostic helper: the resolved credentials-file path. */
export function credentialsFilePath(): string {
  return filePath();
}

/** Test/diagnostic helper: file permission bits (e.g. 0o600), or null if absent. */
export function credentialsFileMode(): number | null {
  const path = filePath();
  return existsSync(path) ? statSync(path).mode & 0o777 : null;
}
