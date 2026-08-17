import {
  canEditCards,
  type BoardDraft,
  type CardDraft,
  type Column,
  type KanbanBoard,
  type KanbanCard,
} from "@formstr/kanban-sdk";
import { Alert, Box, Button, IconButton, Snackbar, Tooltip, Typography } from "@mui/material";
import { ArrowLeft, Lock, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BoardListView } from "../components/kanban/BoardListView";
import { BoardToolbar } from "../components/kanban/BoardToolbar";
import { BoardView } from "../components/kanban/BoardView";
import { CardDialog } from "../components/kanban/CardDialog";
import { CreateBoardDialog } from "../components/kanban/CreateBoardDialog";
import { DeleteBoardDialog } from "../components/kanban/DeleteBoardDialog";
import { InvitationsView } from "../components/kanban/InvitationsView";
import { KanbanSidebar } from "../components/kanban/KanbanSidebar";
import { MembersDialog } from "../components/kanban/MembersDialog";
import { MobileRailDrawer } from "../components/MobileRailDrawer";
import { PageHeader } from "../components/PageHeader";
import { boardKey } from "../kanban/boardKey";
import {
  collectLabels,
  EMPTY_FILTER,
  filterCards,
  unfilteredDropIndex,
  type CardFilter,
} from "../kanban/cardFilter";
import { columnForCard, statusFor } from "../kanban/columns";
import { INVITATIONS_KEY } from "../kanban/routes";
import { useAuthStore, useKanbanMembersStore, useKanbanStore } from "../stores";

type ActiveDialog =
  | { kind: "none" }
  | { kind: "board"; board?: KanbanBoard }
  | { kind: "deleteBoard"; board: KanbanBoard }
  // Carries no board: it is always the open one, and every membership write
  // ingests a new object into the store. A snapshot taken at open time would
  // show the roster as it was before the invite that just succeeded.
  | { kind: "members" }
  | { kind: "card"; column: Column; card?: KanbanCard };

