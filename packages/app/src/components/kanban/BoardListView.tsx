import type { KanbanBoard } from "@formstr/kanban-sdk";
import { Box, Button, Skeleton, Typography } from "@mui/material";
import { Plus, SquareKanban } from "lucide-react";

import { boardKey } from "../../kanban/boardKey";
import { EmptyState } from "../EmptyState";

import { BoardCard } from "./BoardCard";

interface BoardListViewProps {
  boards: KanbanBoard[];
  cardCounts: Record<string, number>;
  loading: boolean;
  loggedIn: boolean;
  onOpen: (board: KanbanBoard) => void;
  onCreate: () => void;
  onSignIn: () => void;
}

export function BoardListView({
  boards,
  cardCounts,
  loading,
  loggedIn,
  onOpen,
  onCreate,
  onSignIn,
}: BoardListViewProps) {
  if (!loggedIn) {
    return (
      <EmptyState
        icon={SquareKanban}
        title="Sign in to see your boards"
        description="Boards live on Nostr relays under your key. Sign in to load the ones you own or maintain."
        actionLabel="Sign in"
        onAction={onSignIn}
      />
    );
  }

  if (loading && boards.length === 0) {
    return (
      <Box sx={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, gap: 2, p: 3 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rectangular" height={132} sx={{ borderRadius: 1 }} />
        ))}
      </Box>
    );
  }

  if (boards.length === 0) {
    return (
      <EmptyState
        icon={SquareKanban}
        title="No boards yet"
        description="A board holds columns and cards, and syncs with any NIP-100 client — including kanbanstr.com."
        actionLabel="New board"
        onAction={onCreate}
      />
    );
  }

  return (
    <Box sx={{ p: 3, overflowY: "auto" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          Boards
        </Typography>
        <Button size="small" variant="contained" startIcon={<Plus size={14} />} onClick={onCreate}>
          New board
        </Button>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, gap: 2 }}>
        {boards.map((board) => (
          <BoardCard
            key={boardKey(board)}
            board={board}
            cardCount={cardCounts[boardKey(board)]}
            onOpen={() => onOpen(board)}
          />
        ))}
      </Box>
    </Box>
  );
}

const GRID_COLUMNS = {
  xs: "1fr",
  sm: "repeat(2, 1fr)",
  lg: "repeat(3, 1fr)",
};
