import {
  InvitationVerificationError,
  NotBoardOwnerError,
  SignerRequiredError,
  ViewKeyRequiredError,
  type BoardInvitation,
  type BoardRole,
  type KanbanBoard,
} from "@formstr/kanban-sdk";
import { create } from "zustand";

import { kanbanSdk } from "../kanban/sdk";

import { useKanbanStore } from "./kanbanStore";

/** Role a person can be given. The owner role is the board's author and not assignable. */
export type AssignableRole = Exclude<BoardRole, "owner">;

function message(e: unknown, fallback: string): string {
  if (e instanceof NotBoardOwnerError) {
    return "Only the board owner can manage members.";
  }
  if (e instanceof ViewKeyRequiredError) {
    return "This board's key is not on this device, so its members cannot be changed here.";
  }
  if (e instanceof SignerRequiredError) {
    return "Sign in to manage members.";
  }
  if (e instanceof InvitationVerificationError) {
    return "This invitation's key does not open that board.";
  }
  return e instanceof Error ? e.message : fallback;
}

interface KanbanMembersStore {
  /** Pending board invitations addressed to the signed-in user. */
  invitations: BoardInvitation[];
  /** Coordinates of boards whose owner has published a removal notice for us. */
  removedCoordinates: string[];
  isLoadingInvitations: boolean;
  /**
   * The one thing currently in flight, as a pubkey (member actions) or a wrap
   * id (invitation actions). Membership writes publish several events and can
   * take seconds, so rows need to disable themselves individually.
   */
  busy: string | null;
  error: string | null;

  clearError(): void;
  reset(): void;
  loadInvitations(): Promise<void>;
  loadRemovalNotices(): Promise<void>;
  invite(board: KanbanBoard, pubkey: string, role: AssignableRole, note?: string): Promise<void>;
  setRole(board: KanbanBoard, pubkey: string, role: AssignableRole): Promise<void>;
  removeMember(board: KanbanBoard, pubkey: string): Promise<void>;
  /** Resolves to the accepted board's coordinate, which is also its board key. */
  acceptInvitation(invitation: BoardInvitation): Promise<string | null>;
  dismissInvitation(invitation: BoardInvitation): Promise<void>;
}

export const useKanbanMembersStore = create<KanbanMembersStore>((set, get) => ({
  invitations: [],
  removedCoordinates: [],
  isLoadingInvitations: false,
  busy: null,
  error: null,

  clearError() {
    set({ error: null });
  },

  reset() {
    set({ invitations: [], removedCoordinates: [], busy: null, error: null });
  },

  async loadInvitations() {
    set({ isLoadingInvitations: true, error: null });
    try {
      const invitations = await kanbanSdk.fetchInvitations();
      set({
        invitations: invitations.sort((a, b) => b.createdAt - a.createdAt),
        isLoadingInvitations: false,
      });
    } catch (e) {
      set({ error: message(e, "Failed to load invitations"), isLoadingInvitations: false });
    }
  },

  /**
   * Advisory only. The board event is authoritative; a notice just makes "you
   * were removed" discoverable without refetching and diffing every board.
   * A failure here is silent — it would otherwise nag on every kanban visit
   * about something the user cannot act on.
   */
  async loadRemovalNotices() {
    try {
      const notices = await kanbanSdk.fetchRemovalNotices();
      set({ removedCoordinates: notices.map((n) => n.coordinate) });
    } catch {
      /* advisory signal — leave the previous list alone */
    }
  },

  /**
   * Private board: publishes the updated member tags and gift-wraps the view
   * key to the invitee. Public board: there is no key to deliver, so this is
   * just a `p` tag on an event anyone can already read.
   */
  async invite(board, pubkey, role, note) {
    set({ busy: pubkey, error: null });
    try {
      const updated = board.isPrivate
        ? await kanbanSdk.invite(board, [{ pubkey, role }], note)
        : await kanbanSdk.updateBoard(board, { maintainers: [...board.maintainers, pubkey] });
      useKanbanStore.getState().ingestBoard(updated);
      set({ busy: null });
    } catch (e) {
      set({ error: message(e, "Failed to invite"), busy: null });
      throw e;
    }
  },

  /**
   * `invite` is also the role-change call: the SDK drops the pubkey from both
   * lists and re-adds it to the chosen one. The side effect is a fresh
   * invitation wrap, which the UI reports rather than hides.
   */
  async setRole(board, pubkey, role) {
    return get().invite(board, pubkey, role);
  },

  /**
   * Revocation. On a private board the SDK rotates the board key by default:
   * every card and comment is republished under a new key and the survivors are
   * re-invited. The non-rotating branch is never used — it leaves the removed
   * user holding a key that still decrypts everything, past and future.
   *
   * Rotation is not atomic, so a failure refetches from the relays rather than
   * trusting local state, and says the member list may be mid-flight.
   */
  async removeMember(board, pubkey) {
    set({ busy: pubkey, error: null });
    const kanban = useKanbanStore.getState();
    try {
      const updated = board.isPrivate
        ? await kanbanSdk.removeMember(board, pubkey)
        : await kanbanSdk.updateBoard(board, {
            maintainers: board.maintainers.filter((p) => p !== pubkey),
          });
      kanban.ingestBoard(updated);
      // Rotation republished every card under the new key, so each cached copy
      // now points at an event id the relays have superseded.
      if (board.isPrivate) await kanban.fetchCards(updated);
      set({ busy: null });
    } catch (e) {
      if (board.isPrivate) {
        await kanban.fetchBoards();
        set({
          error:
            "Removing that member failed part-way. Key rotation is not atomic — refresh and check " +
            "the member list before trusting it.",
          busy: null,
        });
      } else {
        set({ error: message(e, "Failed to remove member"), busy: null });
      }
      throw e;
    }
  },

  async acceptInvitation(invitation) {
    set({ busy: invitation.wrapId, error: null });
    try {
      await kanbanSdk.acceptInvitation(invitation);
      // The board is now linked into the user's board list under the delivered
      // view key, which is where `fetchPrivateBoards` reads keys from.
      await useKanbanStore.getState().fetchBoards();
      set((s) => ({
        invitations: s.invitations.filter((i) => i.wrapId !== invitation.wrapId),
        busy: null,
      }));
      return invitation.coordinate;
    } catch (e) {
      // Keep a failed invitation listed: dismissing it is the user's call, not
      // a side effect of one bad relay round trip.
      set({ error: message(e, "Failed to accept invitation"), busy: null });
      return null;
    }
  },

  async dismissInvitation(invitation) {
    set({ busy: invitation.wrapId, error: null });
    try {
      // Persisted as a deletion or a kind-84 opt-out — relays keep serving the
      // wrap, so a local-only dismissal would come back on the next fetch.
      await kanbanSdk.dismissInvitation(invitation);
      set((s) => ({
        invitations: s.invitations.filter((i) => i.wrapId !== invitation.wrapId),
        busy: null,
      }));
    } catch (e) {
      set({ error: message(e, "Failed to dismiss invitation"), busy: null });
    }
  },
}));
