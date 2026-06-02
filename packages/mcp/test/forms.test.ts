import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/app/services", () => ({
  forms: {
    createForm: vi.fn(),
    fetchMyForms: vi.fn(),
    saveToMyForms: vi.fn(),
    fetchForm: vi.fn(),
    fetchResponses: vi.fn(),
    deleteForm: vi.fn(),
    submitResponse: vi.fn(),
  },
}));

import { forms } from "@formstr/app/services";

import { registerForms } from "../src/tools/forms";

function fakeServer() {
  const tools = new Map<string, { handler: (a: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (a: any) => Promise<any>) =>
      tools.set(name, { handler }),
  } as any;
  return { server, tools };
}

describe("forms tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers read+create tools without writes; gated tools only with writes", () => {
    const ro = fakeServer();
    registerForms(ro.server, { allowWrites: false });
    expect(ro.tools.has("list_forms")).toBe(true);
    expect(ro.tools.has("create_form")).toBe(true);
    expect(ro.tools.has("delete_form")).toBe(false);

    const rw = fakeServer();
    registerForms(rw.server, { allowWrites: true });
    expect(rw.tools.has("delete_form")).toBe(true);
    expect(rw.tools.has("submit_form_response")).toBe(true);
  });

  it("create_form creates then persists to the forms list", async () => {
    (forms.createForm as any).mockResolvedValue({
      formId: "abc",
      pubkey: "pk",
      signingKey: "sk",
      viewKey: "vk",
    });
    (forms.fetchMyForms as any).mockResolvedValue([]);
    const { server, tools } = fakeServer();
    registerForms(server, { allowWrites: false });

    const res = await tools.get("create_form")!.handler({
      name: "Survey",
      fields: [{ label: "Q1", type: "shortText" }],
      encrypted: true,
    });

    expect(forms.createForm).toHaveBeenCalledOnce();
    expect(forms.saveToMyForms).toHaveBeenCalledOnce();
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.formId).toBe("abc");
  });

  it("delete_form requires confirm", async () => {
    const { server, tools } = fakeServer();
    registerForms(server, { allowWrites: true });
    const blocked = await tools.get("delete_form")!.handler({ formId: "abc", formPubkey: "pk" });
    expect(blocked.isError).toBe(true);
    expect(forms.deleteForm).not.toHaveBeenCalled();

    const okRes = await tools
      .get("delete_form")!
      .handler({ formId: "abc", formPubkey: "pk", confirm: true });
    expect(forms.deleteForm).toHaveBeenCalledWith("abc", "pk");
    expect(okRes.isError).toBeFalsy();
  });
});
