import { describe, it, expect } from "vitest";

import { mapMethod } from "../src/auth/methodMap";

describe("mapMethod", () => {
  it("maps the headless-reachable methods to core SignerMethod", () => {
    expect(mapMethod("ncryptsec")).toBe("local");
    expect(mapMethod("nip46")).toBe("nip46");
  });

  it("maps the remaining LoginMethods for exhaustiveness", () => {
    expect(mapMethod("extension")).toBe("nip07");
    expect(mapMethod("android")).toBe("nip55");
  });
});
