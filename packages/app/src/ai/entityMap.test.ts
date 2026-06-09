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

  it("maps create_page / save_private_note to a pages entity via address", () => {
    expect(
      entityFromTool("save_private_note", { title: "Note" }, { address: "30023:pk:n1" }),
    ).toEqual({ module: "pages", ref: "30023:pk:n1", label: "Note", route: "/pages" });
  });

  it("maps create_poll to a polls entity via id", () => {
    expect(entityFromTool("create_poll", { question: "Lunch?" }, { id: "p1" })).toEqual({
      module: "polls",
      ref: "p1",
      label: "Lunch?",
      route: "/polls",
    });
  });

  it("returns null for reads and deletes", () => {
    expect(entityFromTool("list_forms", {}, { forms: [] })).toBeNull();
    expect(entityFromTool("delete_poll", { pollId: "p1" }, undefined)).toBeNull();
  });

  it("returns null when the data lacks a usable ref", () => {
    expect(entityFromTool("create_form", { name: "X" }, {})).toBeNull();
  });
});
