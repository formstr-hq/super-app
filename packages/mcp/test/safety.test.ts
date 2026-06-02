import { describe, it, expect } from "vitest";

import { requireConfirm, GATED_TOOLS } from "../src/safety";

describe("safety", () => {
  it("lists the destructive/outward tools", () => {
    expect(GATED_TOOLS).toContain("delete_form");
    expect(GATED_TOOLS).toContain("submit_form_response");
    expect(GATED_TOOLS).toContain("rsvp_event");
    expect(GATED_TOOLS).not.toContain("create_form");
  });

  it("blocks a gated call without confirm and describes the effect", () => {
    const blocked = requireConfirm("delete_form", { confirm: false }, "deletes form abc");
    expect(blocked).not.toBeNull();
    expect(blocked!.isError).toBe(true);
    expect(JSON.stringify(blocked)).toMatch(/confirm/i);
    expect(JSON.stringify(blocked)).toMatch(/deletes form abc/);
  });

  it("allows a gated call when confirm is true", () => {
    expect(requireConfirm("delete_form", { confirm: true }, "deletes form abc")).toBeNull();
  });
});
