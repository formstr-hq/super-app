import { describe, it, expect } from "vitest";

import { isFullBleedRoute } from "./fullBleed";

describe("isFullBleedRoute", () => {
  it("treats the calendar route as full-bleed", () => {
    expect(isFullBleedRoute("/calendar")).toBe(true);
    expect(isFullBleedRoute("/calendar/")).toBe(true);
    expect(isFullBleedRoute("/calendar/anything")).toBe(true);
  });

  it("treats the pages route as full-bleed", () => {
    expect(isFullBleedRoute("/pages")).toBe(true);
    expect(isFullBleedRoute("/pages/")).toBe(true);
    expect(isFullBleedRoute("/pages/naddr1abc")).toBe(true);
  });

  it("keeps other routes in the centered container", () => {
    expect(isFullBleedRoute("/")).toBe(false);
    expect(isFullBleedRoute("/forms")).toBe(false);
    expect(isFullBleedRoute("/calendarx")).toBe(false);
    expect(isFullBleedRoute("/pagesx")).toBe(false);
  });
});
