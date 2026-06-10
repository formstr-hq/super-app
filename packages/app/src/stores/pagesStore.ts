import type {
  PageComment,
  PageCommentDraft,
  PageDocument,
  PageSummary,
  SharedPageEntry,
  ShareResult,
} from "@formstr/agent/services/pages";
import * as pagesComments from "@formstr/agent/services/pages/comments";
import * as pagesService from "@formstr/agent/services/pages/service";
import type { SavePageParams } from "@formstr/agent/services/pages/service";
import { decodeNKeys } from "@formstr/core";
import { nip19 } from "nostr-tools";
import { create } from "zustand";

const VIEW_KEY_PREFIX = "formstr:page-viewkey:";
const EDIT_KEY_PREFIX = "formstr:page-editkey:";

function persistViewKey(address: string, viewKey?: string, editKey?: string) {
  if (viewKey) localStorage.setItem(`${VIEW_KEY_PREFIX}${address}`, viewKey);
  if (editKey) localStorage.setItem(`${EDIT_KEY_PREFIX}${address}`, editKey);
}
function getViewKey(address: string): string | undefined {
  return localStorage.getItem(`${VIEW_KEY_PREFIX}${address}`) ?? undefined;
}
function getEditKey(address: string): string | undefined {
  return localStorage.getItem(`${EDIT_KEY_PREFIX}${address}`) ?? undefined;
}
/** All locally-known address → viewKey pairs (for decrypting the owner's own shared docs). */
function allViewKeys(): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(VIEW_KEY_PREFIX)) {
      const v = localStorage.getItem(key);
      if (v) map.set(key.slice(VIEW_KEY_PREFIX.length), v);
    }
  }
  return map;
}

interface PagesStore {
  pages: PageSummary[];
  sharedPages: PageSummary[];
  currentPage: PageDocument | null;
  /** Kind-1494 comments on the current page (oldest first; viewKey docs only). */
  comments: PageComment[];
  isLoadingComments: boolean;
  tagsByAddress: Record<string, string[]>;
  activeTag: string | null;
  isLoading: boolean;
  error: string | null;

  fetchMyPages(): Promise<void>;
  fetchSharedPages(): Promise<void>;
  loadPage(pubkey: string, docId: string, viewKey?: string): Promise<void>;
  /** Open a `/pages/<naddr>#<nkeys>` share link: load + record it (upstream DocPage). */
  openSharedLink(naddr: string, hashFragment: string): Promise<void>;
  savePage(params: SavePageParams): Promise<PageDocument>;
  deletePage(address: string): Promise<void>;
  sharePage(canEdit: boolean): Promise<ShareResult | null>;
  setTags(address: string, tags: string[]): Promise<void>;
  setActiveTag(tag: string | null): void;
  clearCurrent(): void;
  /** Refresh the current page's comments; clears them when the doc has no viewKey. */
  loadComments(): Promise<void>;
  /** Publish a comment on the current page; false when it has no viewKey/event yet. */
  addComment(draft: PageCommentDraft): Promise<boolean>;
}

