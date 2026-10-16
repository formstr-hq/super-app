import {
  KANBAN_KINDS,
  type BoardDraft,
  type CardDraft,
  type KanbanBoard,
  type KanbanCard,
  type KanbanComment,
} from "@formstr/kanban-sdk";
import { create } from "zustand";

import { boardKey } from "../kanban/boardKey";
import { cardScopeFilters } from "../kanban/cardScope";
import { kanbanSdk } from "../kanban/sdk";
import { currentLiveSync } from "../lib/live/controller";
import { singleFlight } from "../lib/live/singleFlight";

import { useAuthStore } from "./authStore";

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Coordinates `resolveBoardLink` has already been to the relays for.
 *
 * The page re-runs the lookup whenever the board list changes, and a board
 * that is genuinely not on the relays never stops being absent — without this,
 * a dead link re-queries on every render.
 */
const attemptedLinks = new Set<string>();

/** Closes the live scope for whichever board is currently open. */
let closeCardScope: (() => void) | null = null;
/** Which board that scope is for, so re-reading it does not resubscribe. */
let watchedBoard: string | null = null;

/**
 * Watch the open board, so a collaborator's edit lands without a refresh.
 *
 * The standing warm-up interests cover the user's board *list*; a board's cards
 * are scoped to its coordinate, so only the board actually on screen is worth
 * watching. Keyed per board, so opening another one replaces this scope rather
 * than accumulating subscriptions behind the user.
 */
function watchCards(board: KanbanBoard, refetch: () => Promise<void>): void {
  const key = `cards:${boardKey(board)}`;
  // The scope's own onChange re-runs fetchCards, which lands back here. Without
  // this the subscription that just fired would be torn down and rebuilt on
  // every card edit.
  if (key === watchedBoard) return;

  closeCardScope?.();
  closeCardScope = null;
  watchedBoard = null;

  const live = currentLiveSync();
  const filters = cardScopeFilters(board);
  // No live sync when signed out, and no scope for a private board whose view
  // key this account cannot use. Neither is an error: the board still loads.
  if (!live || !filters) return;

  const run = singleFlight(refetch);
  closeCardScope = live.open({
    key,
    filters,
    relays: [...kanbanSdk.relays],
    onChange: () => void run(),
  });
  watchedBoard = key;
}

interface KanbanStore {
  boards: KanbanBoard[];
  /** Cards per board, keyed by `boardKey(board)`. */
  cardsByBoard: Record<string, KanbanCard[]>;
  /**
   * Comments per card, keyed by the card's `d` (`card.id`). Oldest first, the
   * order `fetchComments` returns a card's thread in.
   */
  commentsByCard: Record<string, KanbanComment[]>;
  /** Per-card comment load state, keyed the same as `commentsByCard`. */
  isLoadingComments: Record<string, boolean>;
  /**
   * A board opened from a URL that is not one of the user's own — someone
   * else's public board, reached by `naddr`. Kept out of `boards` so it does
   * not turn up in the board list or the sidebar, neither of which mean
   * "boards you have looked at".
   */
  linkedBoard: KanbanBoard | null;
  isLoadingBoards: boolean;
  isLoadingCards: boolean;
  isResolvingLink: boolean;
  error: string | null;

  clearError(): void;
  ingestBoard(board: KanbanBoard): void;
  fetchBoards(): Promise<void>;
  resolveBoardLink(coordinate: string): Promise<void>;
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
  binCard(board: KanbanBoard, card: KanbanCard, binned?: boolean): Promise<void>;
  loadComments(board: KanbanBoard, card: KanbanCard): Promise<void>;
  addComment(board: KanbanBoard, card: KanbanCard, text: string): Promise<void>;
  deleteComment(comment: KanbanComment): Promise<void>;
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
  commentsByCard: {},
  isLoadingComments: {},
  linkedBoard: null,
  isLoadingBoards: false,
  isLoadingCards: false,
  isResolvingLink: false,
  error: null,

  clearError() {
    set({ error: null });
  },

  reset() {
    // Runs on sign-out: a scope left open would keep refetching a board for an
    // account with no signer left to decrypt it.
    closeCardScope?.();
    closeCardScope = null;
    watchedBoard = null;
    attemptedLinks.clear();
    set({
      boards: [],
      cardsByBoard: {},
      commentsByCard: {},
      isLoadingComments: {},
      linkedBoard: null,
      error: null,
    });
  },

