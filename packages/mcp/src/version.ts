import { readFileSync } from "node:fs";
import { join } from "node:path";

/** npm package name, used both for the registry lookup and the upgrade hint. */
export const PACKAGE_NAME = "@formstr/mcp";

/**
 * The installed version, read from this package's `package.json`. It sits one
 * level above this module — `src/` when running from source (tsx/vitest), `dist/`
 * once bundled — and npm always ships `package.json`, so this resolves in the
 * published package too. Falls back to `0.0.0` if it can't be read.
 */
export function readInstalledVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

interface Semver {
  release: number[];
  prerelease: string[];
}

function parseSemver(version: string): Semver {
  // Strip a leading `v` and any `+build` metadata (ignored for precedence).
  const cleaned = version.trim().replace(/^v/i, "").split("+")[0];
  const [core, pre] = cleaned.split("-", 2);
  const release = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
  while (release.length < 3) release.push(0);
  return { release, prerelease: pre ? pre.split(".") : [] };
}

function compareIdentifiers(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  // Numeric identifiers always compare lower than non-numeric ones (semver §11).
  if (na && nb) return Number(a) - Number(b) < 0 ? -1 : Number(a) === Number(b) ? 0 : 1;
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compare two semver strings, returning -1 / 0 / 1. Numeric (not lexical) on the
 * release parts; a prerelease (`1.0.0-beta`) ranks below its release (`1.0.0`).
 * Build metadata and a leading `v` are ignored.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (va.release[i] !== vb.release[i]) return va.release[i] < vb.release[i] ? -1 : 1;
  }
  // Equal release. A version with a prerelease has lower precedence than one without.
  if (va.prerelease.length === 0 && vb.prerelease.length === 0) return 0;
  if (va.prerelease.length === 0) return 1;
  if (vb.prerelease.length === 0) return -1;
  const len = Math.max(va.prerelease.length, vb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ia = va.prerelease[i];
    const ib = vb.prerelease[i];
    if (ia === undefined) return -1; // shorter prerelease set is lower
    if (ib === undefined) return 1;
    const c = compareIdentifiers(ia, ib);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Look up the latest published version on the npm registry. Best-effort: returns
 * `null` on any failure (offline, timeout, non-OK, missing field) so callers can
 * still report the installed version. `fetchImpl` is injectable for tests.
 */
export async function fetchLatestVersion(
  pkgName: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${pkgName}/latest`, {
      signal: controller.signal,
      // The abbreviated metadata document is far smaller than the full packument.
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the human-readable `--version` report from the installed version and the
 * latest published one (or `null` if the registry couldn't be reached).
 */
export function formatVersionReport(installed: string, latest: string | null): string {
  const head = `${PACKAGE_NAME} ${installed}`;
  if (!latest) {
    return `${head}\n(could not check for updates — offline or registry unreachable)`;
  }
  const cmp = compareVersions(installed, latest);
  if (cmp < 0) {
    return [
      head,
      `Update available: ${latest} (you have ${installed}).`,
      `Upgrade: npm install -g ${PACKAGE_NAME}@latest`,
      `Or just re-run via: npx -y ${PACKAGE_NAME}@latest`,
    ].join("\n");
  }
  if (cmp > 0) {
    return `${head}\n(ahead of the latest published release ${latest})`;
  }
  return `${head} (latest)`;
}
