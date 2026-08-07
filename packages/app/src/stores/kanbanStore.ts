import type { BoardDraft, CardDraft, KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { create } from "zustand";

import { boardKey } from "../kanban/boardKey";
import { kanbanSdk } from "../kanban/sdk";

import { useAuthStore } from "./authStore";

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

interface KanbanStore {
  boards: KanbanBoard[];
  /** Cards per board, keyed by `boardKey(board)`. */
  cardsByBoard: Record<string, KanbanCard[]>;
  isLoadingBoards: boolean;
  isLoadingCards: boolean;
  error: string | null;

  clearError(): void;
  fetchBoards(): Promise<void>;
  fetchCards(board: KanbanBoard): Promise<void>;
  createBoard(draft: BoardDraft): Promise<KanbanBoard>;
  updateBoard(board: KanbanBoard, changes: Partial<BoardDraft>): Promise<KanbanBoard>;
  deleteBoard(board: KanbanBoard): Promise<void>;
  createCard(board: KanbanBoard, draft: CardDraft): Promise<KanbanCard>;
  updateCard(
    board: KanbanBoard,
    card: KanbanCard,
    changes: Partial<CardDraft>,
  ): Promise<KanbanCard>;
  deleteCard(board: KanbanBoard, card: KanbanCard): Promise<void>;
  moveCard(
    board: KanbanBoard,
    cardId: string,
    targetStatus: string,
    targetIndex: number,
  ): Promise<void>;
  reset(): void;
}

export const useKanbanStore = create<KanbanStore>((set, get) => ({
  boards: [],
  cardsByBoard: {},
  isLoadingBoards: false,
  isLoadingCards: false,
  error: null,

  clearError() {
    set({ error: null });
  },

  reset() {
    set({ boards: [], cardsByBoard: {}, error: null });
  },

  async fetchBoards() {
    // Public boards are readable without a signer, but this version has no
    // browse-others surface — everything shown is the user's own, so with no
    // pubkey there is nothing to ask for.
    const pubkey = useAuthStore.getState().pubkey;
    if (!pubkey) {
      set({ boards: [], isLoadingBoards: false });
      return;
    }

    set({ isLoadingBoards: true, error: null });
    try {
      // No fetchBoardLists here: fetchPrivateBoards reads the lists itself to
      // recover each board's view key, so asking for them separately is a
      // second round trip for a value nothing in this app reads.
      const [owned, maintained, priv] = await Promise.all([
        kanbanSdk.fetchBoards({ authors: [pubkey] }),
        kanbanSdk.fetchBoards({ maintainedBy: pubkey }),
        kanbanSdk.fetchPrivateBoards(),
      ]);

      // A board the user both authored and maintains comes back from two
      // queries; the private path can overlap a board list too.
      const byKey = new Map<string, KanbanBoard>();
      for (const board of [...owned, ...maintained, ...priv]) {
        byKey.set(boardKey(board), board);
      }

      set({
        boards: [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt),
        isLoadingBoards: false,
      });
    } catch (e) {
      set({ error: message(e, "Failed to load boards"), isLoadingBoards: false });
    }
  },

  async fetchCards(board) {
    set({ isLoadingCards: true, error: null });
    try {
      const cards = await kanbanSdk.fetchCards(board);
      set((s) => ({
        cardsByBoard: { ...s.cardsByBoard, [boardKey(board)]: cards },
        isLoadingCards: false,
      }));
    } catch (e) {
      set({ error: message(e, "Failed to load cards"), isLoadingCards: false });
    }
  },

  async createBoard(draft) {
    set({ error: null });
    try {
      const board = await kanbanSdk.createBoard(draft);
      set((s) => ({ boards: [board, ...s.boards] }));
      return board;
    } catch (e) {
      set({ error: message(e, "Failed to create board") });
      throw e;
    }
  },

  async updateBoard(board, changes) {
    set({ error: null });
    try {
      const saved = await kanbanSdk.updateBoard(board, changes);
      set((s) => ({
        boards: s.boards.map((b) => (boardKey(b) === boardKey(saved) ? saved : b)),
      }));
      return saved;
    } catch (e) {
      set({ error: message(e, "Failed to update board") });
      throw e;
    }
  },

  async deleteBoard(board) {
    set({ error: null });
    try {
      await kanbanSdk.deleteBoard(board);
      const key = boardKey(board);
      set((s) => {
        const cardsByBoard = { ...s.cardsByBoard };
        delete cardsByBoard[key];
        return { boards: s.boards.filter((b) => boardKey(b) !== key), cardsByBoard };
      });
    } catch (e) {
      set({ error: message(e, "Failed to delete board") });
      throw e;
    }
  },

  async createCard(board, draft) {
    set({ error: null });
    try {
      const card = await kanbanSdk.createCard(board, draft);
      const key = boardKey(board);
      set((s) => ({
        cardsByBoard: { ...s.cardsByBoard, [key]: [...(s.cardsByBoard[key] ?? []), card] },
      }));
      return card;
    } catch (e) {
      set({ error: message(e, "Failed to create card") });
      throw e;
    }
  },

  async updateCard(board, card, changes) {
    set({ error: null });
    try {
      const saved = await kanbanSdk.updateCard(board, card, changes);
      const key = boardKey(board);
      set((s) => ({
        cardsByBoard: {
          ...s.cardsByBoard,
          [key]: (s.cardsByBoard[key] ?? []).map((c) => (c.id === saved.id ? saved : c)),
        },
      }));
      return saved;
    } catch (e) {
      set({ error: message(e, "Failed to update card") });
      throw e;
    }
  },

  async deleteCard(board, card) {
    set({ error: null });
    try {
      await kanbanSdk.deleteCard(card);
      const key = boardKey(board);
      set((s) => ({
        cardsByBoard: {
          ...s.cardsByBoard,
          [key]: (s.cardsByBoard[key] ?? []).filter((c) => c.id !== card.id),
        },
      }));
    } catch (e) {
      set({ error: message(e, "Failed to delete card") });
      throw e;
    }
  },

  /**
   * Optimistic: the dragged card is re-ranked locally before the relay
   * roundtrip, so the board does not snap back under the pointer. A failure
   * restores the pre-drag snapshot — leaving the optimistic order in place
   * would show an order the relays do not have.
   */
  async moveCard(board, cardId, targetStatus, targetIndex) {
    const key = boardKey(board);
    const snapshot = get().cardsByBoard[key] ?? [];
    const card = snapshot.find((c) => c.id === cardId);
    if (!card) return;

    const siblings = snapshot
      .filter((c) => c.status === targetStatus && c.id !== cardId)
      .map((c) => c.rank)
      .sort((a, b) => a - b);
    const optimisticRank = predictRank(siblings, targetIndex);

    set((s) => ({
      error: null,
      cardsByBoard: {
        ...s.cardsByBoard,
        [key]: (s.cardsByBoard[key] ?? []).map((c) =>
          c.id === cardId ? { ...c, status: targetStatus, rank: optimisticRank } : c,
        ),
      },
    }));

    try {
      const saved = await kanbanSdk.moveCard(board, snapshot, cardId, targetStatus, targetIndex);
      set((s) => ({
        cardsByBoard: {
          ...s.cardsByBoard,
          [key]: (s.cardsByBoard[key] ?? []).map((c) => (c.id === saved.id ? saved : c)),
        },
      }));
    } catch (e) {
      set((s) => ({
        error: message(e, "Failed to move card"),
        cardsByBoard: { ...s.cardsByBoard, [key]: snapshot },
      }));
    }
  },
}));

/**
 * Local mirror of the SDK's `computeRank` for the optimistic hop only. Kept
 * here rather than imported so a drift in the SDK's fractional-indexing scheme
 * cannot corrupt a published rank — the authoritative value always comes back
 * from `moveCard` and overwrites this one.
 */
function predictRank(sortedRanks: number[], targetIndex: number): number {
  const STEP = 10;
  if (sortedRanks.length === 0) return STEP;
  if (targetIndex <= 0) return sortedRanks[0] - STEP;
  if (targetIndex >= sortedRanks.length) return sortedRanks[sortedRanks.length - 1] + STEP;
  const before = sortedRanks[targetIndex - 1];
  const after = sortedRanks[targetIndex];
  return before + (after - before) / 2;
}
