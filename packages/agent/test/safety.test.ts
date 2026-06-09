import { describe, it, expect } from "vitest";

import { requireConfirm, isGated, GATED_TOOLS, CONFIRM_REQUIRED_PREFIX } from "../src/safety";

describe("safety", () => {
  it("lists the destructive/outward tools", () => {
    expect(GATED_TOOLS).toContain("delete_form");
    expect(GATED_TOOLS).toContain("submit_form_response");
    expect(GATED_TOOLS).toContain("rsvp_event");
    expect(GATED_TOOLS).toContain("delete_file");
    expect(GATED_TOOLS).toContain("rename_file");
    expect(GATED_TOOLS).toContain("move_file");
    expect(GATED_TOOLS).not.toContain("create_form");
  });

  it("isGated identifies gated vs un-gated tools", () => {
    expect(isGated("delete_form")).toBe(true);
    expect(isGated("create_form")).toBe(false);
  });

  it("blocks a gated call without confirm and describes the effect", () => {
    const blocked = requireConfirm("delete_form", { confirm: false }, "deletes form abc");
    expect(blocked).not.toBeNull();
    expect(blocked!.ok).toBe(false);
    expect(JSON.stringify(blocked)).toMatch(/confirm/i);
    expect(JSON.stringify(blocked)).toMatch(/deletes form abc/);
  });

  it("allows a gated call when confirm is true", () => {
    expect(requireConfirm("delete_form", { confirm: true }, "deletes form abc")).toBeNull();
  });
});

describe("CONFIRM_REQUIRED_PREFIX", () => {
  it("prefixes every requireConfirm rejection", () => {
    const blocked = requireConfirm("delete_form", {}, "deletes form f1");
    expect(blocked).not.toBeNull();
    expect(blocked!.ok).toBe(false);
    expect(blocked!.text.startsWith(CONFIRM_REQUIRED_PREFIX)).toBe(true);
  });
});
