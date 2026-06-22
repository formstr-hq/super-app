import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  readInstalledVersion,
  compareVersions,
  fetchLatestVersion,
  formatVersionReport,
} from "../src/version";

describe("readInstalledVersion", () => {
  it("returns the version from the package's package.json", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(readInstalledVersion()).toBe(pkg.version);
    expect(readInstalledVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("compareVersions", () => {
  it("orders by numeric major/minor/patch (not lexically)", () => {
    expect(compareVersions("0.3.0", "0.3.2")).toBe(-1);
    expect(compareVersions("0.3.2", "0.3.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    // 10 > 9 numerically (a lexical compare would get this wrong)
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
  });

  it("treats a prerelease as lower than its release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
  });

  it("ignores leading 'v' and build metadata", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3+build.5", "1.2.3")).toBe(0);
  });
});

describe("fetchLatestVersion", () => {
  it("returns the version field from a successful registry response", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await fetchLatestVersion("@formstr/mcp", { fetchImpl })).toBe("9.9.9");
  });

  it("returns null on a non-OK response", async () => {
    const fetchImpl = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion("@formstr/mcp", { fetchImpl })).toBeNull();
  });

  it("returns null when the request throws (offline)", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    expect(await fetchLatestVersion("@formstr/mcp", { fetchImpl })).toBeNull();
  });

  it("returns null when the payload has no version", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ name: "x" }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLatestVersion("@formstr/mcp", { fetchImpl })).toBeNull();
  });
});

describe("formatVersionReport", () => {
  it("flags an available update with the upgrade command", () => {
    const report = formatVersionReport("0.3.2", "0.4.0");
    expect(report).toContain("0.3.2");
    expect(report).toContain("0.4.0");
    expect(report.toLowerCase()).toContain("update available");
    expect(report).toContain("@formstr/mcp@latest");
  });

  it("reports being up to date when installed equals latest", () => {
    const report = formatVersionReport("0.3.2", "0.3.2");
    expect(report).toContain("0.3.2");
    expect(report.toLowerCase()).toContain("latest");
    expect(report.toLowerCase()).not.toContain("update available");
  });

  it("notes when the update check could not run", () => {
    const report = formatVersionReport("0.3.2", null);
    expect(report).toContain("0.3.2");
    expect(report.toLowerCase()).toContain("update");
    expect(report.toLowerCase()).not.toContain("update available");
  });

  it("notes when installed is ahead of the latest published release", () => {
    const report = formatVersionReport("0.4.0", "0.3.2");
    expect(report).toContain("0.4.0");
    expect(report.toLowerCase()).toContain("ahead");
  });
});
