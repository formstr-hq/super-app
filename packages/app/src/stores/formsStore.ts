import { create } from "zustand";

import type { FormSummary, FormTemplate, FormResponseEvent } from "../services/forms";
import * as formsService from "../services/forms/service";

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

export const useFormsStore = create<FormsStore>((set) => ({
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

  async loadForm(pubkey: string, formId: string) {
    set({ isLoading: true, error: null, currentForm: null });
    try {
      const form = await formsService.fetchForm(pubkey, formId);
      set({ currentForm: form, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load form", isLoading: false });
    }
  },

  async loadResponses(pubkey: string, formId: string) {
    set({ isLoading: true, error: null });
    try {
      const responses = await formsService.fetchResponses(pubkey, formId);
      set({ responses, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load responses", isLoading: false });
    }
  },

  async createForm(params) {
    set({ error: null });
    try {
      const result = await formsService.createForm(params);

      // Build a summary for the newly created form
      const newSummary: FormSummary = {
        id: result.formId,
        name: params.name,
        pubkey: result.pubkey,
        createdAt: Math.floor(Date.now() / 1000),
        isEncrypted: !!params.encrypt,
      };

      // Optimistically add to local state
      const updatedForms = [...useFormsStore.getState().myForms, newSummary];
      set({ myForms: updatedForms });

      // Persist the updated index to Nostr (kind 14083)
      await formsService.saveToMyForms(updatedForms).catch(() => {
        // Non-fatal: form was published, index update can be retried
      });

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
    set({ currentForm: null, responses: [] });
  },
}));
