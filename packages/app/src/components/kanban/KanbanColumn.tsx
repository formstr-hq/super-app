import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Column, KanbanCard } from "@formstr/kanban-sdk";
import { Box, Button, Paper, Typography } from "@mui/material";
import { Plus } from "lucide-react";

import { columnDroppableId } from "../../kanban/dndMapping";

import { KanbanCardItem } from "./KanbanCardItem";

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
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(column.id) });

  return (
    <Paper
      variant="outlined"
      sx={{
        width: 288,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        maxHeight: "100%",
        borderRadius: 2,
        bgcolor: "action.hover",
        borderColor: isOver ? "primary.main" : "divider",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 1,
        }}
      >
        <Typography variant="caption" fontWeight={600} sx={{ textTransform: "uppercase" }}>
          {column.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
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
          gap: 1,
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
          sx={{ m: 1, mt: 0, justifyContent: "flex-start", color: "text.secondary" }}
        >
          Add card
        </Button>
      )}
    </Paper>
  );
}