  /**
   * Replace one board with a newer version of itself, or add it if it is new.
   *
   * Membership writes (`invite`, `removeMember`) hand back an updated board,
   * and after a key rotation that board carries a *different view key* — the
   * only copy that can still decrypt the board's cards. Dropping it and waiting
   * for the next `fetchBoards` would leave the open board unreadable in the
   * meantime.
   *
   * Keyed by `boardKey`, which is the replaceable coordinate, so a rotation
   * (same coordinate, new event id) updates in place rather than duplicating.
   */
  ingestBoard(board) {
    set((s) => {
      const key = boardKey(board);
      const known = s.boards.some((b) => boardKey(b) === key);
      return {
        boards: known
          ? s.boards.map((b) => (boardKey(b) === key ? board : b))
          : [board, ...s.boards],
      };
    });
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

  /**
   * Resolve a board named by a URL but absent from the user's own boards.
   *
   * An `naddr` carries everything needed to fetch the board it points at, which
   * is the whole point of routing on one — a shared link has to open for
   * somebody who was never invited. Only public boards: a private board is
   * encrypted under a view key that reaches this account through a board list
   * or an invitation, and either of those would have put it in `boards`.
   */
  async resolveBoardLink(coordinate) {
    if (get().boards.some((b) => boardKey(b) === coordinate)) return;
    if (!coordinate.startsWith(`${KANBAN_KINDS.publicBoard}:`)) {
      set({ linkedBoard: null });
      return;
    }
    const linked = get().linkedBoard;
    if (linked && boardKey(linked) === coordinate) return;
    if (attemptedLinks.has(coordinate)) {
      set({ linkedBoard: null });
      return;
    }

    attemptedLinks.add(coordinate);
    set({ linkedBoard: null, isResolvingLink: true });
    try {
      const board = await kanbanSdk.fetchBoardByCoordinate(coordinate);
      set({ linkedBoard: board ?? null, isResolvingLink: false });
    } catch {
      // A coordinate out of a URL that no relay answers for is a bad link, not
      // a failure of the app: `MissingBoard` says that better than a banner.
      set({ linkedBoard: null, isResolvingLink: false });
    }
  },

  async fetchCards(board) {
    watchCards(board, () => get().fetchCards(board));
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
      // Upsert rather than prepend: the local relay echoes the publish back to
      // its own observers, so the reactive refetch can land before this call
      // resolves and a blind prepend would show the board twice.
      get().ingestBoard(board);
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
      // Same race as createBoard: the refetch may already hold this card.
      set((s) => {
        const cards = s.cardsByBoard[key] ?? [];
        return {
          cardsByBoard: {
            ...s.cardsByBoard,
            [key]: cards.some((c) => c.id === card.id)
              ? cards.map((c) => (c.id === card.id ? card : c))
              : [...cards, card],
          },
        };
      });
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
   * Hide a card without a tombstone. NIP-09 only lets a card's own author delete
   * it, so this is how a maintainer takes down someone else's — and unlike a
   * deletion it is an ordinary edit, which means the card is replaced in the
   * cache rather than dropped from it.
   */
  async binCard(board, card, binned = true) {
    set({ error: null });
    try {
      const saved = await kanbanSdk.binCard(board, card, binned);
      const key = boardKey(board);
      set((s) => ({
        cardsByBoard: {
          ...s.cardsByBoard,
          [key]: (s.cardsByBoard[key] ?? []).map((c) => (c.id === saved.id ? saved : c)),
        },
      }));
    } catch (e) {
      set({ error: message(e, "Failed to bin card") });
      throw e;
    }
  },

  /**
   * Comments on one card, oldest first.
   *
   * Takes the whole board, exactly like `fetchCards`: a private board's
   * comments are encrypted under the same view key its cards are, so the read
   * is scoped to the board, not just the card id.
   */
  async loadComments(board, card) {
    const key = card.id;
    set((s) => ({ isLoadingComments: { ...s.isLoadingComments, [key]: true } }));
    try {
      // The SDK returns a card's comments oldest-first; that order is kept as-is.
      const comments = await kanbanSdk.fetchComments(board, key);
      set((s) => ({
        commentsByCard: { ...s.commentsByCard, [key]: comments },
        isLoadingComments: { ...s.isLoadingComments, [key]: false },
      }));
    } catch (e) {
      set((s) => ({
        error: message(e, "Failed to load comments"),
        isLoadingComments: { ...s.isLoadingComments, [key]: false },
      }));
    }
  },

  /**
   * Post a comment on a card.
   *
   * No optimistic insert: an encrypted write the relays refuse has no local
   * shadow worth showing, and the dialog refetches once this resolves anyway.
   */
  async addComment(board, card, text) {
    set({ error: null });
    try {
      const comment = await kanbanSdk.createComment(board, card.id, { content: text });
      const key = card.id;
      set((s) => ({
        // Same relay-echo race as createBoard/createCard: the local relay can
        // land the comment through its own observers before this call resolves.
        commentsByCard: {
          ...s.commentsByCard,
          [key]: mergeComment(s.commentsByCard[key] ?? [], comment),
        },
      }));
    } catch (e) {
      set({ error: message(e, "Failed to post comment") });
      throw e;
    }
  },

  /**
   * Delete a comment. Signs a NIP-09 deletion, which kinds like this honour
   * from the comment's author and nobody else — the UI offers it only on own
   * comments.
   */
  async deleteComment(comment) {
    set({ error: null });
    try {
      await kanbanSdk.deleteComment(comment);
      const key = comment.cardId;
      set((s) => ({
        commentsByCard: {
          ...s.commentsByCard,
          [key]: (s.commentsByCard[key] ?? []).filter((c) => c.id !== comment.id),
        },
      }));
    } catch (e) {
      set({ error: message(e, "Failed to delete comment") });
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

/**
 * Fold a freshly returned comment into an oldest-first list.
 *
 * Replaces in place when the `d` is already there (the relay echo of the write
 * this just made), otherwise slots the comment by `createdAt`, so a new comment
 * shown immediately does not jump ahead of an earlier one that landed first.
 */
function mergeComment(comments: KanbanComment[], comment: KanbanComment): KanbanComment[] {
  if (comments.some((c) => c.id === comment.id)) {
    return comments.map((c) => (c.id === comment.id ? comment : c));
  }
  const at = comments.findIndex((c) => c.createdAt > comment.createdAt);
  if (at === -1) return [...comments, comment];
  return [...comments.slice(0, at), comment, ...comments.slice(at)];
}
