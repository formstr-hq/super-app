import type { FormSummary, FormTemplate, FormResponseEvent } from "@formstr/agent/services/forms";
import * as formsService from "@formstr/agent/services/forms/service";
import type { SubscriptionHandle } from "@formstr/core";
import { create } from "zustand";

let responsesSub: SubscriptionHandle | null = null;

interface FormsStore {
  myForms: FormSummary[];
  currentForm: FormTemplate | null;
  responses: FormResponseEvent[];
  isLoading: boolean;
  error: string | null;

  fetchMyForms(): Promise<void>;
  loadForm(pubkey: string, formId: string): Promise<void>;
  loadResponses(pubkey: string, formId: string): Promise<void>;
  createForm(params: formsService.CreateFormParams): Promise<formsService.CreateFormResult>;
  deleteForm(formId: string, formPubkey: string): Promise<void>;
  clearCurrent(): void;
}

export const useFormsStore = create<FormsStore>((set, get) => ({
  myForms: [],
  currentForm: null,
  responses: [],
  isLoading: false,
  error: null,

  async fetchMyForms() {
    set({ isLoading: true, error: null });
    try {
      const forms = await formsService.fetchMyForms();
      set({ myForms: forms, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch forms", isLoading: false });
    }
  },

  async loadForm(pubkey, formId) {
    set({ isLoading: true, error: null, currentForm: null });
    try {
      // Look up viewKey for this form from the cached list
      const summary = get().myForms.find((f) => f.pubkey === pubkey && f.id === formId);
      const form = await formsService.fetchForm(pubkey, formId, summary?.viewKey);
      set({ currentForm: form, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load form", isLoading: false });
    }
  },

  loadResponses(pubkey, formId) {
    if (responsesSub) {
      responsesSub.unsub();
      responsesSub = null;
    }
    set({ isLoading: true, error: null, responses: [] });
    const summary = get().myForms.find((f) => f.pubkey === pubkey && f.id === formId);
    responsesSub = formsService.subscribeToResponses(
      pubkey,
      formId,
      (resp) =>
        set((state) =>
          state.responses.some((r) => r.id === resp.id)
            ? state
            : { responses: [...state.responses, resp] },
        ),
      () => set({ isLoading: false }),
      summary?.signingKey,
    );
    return Promise.resolve();
  },

  async createForm(params) {
    set({ error: null });
    try {
      const result = await formsService.createForm(params);
      const newSummary: FormSummary = {
        id: result.formId,
        name: params.name,
        pubkey: result.pubkey,
        createdAt: Math.floor(Date.now() / 1000),
        isEncrypted: !!params.encrypt,
        signingKey: result.signingKey,
        viewKey: result.viewKey,
      };
      set((state) => ({ myForms: [...state.myForms, newSummary] }));
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create form" });
      throw e;
    }
  },

  async deleteForm(formId, formPubkey) {
    try {
      await formsService.deleteForm(formId, formPubkey);
      set((state) => ({
        myForms: state.myForms.filter((f) => !(f.id === formId && f.pubkey === formPubkey)),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete form" });
    }
  },

  clearCurrent() {
    if (responsesSub) {
      responsesSub.unsub();
      responsesSub = null;
    }
    set({ currentForm: null, responses: [] });
  },
}));
