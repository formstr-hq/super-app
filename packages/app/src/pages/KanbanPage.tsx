import {
  canEditCards,
  type BoardDraft,
  type CardDraft,
  type Column,
  type KanbanBoard,
  type KanbanCard,
} from "@formstr/kanban-sdk";
import { Alert, Box, Button, IconButton, Snackbar, Tooltip, Typography } from "@mui/material";
import { ArrowLeft, Lock, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BoardListView } from "../components/kanban/BoardListView";
import { BoardView } from "../components/kanban/BoardView";
import { CardDialog } from "../components/kanban/CardDialog";
import { CreateBoardDialog } from "../components/kanban/CreateBoardDialog";
import { DeleteBoardDialog } from "../components/kanban/DeleteBoardDialog";
import { KanbanSidebar } from "../components/kanban/KanbanSidebar";
import { MobileRailDrawer } from "../components/MobileRailDrawer";
import { PageHeader } from "../components/PageHeader";
import { boardKey } from "../kanban/boardKey";
import { columnForCard, statusFor } from "../kanban/columns";
import { useAuthStore, useKanbanStore } from "../stores";

type ActiveDialog =
  | { kind: "none" }
  | { kind: "board"; board?: KanbanBoard }
  | { kind: "deleteBoard"; board: KanbanBoard }
  | { kind: "card"; column: Column; card?: KanbanCard };

export function KanbanPage() {
  const navigate = useNavigate();
  const params = useParams();
  const activeKey = params["*"] ? decodeURIComponent(params["*"]) : null;

  const pubkey = useAuthStore((s) => s.pubkey);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);

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
    moveCard,
  } = useKanbanStore();

  const [dialog, setDialog] = useState<ActiveDialog>({ kind: "none" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchBoards();
  }, [fetchBoards, pubkey]);

  const board = useMemo(
    () => (activeKey ? boards.find((b) => boardKey(b) === activeKey) : undefined),
    [boards, activeKey],
  );

  useEffect(() => {
    if (board) void fetchCards(board);
  }, [board, fetchCards]);

  const cards = board ? (cardsByBoard[boardKey(board)] ?? []) : [];
  const readOnly = !board || !pubkey || !canEditCards(board, pubkey);
  // Maintainers may write cards, but a NIP-09 tombstone is only honored from
  // the event's own author — a maintainer's deletion would be signed by the
  // wrong key and silently ignored by relays. Offer it to the owner alone.
  const isOwner = Boolean(board && pubkey && board.pubkey === pubkey);

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [key, list] of Object.entries(cardsByBoard)) {
      counts[key] = list.filter((c) => !c.binned).length;
    }
    return counts;
  }, [cardsByBoard]);

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

  const renderRail = (onNavigate: () => void) => (
    <KanbanSidebar
      boards={boards}
      activeKey={activeKey}
      onSelect={(next) => {
        openBoard(next);
        onNavigate();
      }}
      onNew={() => {
        setDialog({ kind: "board" });
        onNavigate();
      }}
    />
  );

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      {renderRail(() => {})}
      <MobileRailDrawer ariaLabel="Open boards panel">{renderRail}</MobileRailDrawer>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {board ? (
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
                    <IconButton
                      size="small"
                      onClick={() => void fetchCards(board)}
                      disabled={isLoadingCards}
                    >
                      <RefreshCw size={16} />
                    </IconButton>
                  </Tooltip>
                  {board.isPrivate && (
                    <Tooltip title="Private board — encrypted under a view key">
                      <IconButton size="small" disabled>
                        <Lock size={15} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {!readOnly && (
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

            {readOnly && (
              <Alert severity="info" square sx={{ borderRadius: 0, py: 0.25 }}>
                You are not a maintainer of this board — cards are read-only.
              </Alert>
            )}

            <BoardView
              board={board}
              cards={cards}
              readOnly={readOnly}
              onMoveCard={(cardId, status, index) => void moveCard(board, cardId, status, index)}
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
        card={dialog.kind === "card" ? dialog.card : undefined}
        columnName={dialog.kind === "card" ? dialog.column.name : ""}
        saving={saving}
        onClose={() => setDialog({ kind: "none" })}
        onSubmit={(draft) => void submitCard(draft)}
        onDelete={() => void removeCard()}
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