export const usePagesStore = create<PagesStore>((set, get) => ({
  pages: [],
  sharedPages: [],
  currentPage: null,
  comments: [],
  isLoadingComments: false,
  tagsByAddress: {},
  activeTag: null,
  isLoading: false,
  error: null,

  async fetchMyPages() {
    set({ isLoading: true, error: null });
    try {
      const pages = await pagesService.fetchMyPages(allViewKeys());
      const tagMap = await pagesService.fetchDocTags(pages.map((p) => p.address));
      const tagsByAddress: Record<string, string[]> = {};
      for (const [addr, tags] of tagMap) tagsByAddress[addr] = tags;
      set((state) => ({
        pages: pages.map((p) => ({ ...p, tags: tagsByAddress[p.address] })),
        tagsByAddress: { ...state.tagsByAddress, ...tagsByAddress },
        isLoading: false,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch pages", isLoading: false });
    }
  },

  async fetchSharedPages() {
    try {
      const sharedPages = await pagesService.fetchSharedPages();
      set({ sharedPages });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to fetch shared pages" });
    }
  },

  async loadPage(pubkey, docId, viewKey) {
    set({ isLoading: true, error: null, currentPage: null });
    try {
      const address = `33457:${pubkey}:${docId}`;
      const page = await pagesService.fetchPage(pubkey, docId, viewKey ?? getViewKey(address));
      if (page?.viewKey) persistViewKey(page.address, page.viewKey);
      set({ currentPage: page, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load page", isLoading: false });
    }
  },

  async openSharedLink(naddr, hashFragment) {
    set({ isLoading: true, error: null });
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== "naddr") throw new Error("Not a document link");
      const { pubkey, identifier } = decoded.data;

      let viewKey: string | undefined;
      let editKey: string | undefined;
      const fragment = hashFragment.replace(/^#/, "");
      if (fragment) {
        try {
          const keys = decodeNKeys(fragment);
          viewKey = keys.viewKey;
          editKey = keys.editKey;
        } catch {
          /* plain naddr link without keys */
        }
      }

      const address = `33457:${pubkey}:${identifier}`;
      const page = await pagesService.fetchPage(pubkey, identifier, viewKey);
      if (!page) throw new Error("Shared page not found");

      if (viewKey) {
        persistViewKey(address, viewKey, editKey);
        // Record the grant in doc metadata so it roams across devices and to
        // pages.formstr.app (upstream addSharedDoc).
        const entry: SharedPageEntry = editKey ? [address, viewKey, editKey] : [address, viewKey];
        try {
          await pagesService.addSharedPage(entry);
        } catch {
          /* best-effort; the page still opens locally */
        }
      }

      set({ currentPage: { ...page, editKey }, isLoading: false });
      void get().fetchSharedPages();
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to open shared link",
        isLoading: false,
      });
    }
  },

  async savePage(params) {
    set({ isLoading: true, error: null });
    try {
      const page = await pagesService.savePage(params);
      persistViewKey(page.address, page.viewKey, page.editKey);
      const pages = await pagesService.fetchMyPages(allViewKeys());
      set((state) => ({
        currentPage: page,
        pages: pages.map((p) => ({ ...p, tags: state.tagsByAddress[p.address] })),
        isLoading: false,
      }));
      return page;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to save page", isLoading: false });
      throw e;
    }
  },

  async deletePage(address) {
    try {
      await pagesService.deletePage(address);
      localStorage.removeItem(`${VIEW_KEY_PREFIX}${address}`);
      localStorage.removeItem(`${EDIT_KEY_PREFIX}${address}`);
      set((state) => ({
        pages: state.pages.filter((p) => p.address !== address),
        currentPage: state.currentPage?.address === address ? null : state.currentPage,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete page" });
    }
  },

  async sharePage(canEdit) {
    const page = get().currentPage;
    if (!page) return null;
    try {
      const result = await pagesService.sharePage({
        address: page.address,
        content: page.content,
        canEdit,
        viewKey: page.viewKey ?? getViewKey(page.address),
        editKey: page.editKey ?? getEditKey(page.address),
      });
      persistViewKey(result.address, result.viewKey, result.editKey);
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to share page" });
      return null;
    }
  },

  async setTags(address, tags) {
    try {
      await pagesService.setDocTags(address, tags);
      set((state) => ({
        tagsByAddress: { ...state.tagsByAddress, [address]: tags },
        pages: state.pages.map((p) => (p.address === address ? { ...p, tags } : p)),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to save tags" });
    }
  },

  setActiveTag(tag) {
    set({ activeTag: tag });
  },

  clearCurrent() {
    set({ currentPage: null, comments: [] });
  },

  async loadComments() {
    const page = get().currentPage;
    const viewKey = page?.viewKey ?? (page ? getViewKey(page.address) : undefined);
    if (!page || !viewKey) {
      set({ comments: [] });
      return;
    }
    set({ isLoadingComments: true });
    try {
      const comments = await pagesComments.fetchPageComments(page.address, viewKey);
      set({ comments, isLoadingComments: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load comments",
        isLoadingComments: false,
      });
    }
  },

  async addComment(draft) {
    const page = get().currentPage;
    const viewKey = page?.viewKey ?? (page ? getViewKey(page.address) : undefined);
    const eventId = page?.event?.id;
    if (!page || !viewKey || !eventId) return false;
    try {
      const event = await pagesComments.publishPageComment(draft, viewKey, page.address, eventId);
      const comment: PageComment = {
        ...draft,
        id: event.id,
        author: event.pubkey,
        createdAt: event.created_at,
      };
      set((state) => ({ comments: [...state.comments, comment] }));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to publish comment" });
      return false;
    }
  },
}));