export function KanbanPage() {
  const navigate = useNavigate();
  const params = useParams();
  const activeKey = params["*"] ? decodeURIComponent(params["*"]) : null;
  const showingInvitations = activeKey === INVITATIONS_KEY;

  const pubkey = useAuthStore((s) => s.pubkey);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);

  const invitations = useKanbanMembersStore((s) => s.invitations);
  const removedCoordinates = useKanbanMembersStore((s) => s.removedCoordinates);
  const loadInvitations = useKanbanMembersStore((s) => s.loadInvitations);
  const loadRemovalNotices = useKanbanMembersStore((s) => s.loadRemovalNotices);
  const resetMembers = useKanbanMembersStore((s) => s.reset);

  const {
    boards,
    cardsByBoard,
    isLoadingBoards,
    isLoadingCards,
    error,
    clearError,
    fetchBoards,
    fetchCards,
    createBoard,
    updateBoard,
    deleteBoard,
    createCard,
    updateCard,
    deleteCard,
    binCard,
    moveCard,
  } = useKanbanStore();

  const [dialog, setDialog] = useState<ActiveDialog>({ kind: "none" });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);

  // Filters describe one board's cards, so they do not follow you to the next.
  useEffect(() => setFilter(EMPTY_FILTER), [activeKey]);

  useEffect(() => {
    void fetchBoards();
  }, [fetchBoards, pubkey]);

  // Both queries are per-identity: invitations are gift wraps addressed to this
  // pubkey, removal notices are matched against the keys in its board lists.
  useEffect(() => {
    if (!pubkey) {
      resetMembers();
      return;
    }
    void loadInvitations();
    void loadRemovalNotices();
  }, [pubkey, loadInvitations, loadRemovalNotices, resetMembers]);

  const board = useMemo(
    () => (activeKey ? boards.find((b) => boardKey(b) === activeKey) : undefined),
    [boards, activeKey],
  );

  useEffect(() => {
    if (board) void fetchCards(board);
  }, [board, fetchCards]);

  const cards = board ? (cardsByBoard[boardKey(board)] ?? []) : [];
  const liveCards = cards.filter((c) => !c.binned);
  const visibleCards = filterCards(liveCards, filter, pubkey);
  const boardLabels = collectLabels(cards);
  const readOnly = !board || !pubkey || !canEditCards(board, pubkey);
  // Maintainers may write cards, but a NIP-09 tombstone is only honored from
  // the event's own author — a maintainer's deletion would be signed by the
  // wrong key and silently ignored by relays. Offer it to the owner alone.
  const isOwner = Boolean(board && pubkey && board.pubkey === pubkey);
  const openCard = dialog.kind === "card" ? dialog.card : undefined;
  // A NIP-09 tombstone is only honored from the key that signed the event, so
  // offer Delete to that key alone — everyone else with write access bins the
  // card instead. After a key rotation the signer is the rotator, not the author.
  const canDeleteOpenCard = Boolean(openCard && pubkey && openCard.pubkey === pubkey);
  // The owner published a kind-84 saying we are off this board. Advisory: the
  // board event is authoritative, and after a key rotation this copy simply
  // stops resolving.
  const wasRemoved = Boolean(board && removedCoordinates.includes(boardKey(board)));

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [key, list] of Object.entries(cardsByBoard)) {
      counts[key] = list.filter((c) => !c.binned).length;
    }
    return counts;
  }, [cardsByBoard]);

  /**
   * The board renders filtered cards, so dnd-kit hands back an index in that
   * shorter list. The store ranks against the whole column, so translate before
   * publishing — otherwise a drop lands above every hidden card in the column.
   */
  const handleMoveCard = (cardId: string, targetStatus: string, visibleIndex: number) => {
    if (!board) return;
    const byRank = (list: KanbanCard[]) =>
      list
        .filter((c) => c.status === targetStatus && c.id !== cardId)
        .sort((a, b) => a.rank - b.rank);
    const index = unfilteredDropIndex(byRank(liveCards), byRank(visibleCards), visibleIndex);
    void moveCard(board, cardId, targetStatus, index);
  };

  const openBoard = useCallback(
    (next: KanbanBoard | null) => {
      navigate(next ? `/kanban/${encodeURIComponent(boardKey(next))}` : "/kanban");
    },
    [navigate],
  );

  const submitBoard = async (draft: BoardDraft) => {
    setSaving(true);
    try {
      const editing = dialog.kind === "board" ? dialog.board : undefined;
      const saved = editing ? await updateBoard(editing, draft) : await createBoard(draft);
      setDialog({ kind: "none" });
      if (!editing) openBoard(saved);
    } catch {
      // the store surfaced the message; keep the dialog open so the draft survives
    } finally {
      setSaving(false);
    }
  };

  const submitCard = async (draft: CardDraft) => {
    if (dialog.kind !== "card" || !board) return;
    setSaving(true);
    try {
      const { column, card } = dialog;
      if (card) {
        await updateCard(board, card, draft);
      } else {
        await createCard(board, { ...draft, status: statusFor(board, column) });
      }
      setDialog({ kind: "none" });
    } catch {
      // store holds the error; leave the dialog up
    } finally {
      setSaving(false);
    }
  };

  const removeBoard = async () => {
    if (dialog.kind !== "deleteBoard") return;
    setSaving(true);
    try {
      await deleteBoard(dialog.board);
      setDialog({ kind: "none" });
      openBoard(null);
    } catch {
      // store holds the error; leave the dialog up so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const removeCard = async () => {
    if (dialog.kind !== "card" || !dialog.card || !board) return;
    setSaving(true);
    try {
      await deleteCard(board, dialog.card);
      setDialog({ kind: "none" });
    } catch {
      // store holds the error
    } finally {
      setSaving(false);
    }
  };

  const binOpenCard = async () => {
    if (dialog.kind !== "card" || !dialog.card || !board) return;
    setSaving(true);
    try {
      await binCard(board, dialog.card);
      setDialog({ kind: "none" });
    } catch {
      // store holds the error
    } finally {
      setSaving(false);
    }
  };

  const renderRail = (onNavigate: () => void) => (
    <KanbanSidebar
      boards={boards}
      activeKey={activeKey}
      pendingInvitations={invitations.length}
      onSelect={(next) => {
        openBoard(next);
        onNavigate();
      }}
      onNew={() => {
        setDialog({ kind: "board" });
        onNavigate();
      }}
      onOpenInvitations={() => {
        navigate(`/kanban/${INVITATIONS_KEY}`);
        onNavigate();
      }}
    />
  );

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      {renderRail(() => {})}
      <MobileRailDrawer ariaLabel="Open boards panel">{renderRail}</MobileRailDrawer>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {showingInvitations ? (
          <InvitationsView
            onBack={() => openBoard(null)}
            onOpenBoard={(coordinate) => navigate(`/kanban/${encodeURIComponent(coordinate)}`)}
          />
        ) : board ? (
          <>
            <PageHeader
              title={board.title || "Untitled board"}
              description={
                board.description || "Kanban board on Nostr — NIP-100, syncs with kanbanstr.com."
              }
              action={
                <>
                  <Tooltip title="Back to boards">
                    <IconButton size="small" onClick={() => openBoard(null)}>
                      <ArrowLeft size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Refresh">
                    {/* Disabled while a fetch is in flight, and a disabled button
                        fires no events — the tooltip needs a live element to
                        listen on, same as the private-board lock below. */}
                    <span>
                      <IconButton
                        size="small"
                        aria-label="Refresh"
                        onClick={() => void fetchCards(board)}
                        disabled={isLoadingCards}
                      >
                        <RefreshCw size={16} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {board.isPrivate && (
                    <Tooltip title="Private board — encrypted under a view key">
                      {/* A disabled button fires no events, so the tooltip needs
                          a live element to listen on. */}
                      <span>
                        <IconButton size="small" disabled>
                          <Lock size={15} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title="Members">
                    <IconButton
                      size="small"
                      aria-label="Members"
                      onClick={() => setDialog({ kind: "members" })}
                    >
                      <Users size={15} />
                    </IconButton>
                  </Tooltip>
                  {/* A board is an addressable single-owner event: a maintainer's
                      edit would fork it to their own coordinate, so the SDK
                      refuses one. Offer it to the owner alone. */}
                  {isOwner && (
                    <Button
                      size="small"
                      startIcon={<Pencil size={14} />}
                      onClick={() => setDialog({ kind: "board", board })}
                    >
                      Edit
                    </Button>
                  )}
                  {isOwner && (
                    <Tooltip title="Delete board">
                      <IconButton
                        size="small"
                        aria-label="Delete board"
                        onClick={() => setDialog({ kind: "deleteBoard", board })}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              }
            />

            {wasRemoved && (
              <Alert severity="warning" square sx={{ borderRadius: 0, py: 0.25 }}>
                The owner removed you from this board. Your copy stops receiving updates once the
                board key is rotated.
              </Alert>
            )}

            {readOnly && (
              <Alert severity="info" square sx={{ borderRadius: 0, py: 0.25 }}>
                You are not a maintainer of this board — cards are read-only.
              </Alert>
            )}

            <BoardToolbar
              filter={filter}
              onChange={setFilter}
              labels={boardLabels}
              canFilterMine={Boolean(pubkey)}
              matchCount={visibleCards.length}
              totalCount={liveCards.length}
            />

            <BoardView
              board={board}
              cards={visibleCards}
              readOnly={readOnly}
              onMoveCard={handleMoveCard}
              onAddCard={(column) => setDialog({ kind: "card", column })}
              onOpenCard={(card) => {
                const column = columnForCard(board, card);
                if (column) setDialog({ kind: "card", column, card });
              }}
            />
          </>
        ) : activeKey ? (
          <MissingBoard loading={isLoadingBoards} onBack={() => openBoard(null)} />
        ) : (
          <>
            <PageHeader
              title="Kanban"
              description="Boards, columns, and cards on Nostr — interoperable with kanbanstr.com."
              action={
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Plus size={14} />}
                  onClick={() => setDialog({ kind: "board" })}
                >
                  New board
                </Button>
              }
            />
            <BoardListView
              boards={boards}
              cardCounts={cardCounts}
              loading={isLoadingBoards}
              loggedIn={Boolean(pubkey)}
              onOpen={openBoard}
              onCreate={() => setDialog({ kind: "board" })}
              onSignIn={() => openAuthModal("login")}
            />
          </>
        )}
      </Box>

      <CreateBoardDialog
        open={dialog.kind === "board"}
        board={dialog.kind === "board" ? dialog.board : undefined}
        saving={saving}
        onClose={() => setDialog({ kind: "none" })}
        onSubmit={(draft) => void submitBoard(draft)}
      />

      <MembersDialog
        open={dialog.kind === "members"}
        board={dialog.kind === "members" ? board : undefined}
        self={pubkey}
        cardCount={liveCards.length}
        onClose={() => setDialog({ kind: "none" })}
      />

      <DeleteBoardDialog
        open={dialog.kind === "deleteBoard"}
        board={dialog.kind === "deleteBoard" ? dialog.board : undefined}
        cardCount={cards.filter((c) => !c.binned).length}
        deleting={saving}
        onClose={() => setDialog({ kind: "none" })}
        onConfirm={() => void removeBoard()}
      />

      <CardDialog
        open={dialog.kind === "card"}
        card={openCard}
        columnName={dialog.kind === "card" ? dialog.column.name : ""}
        saving={saving}
        readOnly={readOnly}
        onClose={() => setDialog({ kind: "none" })}
        onSubmit={(draft) => void submitCard(draft)}
        onDelete={canDeleteOpenCard ? () => void removeCard() : undefined}
        onBin={readOnly ? undefined : () => void binOpenCard()}
      />

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={6000}
        onClose={clearError}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={clearError} variant="filled">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function MissingBoard({ loading, onBack }: { loading: boolean; onBack: () => void }) {
  return (
    <Box sx={{ p: 4, textAlign: "center" }}>
      <Typography variant="body2" color="text.secondary">
        {loading
          ? "Loading board…"
          : "That board is not in your list. A private board is only readable with its view key — open it from the device you created it on, or accept its invitation first."}
      </Typography>
      {!loading && (
        <Button size="small" onClick={onBack} sx={{ mt: 1.5 }}>
          Back to boards
        </Button>
      )}
    </Box>
  );
}
