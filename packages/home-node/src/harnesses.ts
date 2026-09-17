import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface KnownHarness {
  id: string;
  name: string;
  /** Executable to look for on PATH. */
  command: string;
  /** Args that put it into ACP-over-stdio mode. */
  args: string[];
}

export interface DetectedHarness extends KnownHarness {
  /** Absolute path the command resolved to. */
  path: string;
}

/**
 * ACP-capable harnesses we know how to launch. Detection is by presence of the
 * command on PATH, so the user gets zero-config exposure of whatever they have
 * installed. Extend this list as more agents ship ACP support.
 */
export const KNOWN_HARNESSES: KnownHarness[] = [
  { id: "opencode", name: "opencode", command: "opencode", args: ["acp"] },
  // Zed's Claude Code ACP adapter (npm: @zed-industries/claude-code-acp).
  { id: "claude-code", name: "Claude Code", command: "claude-code-acp", args: [] },
  { id: "gemini", name: "Gemini CLI", command: "gemini", args: ["--experimental-acp"] },
];

/** Resolve a command against PATH (cross-platform). Returns the path or null. */
export function resolveCommand(command: string): string | null {
  const isWin = process.platform === "win32";
  const exts = isWin ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, command + ext);
      try {
        accessSync(full, constants.X_OK);
        return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** Detect which known harnesses are installed on this machine. */
export function detectHarnesses(): DetectedHarness[] {
  const found: DetectedHarness[] = [];
  for (const h of KNOWN_HARNESSES) {
    const path = resolveCommand(h.command);
    if (path) found.push({ ...h, path });
  }
  return found;
}
