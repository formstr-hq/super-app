import { describe, expect, it } from "vitest";

import { shortCardKey } from "./cardKey";

describe("shortCardKey", () => {
  it("leaves a short, readable id alone", () => {
    expect(shortCardKey("login-bug")).toBe("login-bug");
  });

  it("collapses a long id to first and last four", () => {
    expect(shortCardKey("9b17d4c8e2f04a6b")).toBe("9b17·4a6b");
  });

  it("trims surrounding whitespace before measuring", () => {
    expect(shortCardKey("  abc  ")).toBe("abc");
  });
});
