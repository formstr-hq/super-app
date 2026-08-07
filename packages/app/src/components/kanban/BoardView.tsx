import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Column, KanbanBoard, KanbanCard } from "@formstr/kanban-sdk";
import { Box, Card, Typography } from "@mui/material";
import { useMemo, useState } from "react";

import { groupCardsByColumn, sortedColumns, statusFor } from "../../kanban/columns";
import { resolveDropTarget } from "../../kanban/dndMapping";

import { KanbanColumn } from "./KanbanColumn";

interface BoardViewProps {
  board: KanbanBoard;
  cards: KanbanCard[];
  readOnly: boolean;
  onMoveCard: (cardId: string, targetStatus: string, targetIndex: number) => void;
  onAddCard: (column: Column) => void;
  onOpenCard: (card: KanbanCard) => void;
}

export function BoardView({
  board,
  cards,
  readOnly,
  onMoveCard,
  onAddCard,
  onOpenCard,
}: BoardViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const columns = useMemo(() => sortedColumns(board), [board]);
  const grouped = useMemo(() => groupCardsByColumn(board, cards), [board, cards]);

  // A short activation distance so a click still opens the card instead of
  // starting a drag the moment the pointer twitches.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (event: DragStartEvent) => setDraggingId(String(event.active.id));

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const cardIdsByColumn = Object.fromEntries(
      columns.map((c) => [c.id, (grouped[c.id] ?? []).map((card) => card.id)]),
    );
    const target = resolveDropTarget({
      activeId: String(event.active.id),
      overId: event.over ? String(event.over.id) : null,
      cardIdsByColumn,
    });
    if (!target) return;

    const column = columns.find((c) => c.id === target.columnId);
    if (!column) return;
    onMoveCard(String(event.active.id), statusFor(board, column), target.index);
  };

  const draggingCard = draggingId ? cards.find((c) => c.id === draggingId) : undefined;

  if (columns.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          This board has no columns. Edit the board to add some.
        </Typography>
      </Box>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          gap: 2,
          p: 2,
          overflowX: "auto",
          alignItems: "flex-start",
        }}
      >
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            cards={grouped[column.id] ?? []}
            readOnly={readOnly}
            onAddCard={() => onAddCard(column)}
            onOpenCard={onOpenCard}
          />
        ))}
      </Box>

      <DragOverlay>
        {draggingCard && (
          <Card variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, width: 264 }}>
            <Typography variant="body2" fontWeight={500}>
              {draggingCard.title || "Untitled card"}
            </Typography>
          </Card>
        )}
      </DragOverlay>
    </DndContext>
  );
}
