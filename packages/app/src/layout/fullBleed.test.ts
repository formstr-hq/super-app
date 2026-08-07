import { describe, it, expect } from "vitest";

import { isFullBleedRoute } from "./fullBleed";

describe("isFullBleedRoute", () => {
  it("treats the calendar route as full-bleed", () => {
    expect(isFullBleedRoute("/calendar")).toBe(true);
    expect(isFullBleedRoute("/calendar/")).toBe(true);
    expect(isFullBleedRoute("/calendar/anything")).toBe(true);
  });

  it("treats the kanban route as full-bleed", () => {
    expect(isFullBleedRoute("/kanban")).toBe(true);
    expect(isFullBleedRoute("/kanban/")).toBe(true);
    expect(isFullBleedRoute("/kanban/30301%3Apk%3Aboard")).toBe(true);
  });

  it("no longer treats the removed pages and polls routes as full-bleed", () => {
    // Both redirect to /forms now; the redirect target supplies the layout.
    expect(isFullBleedRoute("/pages")).toBe(false);
    expect(isFullBleedRoute("/polls")).toBe(false);
  });

  it("treats the drive route as full-bleed", () => {
    expect(isFullBleedRoute("/drive")).toBe(true);
    expect(isFullBleedRoute("/drive/")).toBe(true);
    expect(isFullBleedRoute("/drive/work")).toBe(true);
  });

  it("treats the forms route as full-bleed", () => {
    expect(isFullBleedRoute("/forms")).toBe(true);
    expect(isFullBleedRoute("/forms/")).toBe(true);
  });

  it("keeps other routes in the centered container", () => {
    expect(isFullBleedRoute("/")).toBe(false);
    expect(isFullBleedRoute("/calendarx")).toBe(false);
    expect(isFullBleedRoute("/kanbanx")).toBe(false);
    expect(isFullBleedRoute("/drivex")).toBe(false);
    expect(isFullBleedRoute("/formsx")).toBe(false);
  });
});
