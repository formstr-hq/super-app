import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KanbanCard } from "@formstr/kanban-sdk";
import { Box, Card, Chip, Typography } from "@mui/material";

interface KanbanCardItemProps {
  card: KanbanCard;
  disabled: boolean;
  onOpen: () => void;
}

export function KanbanCardItem({ card, disabled, onOpen }: KanbanCardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
  });

  return (
    <Card
      ref={setNodeRef}
      variant="outlined"
      onClick={onOpen}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        cursor: disabled ? "pointer" : "grab",
        opacity: isDragging ? 0.4 : 1,
        "&:hover": { borderColor: "text.disabled" },
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.35 }}>
        {card.title || "Untitled card"}
      </Typography>

      {card.description && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            mt: 0.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {card.description}
        </Typography>
      )}

      {card.labels.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}>
          {card.labels.map((label) => (
            <Chip key={label} size="small" label={label} sx={{ height: 18, fontSize: 10 }} />
          ))}
        </Box>
      )}
    </Card>
  );
}
