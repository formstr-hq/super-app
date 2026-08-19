import { describe, expect, it } from "vitest";

import { columnAccent } from "./columnAccent";

describe("columnAccent", () => {
  it("reads the common column names", () => {
    expect(columnAccent("To Do")).toBe("neutral");
    expect(columnAccent("Backlog")).toBe("neutral");
    expect(columnAccent("In Progress")).toBe("progress");
    expect(columnAccent("Doing")).toBe("progress");
    expect(columnAccent("In review")).toBe("review");
    expect(columnAccent("QA")).toBe("review");
    expect(columnAccent("Done")).toBe("done");
    expect(columnAccent("Shipped")).toBe("done");
    expect(columnAccent("Blocked")).toBe("blocked");
  });

  it("is case-insensitive and tolerates surrounding words", () => {
    expect(columnAccent("READY FOR REVIEW")).toBe("review");
    expect(columnAccent("all done ✅")).toBe("done");
  });

  it("prefers blocked over any other match", () => {
    expect(columnAccent("Blocked in review")).toBe("blocked");
  });

  it("does not match inside longer words", () => {
    expect(columnAccent("Redoing")).toBe("neutral");
    expect(columnAccent("Abandoned")).toBe("neutral");
  });
});
