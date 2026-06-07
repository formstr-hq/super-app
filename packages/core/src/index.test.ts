import { describe, it, expect } from "vitest";

import * as core from "./index";

describe("@formstr/core exports", () => {
  it("exports SignerManager", () => {
    expect(core.SignerManager).toBeDefined();
    expect(core.signerManager).toBeDefined();
  });

  it("exports crypto helpers", () => {
    expect(core.nip44Encrypt).toBeTypeOf("function");
    expect(core.wrapEvent).toBeTypeOf("function");
    expect(core.encryptFileWithKey).toBeTypeOf("function");
    expect(core.decryptFileWithKey).toBeTypeOf("function");
  });

  it("exports relay + runtime singletons", () => {
    expect(core.relayManager).toBeDefined();
    expect(core.nostrRuntime).toBeDefined();
  });

  it("exports linking helpers", () => {
    expect(core.createRef).toBeTypeOf("function");
    expect(core.parseRef).toBeTypeOf("function");
  });
});
