import { readFileSync, writeFileSync } from "node:fs";

import { nip19 } from "nostr-tools";

import { detectHarnesses, resolveCommand, type DetectedHarness } from "./harnesses.js";

export interface HarnessConfig {
  /** Executable to spawn per session, e.g. "opencode". */
  command: string;
  /** Args, e.g. ["acp"] — whatever puts your harness in ACP-over-stdio mode. */
  args?: string[];
  /** Extra env for the harness process. */
  env?: Record<string, string>;
  /** Working directory for the harness (defaults to the daemon's cwd). */
  cwd?: string;
}

export interface HomeNodeConfig {
  /** Home node's own secret key (nsec). Signs wire events; identifies this node. */
  nsec: string;
  /** Relays to listen/publish on. */
  relays: string[];
  /** Allowed edge devices, as npubs. Only these may open a session. */
  whitelist: string[];
  /**
   * The ACP harness to expose. OPTIONAL — if omitted, the daemon auto-detects
   * installed harnesses (opencode, Claude Code, Gemini) on PATH (zero-click).
   */
  harness?: HarnessConfig;
  /** Default working directory for auto-detected harnesses. */
  cwd?: string;
  /**
   * Model the harness should use, e.g. "ollama-cloud/glm-5.3-flash". For
   * opencode this is passed as OPENCODE_MODEL. Editable live from the dashboard.
   */
  model?: string;
  /** Wire privacy mode. Default "nip44". */
  privacy?: "nip44" | "nip59";
  /** Local admin dashboard. `host` may be "yggdrasil" to bind the mesh address. */
  admin?: { port?: number; host?: string };
}

/** Resolved config with keys decoded to hex. Keeps `raw`+`path` for persistence. */
export interface ResolvedConfig {
  secretKey: Uint8Array;
  relays: string[];
  whitelist: Set<string>; // hex pubkeys
  /** The harness actually spawned per session (the default). */
  harness: HarnessConfig;
  /** All ACPs this node exposes (auto-detected + configured), for the dashboard. */
  exposed: DetectedHarness[];
  /** Whether the harness was auto-detected (vs. explicitly configured). */
  harnessAuto: boolean;
  /** Model to run (OPENCODE_MODEL for opencode), or null for the harness default. */
  model: string | null;
  privacy: "nip44" | "nip59";
  admin: { port: number; host: string };
  path: string;
  raw: HomeNodeConfig;
}

export const DEFAULT_ADMIN_PORT = 4577;

function decodeNsec(nsec: string): Uint8Array {
  const { type, data } = nip19.decode(nsec);
  if (type !== "nsec") throw new Error(`expected an nsec, got ${type}`);
  return data as Uint8Array;
}

function decodeNpub(npub: string): string {
  const { type, data } = nip19.decode(npub);
  if (type !== "npub") throw new Error(`whitelist entry is not an npub: ${npub}`);
  return data as string;
}

export function resolveConfig(raw: HomeNodeConfig, path: string): ResolvedConfig {
  if (!raw.nsec) throw new Error("config.nsec is required");
  if (!raw.relays?.length) throw new Error("config.relays must be non-empty");
  if (!raw.whitelist?.length) throw new Error("config.whitelist must be non-empty");

  const detected = detectHarnesses();
  let harness: HarnessConfig;
  let exposed: DetectedHarness[];
  let harnessAuto: boolean;

  if (raw.harness?.command) {
    // Explicit override wins as the default; still surface detected ones.
    harness = raw.harness;
    harnessAuto = false;
    exposed = [
      {
        id: "configured",
        name: raw.harness.command,
        command: raw.harness.command,
        args: raw.harness.args ?? [],
        path: resolveCommand(raw.harness.command) ?? raw.harness.command,
      },
      ...detected.filter((d) => d.command !== raw.harness!.command),
    ];
  } else {
    if (detected.length === 0) {
      throw new Error(
        "no harness configured and none detected on PATH — install opencode, " +
          "claude-code-acp, or gemini, or set config.harness",
      );
    }
    harnessAuto = true;
    exposed = detected;
    harness = { command: detected[0].command, args: detected[0].args, cwd: raw.cwd };
  }

  return {
    secretKey: decodeNsec(raw.nsec),
    relays: raw.relays,
    whitelist: new Set(raw.whitelist.map(decodeNpub)),
    harness,
    exposed,
    harnessAuto,
    model: raw.model ?? null,
    privacy: raw.privacy ?? "nip44",
    admin: { port: raw.admin?.port ?? DEFAULT_ADMIN_PORT, host: raw.admin?.host ?? "127.0.0.1" },
    path,
    raw,
  };
}

/** Load config from a JSON file path (argv[2] or $HOME_NODE_CONFIG). */
export function loadConfig(): ResolvedConfig {
  const path = process.argv[2] ?? process.env.HOME_NODE_CONFIG ?? "home-node.config.json";
  let raw: HomeNodeConfig;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as HomeNodeConfig;
  } catch (err) {
    throw new Error(`could not read config at ${path}: ${(err as Error).message}`);
  }
  return resolveConfig(raw, path);
}

/**
 * Add/remove an npub from the live whitelist AND persist it back to the config
 * file, so dashboard edits survive a restart. Returns the hex pubkey affected.
 */
export function updateWhitelist(
  cfg: ResolvedConfig,
  npub: string,
  action: "add" | "remove",
): string {
  const hex = decodeNpub(npub);
  const npubs = new Set(cfg.raw.whitelist);
  if (action === "add") {
    cfg.whitelist.add(hex);
    npubs.add(npub);
  } else {
    cfg.whitelist.delete(hex);
    npubs.delete(npub);
  }
  cfg.raw.whitelist = [...npubs];
  writeFileSync(cfg.path, JSON.stringify(cfg.raw, null, 2));
  return hex;
}

/** Set the model live (affects newly spawned sessions) and persist it. */
export function updateModel(cfg: ResolvedConfig, model: string): void {
  const trimmed = model.trim();
  cfg.model = trimmed || null;
  cfg.raw.model = trimmed || undefined;
  writeFileSync(cfg.path, JSON.stringify(cfg.raw, null, 2));
}
