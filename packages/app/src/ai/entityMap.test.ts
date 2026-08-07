import { describe, it, expect } from "vitest";

import { entityFromTool } from "./entityMap";

describe("entityFromTool", () => {
  it("maps create_form to a forms entity using the naddr", () => {
    const e = entityFromTool(
      "create_form",
      { name: "Survey" },
      { naddr: "naddr1abc", formId: "f1" },
    );
    expect(e).toEqual({ module: "forms", ref: "naddr1abc", label: "Survey", route: "/forms" });
  });

  it("maps create_calendar_event using eventId, then coordinate fallback", () => {
    expect(
      entityFromTool(
        "create_calendar_event",
        { title: "Lunch" },
        { eventId: "e1", coordinate: "31923:pk:e1" },
      ),
    ).toEqual({ module: "calendar", ref: "e1", label: "Lunch", route: "/calendar" });
    expect(entityFromTool("update_calendar_event", {}, { coordinate: "31923:pk:e9" })).toEqual({
      module: "calendar",
      ref: "31923:pk:e9",
      label: "31923:pk:e9",
      route: "/calendar",
    });
  });

  it("returns null for pages and polls tools, which the app no longer routes to", () => {
    // They stay in the agent registry for the MCP server, but this app filters
    // them out before the model ever sees them — so an entity here would point
    // at a route that redirects away.
    expect(
      entityFromTool("save_private_note", { title: "Note" }, { address: "30023:pk:n1" }),
    ).toBeNull();
    expect(entityFromTool("create_poll", { question: "Lunch?" }, { id: "p1" })).toBeNull();
  });

  it("returns null for reads and deletes", () => {
    expect(entityFromTool("list_forms", {}, { forms: [] })).toBeNull();
    expect(entityFromTool("delete_form", { formId: "f1" }, undefined)).toBeNull();
  });

  it("returns null when the data lacks a usable ref", () => {
    expect(entityFromTool("create_form", { name: "X" }, {})).toBeNull();
  });
});
