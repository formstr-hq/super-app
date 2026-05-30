import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/forms/service", () => ({
  fetchMyForms: vi.fn(),
  fetchForm: vi.fn(),
  fetchResponses: vi.fn(),
  createForm: vi.fn(),
  deleteForm: vi.fn(),
  saveToMyForms: vi.fn(),
}));

import * as formsService from "../services/forms/service";

import { useFormsStore } from "./formsStore";

beforeEach(() => {
  vi.clearAllMocks();
  useFormsStore.setState({
    myForms: [],
    currentForm: null,
    responses: [],
    isLoading: false,
    error: null,
  });
});

describe("fetchMyForms", () => {
  it("populates myForms with signingKey and viewKey from service", async () => {
    (formsService.fetchMyForms as any).mockResolvedValue([
      {
        id: "f1",
        name: "Form",
        pubkey: "pub",
        createdAt: 0,
        isEncrypted: true,
        signingKey: "sk",
        viewKey: "vk",
      },
    ]);

    await useFormsStore.getState().fetchMyForms();

    const { myForms, isLoading } = useFormsStore.getState();
    expect(myForms).toHaveLength(1);
    expect(myForms[0].signingKey).toBe("sk");
    expect(myForms[0].viewKey).toBe("vk");
    expect(isLoading).toBe(false);
  });
});

describe("loadForm", () => {
  it("passes viewKey from myForms to fetchForm", async () => {
    useFormsStore.setState({
      myForms: [
        {
          id: "f1",
          name: "Form",
          pubkey: "pub",
          createdAt: 0,
          isEncrypted: true,
          signingKey: "sk",
          viewKey: "vk",
        },
      ],
    });
    (formsService.fetchForm as any).mockResolvedValue({
      id: "f1",
      name: "Form",
      fields: [],
      isEncrypted: true,
      pubkey: "pub",
      settings: {},
      createdAt: 0,
    });

    await useFormsStore.getState().loadForm("pub", "f1");

    expect(formsService.fetchForm).toHaveBeenCalledWith("pub", "f1", "vk");
  });

  it("passes undefined viewKey when form is not in myForms", async () => {
    (formsService.fetchForm as any).mockResolvedValue({
      id: "f2",
      name: "Unknown",
      fields: [],
      isEncrypted: false,
      pubkey: "pub",
      settings: {},
      createdAt: 0,
    });

    await useFormsStore.getState().loadForm("pub", "f2");

    expect(formsService.fetchForm).toHaveBeenCalledWith("pub", "f2", undefined);
  });
});

describe("loadResponses", () => {
  it("passes signingKey from myForms to fetchResponses", async () => {
    useFormsStore.setState({
      myForms: [
        {
          id: "f1",
          name: "Form",
          pubkey: "pub",
          createdAt: 0,
          isEncrypted: true,
          signingKey: "sk",
          viewKey: "vk",
        },
      ],
    });
    (formsService.fetchResponses as any).mockResolvedValue([]);

    await useFormsStore.getState().loadResponses("pub", "f1");

    expect(formsService.fetchResponses).toHaveBeenCalledWith("pub", "f1", "sk");
  });

  it("clears stale responses before fetching", async () => {
    useFormsStore.setState({
      responses: [{ id: "old", pubkey: "x", responses: [], createdAt: 0, event: {} as any }],
    });
    (formsService.fetchResponses as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 10)),
    );

    const loadPromise = useFormsStore.getState().loadResponses("pub", "f1");
    // Immediately after calling, stale responses should be cleared
    expect(useFormsStore.getState().responses).toHaveLength(0);
    await loadPromise;
  });
});

describe("createForm", () => {
  it("adds form with signingKey and viewKey to myForms optimistically", async () => {
    (formsService.createForm as any).mockResolvedValue({
      formId: "f1",
      pubkey: "formpub",
      signingKey: "sk",
      viewKey: "vk",
    });

    await useFormsStore.getState().createForm({ name: "New", fields: [], encrypt: true });

    const { myForms } = useFormsStore.getState();
    expect(myForms).toHaveLength(1);
    expect(myForms[0].signingKey).toBe("sk");
    expect(myForms[0].viewKey).toBe("vk");
    expect(myForms[0].isEncrypted).toBe(true);
  });

  it("throws and sets error on failure", async () => {
    (formsService.createForm as any).mockRejectedValue(new Error("relay offline"));

    await expect(useFormsStore.getState().createForm({ name: "Fail", fields: [] })).rejects.toThrow(
      "relay offline",
    );

    expect(useFormsStore.getState().error).toContain("offline");
  });
});

describe("deleteForm", () => {
  it("removes form from myForms on success", async () => {
    useFormsStore.setState({
      myForms: [{ id: "f1", name: "Form", pubkey: "pub", createdAt: 0, isEncrypted: false }],
    });
    (formsService.deleteForm as any).mockResolvedValue(undefined);

    await useFormsStore.getState().deleteForm("f1", "pub");

    expect(useFormsStore.getState().myForms).toHaveLength(0);
  });

  it("keeps myForms and sets error on failure", async () => {
    useFormsStore.setState({
      myForms: [{ id: "f1", name: "Form", pubkey: "pub", createdAt: 0, isEncrypted: false }],
    });
    (formsService.deleteForm as any).mockRejectedValue(new Error("relay offline"));

    await useFormsStore.getState().deleteForm("f1", "pub");

    expect(useFormsStore.getState().myForms).toHaveLength(1);
    expect(useFormsStore.getState().error).toContain("offline");
  });
});
