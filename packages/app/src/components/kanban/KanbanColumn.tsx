import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Column, KanbanCard } from "@formstr/kanban-sdk";
import { Box, Button, Paper, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Plus } from "lucide-react";

import { columnAccent, type ColumnAccent } from "../../kanban/columnAccent";
import { columnDroppableId } from "../../kanban/dndMapping";

import { KanbanCardItem } from "./KanbanCardItem";

/** Muted enough to sit beside the app's monochrome palette without shouting. */
const ACCENTS: Record<"light" | "dark", Record<ColumnAccent, string>> = {
  light: {
    neutral: "#8C95A3",
    progress: "#3B72C4",
    review: "#B5811F",
    blocked: "#DC2626",
    done: "#2E8B57",
  },
  dark: {
    neutral: "#9AA3B1",
    progress: "#6E9BE6",
    review: "#D9A93F",
    blocked: "#F87171",
    done: "#4FB07A",
  },
};

interface KanbanColumnProps {
  column: Column;
  cards: KanbanCard[];
  readOnly: boolean;
  onAddCard: () => void;
  onOpenCard: (card: KanbanCard) => void;
}

export function KanbanColumn({
  column,
  cards,
  readOnly,
  onAddCard,
  onOpenCard,
}: KanbanColumnProps) {
  const theme = useTheme();
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(column.id) });
  const accent =
    ACCENTS[theme.palette.mode === "dark" ? "dark" : "light"][columnAccent(column.name)];

  return (
    <Paper
      variant="outlined"
      sx={{
        width: 276,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        maxHeight: "100%",
        borderRadius: 1,
        bgcolor: "action.hover",
        borderColor: isOver ? "text.primary" : "divider",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.875,
          px: 1.25,
          py: 1,
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <Box
          sx={{ width: 7, height: 7, borderRadius: "2px", bgcolor: accent, flexShrink: 0 }}
          aria-hidden
        />
        <Typography
          variant="caption"
          fontWeight={650}
          sx={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
        >
          {column.name}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        >
          {cards.length}
        </Typography>
      </Box>

      <Box
        ref={setNodeRef}
        sx={{
          flex: 1,
          minHeight: 60,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.875,
          px: 1,
          pb: 1,
        }}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCardItem
              key={card.id}
              card={card}
              disabled={readOnly}
              onOpen={() => onOpenCard(card)}
            />
          ))}
        </SortableContext>
      </Box>

      {!readOnly && (
        <Button
          size="small"
          startIcon={<Plus size={13} />}
          onClick={onAddCard}
          sx={{
            m: 1,
            mt: 0,
            borderRadius: 1,
            justifyContent: "flex-start",
            color: "text.secondary",
          }}
        >
          Add card
        </Button>
      )}
    </Paper>
  );
}
