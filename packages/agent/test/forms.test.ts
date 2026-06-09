import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services", () => ({
  forms: {
    createForm: vi.fn(),
    fetchMyForms: vi.fn().mockResolvedValue([]),
    fetchForm: vi.fn(),
    fetchResponses: vi.fn().mockResolvedValue([]),
    deleteForm: vi.fn(),
    submitResponse: vi.fn(),
    updateForm: vi.fn(),
    shareForm: vi.fn().mockResolvedValue({ published: 0, failed: [] }),
    fetchFormSummaryFromRef: vi.fn(),
    importForm: vi.fn(),
  },
  FORM_KINDS: { template: 30168, response: 1069, myFormsList: 14083 },
  AnswerType: { shortText: "shortText" },
}));

import { forms } from "../src/services";
import { formsTools } from "../src/tools/forms";
import type { ToolCtx } from "../src/tools/types";

const byName = (name: string) => formsTools.find((t) => t.name === name)!;
const RW: ToolCtx = { allowWrites: true };

describe("forms tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks reads/creates as non-write and destructive tools as write", () => {
    expect(byName("list_forms").write).toBeFalsy();
    expect(byName("create_form").write).toBeFalsy();
    expect(byName("import_form_from_naddr").write).toBeFalsy();
    expect(byName("delete_form").write).toBe(true);
    expect(byName("update_form").write).toBe(true);
    expect(byName("share_form").write).toBe(true);
    expect(byName("submit_form_response").write).toBe(true);
  });

  it("create_form creates the form", async () => {
    (forms.createForm as any).mockResolvedValue({
      formId: "abc",
      pubkey: "pk",
      signingKey: "sk",
      viewKey: "vk",
    });

    const res = await byName("create_form").handler(
      {
        name: "Survey",
        fields: [{ label: "Q1", type: "shortText" }],
        encrypted: true,
      },
      RW,
    );

    expect(forms.createForm).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    expect((res.data as any).formId).toBe("abc");
  });

  it("delete_form requires confirm", async () => {
    const blocked = await byName("delete_form").handler({ formId: "abc", formPubkey: "pk" }, RW);
    expect(blocked.ok).toBe(false);
    expect(blocked.text).toMatch(/confirm/i);
    expect(forms.deleteForm).not.toHaveBeenCalled();

    const okRes = await byName("delete_form").handler(
      { formId: "abc", formPubkey: "pk", confirm: true },
      RW,
    );
    expect(forms.deleteForm).toHaveBeenCalledWith("abc", "pk");
    expect(okRes.ok).toBe(true);
  });
});
