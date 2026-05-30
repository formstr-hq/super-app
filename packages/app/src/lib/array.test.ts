import { describe, it, expect } from "vitest";

import { moveItem } from "./array";

describe("moveItem", () => {
  it("moves an item from one index to another (forward)", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns an equal array when from === to", () => {
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const input = ["a", "b", "c"];
    const out = moveItem(input, 0, 1);
    expect(out).not.toBe(input);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns a copy when indices are out of range", () => {
    expect(moveItem(["a", "b"], -1, 5)).toEqual(["a", "b"]);
  });
});
