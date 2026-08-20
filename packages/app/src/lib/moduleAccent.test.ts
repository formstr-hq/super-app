import { describe, it, expect } from "vitest";

import {
  ACCENT_MODULES,
  accentInk,
  accentVars,
  moduleForPath,
  type AccentModule,
} from "./moduleAccent";

describe("moduleForPath", () => {
  it("maps each module route to its module", () => {
    expect(moduleForPath("/forms")).toBe("forms");
    expect(moduleForPath("/calendar")).toBe("calendar");
    expect(moduleForPath("/kanban")).toBe("kanban");
    expect(moduleForPath("/drive")).toBe("drive");
  });

  it("maps nested routes to their module", () => {
    expect(moduleForPath("/kanban/30301:9f2c:hii")).toBe("kanban");
    expect(moduleForPath("/forms/fill/naddr1abc")).toBe("forms");
  });

  it("returns null off the modules", () => {
    expect(moduleForPath("/settings")).toBeNull();
    expect(moduleForPath("/")).toBeNull();
  });

  it("does not match a route that merely starts with a module name", () => {
    expect(moduleForPath("/formstr")).toBeNull();
  });
});

describe("accentInk", () => {
  it("gives every module a distinct ink in both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      const inks = ACCENT_MODULES.map((m) => accentInk(m, mode));
      expect(new Set(inks).size).toBe(ACCENT_MODULES.length);
      inks.forEach((ink) => expect(ink).toMatch(/^#[0-9A-F]{6}$/i));
    }
  });

  it("lifts the ink for dark mode rather than reusing the light one", () => {
    for (const m of ACCENT_MODULES) {
      expect(accentInk(m, "dark")).not.toBe(accentInk(m, "light"));
    }
  });

  it("falls back to a neutral when there is no module", () => {
    expect(accentInk(null, "light")).toMatch(/^#[0-9A-F]{6}$/i);
    expect(accentInk(null, "dark")).not.toBe(accentInk(null, "light"));
  });
});

describe("accentVars", () => {
  it("derives tint, wash and line from the same ink", () => {
    const vars = accentVars("kanban", "light");
    expect(vars["--fs-accent"]).toBe(accentInk("kanban", "light"));
    // #A31E63 → 163, 30, 99
    expect(vars["--fs-accent-tint"]).toBe("rgba(163, 30, 99, 0.12)");
    expect(vars["--fs-accent-wash"]).toBe("rgba(163, 30, 99, 0.06)");
    expect(vars["--fs-accent-line"]).toBe("rgba(163, 30, 99, 0.28)");
  });

  it("defines the same variable set for every module and for none", () => {
    const keys = Object.keys(accentVars("forms", "light")).sort();
    const targets: (AccentModule | null)[] = [...ACCENT_MODULES, null];
    for (const m of targets) {
      expect(Object.keys(accentVars(m, "dark")).sort()).toEqual(keys);
    }
  });
});
