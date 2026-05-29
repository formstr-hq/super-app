import { create } from "zustand";
import type { PageDocument, PageSummary, ShareResult } from "../services/pages";
import * as pagesService from "../services/pages/service";

const VIEW_KEY_STORAGE_PREFIX = "formstr:page-viewkey:";

function persistViewKey(address: string, viewKey: string) {
  localStorage.setItem(`${VIEW_KEY_STORAGE_PREFIX}${address}`, viewKey);
}

function getViewKey(address: string): string | undefined {
  return localStorage.getItem(`${VIEW_KEY_STORAGE_PREFIX}${address}`) ?? undefined;
}

interface PagesStore {
  pages: PageSummary[];
  currentPage: PageDocument | null;
  isLoading: boolean;
  error: string | null;

  fetchMyPages(): Promise<void>;
  loadPage(pubkey: string, docId: string, viewKey?: string): Promise<void>;
  savePage(params: pagesService.SavePageParams): Promise<PageDocument>;
  deletePage(address: string): Promise<void>;
  shareCurrentPage(): ShareResult | null;
  sharePage(address: string): ShareResult | null;
  clearCurrent(): void;
}

export const usePagesStore = create<PagesStore>((set, get) => ({
  pages: [],
  currentPage: null,
  isLoading: false,
  error: null,

  async fetchMyPages() {
    set({ isLoading: true, error: null });
    try {
      const pages = await pagesService.fetchMyPages();
      set({ pages, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch pages", isLoading: false });
    }
  },

  async loadPage(pubkey, docId, viewKey) {
    set({ isLoading: true, error: null, currentPage: null });
    try {
      const page = await pagesService.fetchPage(pubkey, docId, viewKey);
      if (page?.viewKey) {
        persistViewKey(page.address, page.viewKey);
      }
      set({ currentPage: page, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load page", isLoading: false });
    }
  },

  async savePage(params) {
    set({ isLoading: true, error: null });
    try {
      const page = await pagesService.savePage(params);
      if (page.viewKey) {
        persistViewKey(page.address, page.viewKey);
      }
      // Also refresh the pages list so new/updated page appears
      const pages = await pagesService.fetchMyPages();
      set({ currentPage: page, pages, isLoading: false });
      return page;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to save page", isLoading: false });
      throw e;
    }
  },

  async deletePage(address) {
    try {
      await pagesService.deletePage(address);
      localStorage.removeItem(`${VIEW_KEY_STORAGE_PREFIX}${address}`);
      set((state) => ({
        pages: state.pages.filter((p) => p.address !== address),
        currentPage: state.currentPage?.address === address ? null : state.currentPage,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete page" });
    }
  },

  shareCurrentPage() {
    const page = get().currentPage;
    if (!page?.viewKey) return null;
    return pagesService.generateShareLink(page.address, page.viewKey, page.editKey);
  },

  sharePage(address) {
    const viewKey = getViewKey(address);
    if (!viewKey) return null;
    return pagesService.generateShareLink(address, viewKey);
  },

  clearCurrent() {
    set({ currentPage: null });
  },
}));
