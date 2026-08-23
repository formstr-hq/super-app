import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { KanbanCard } from "@formstr/kanban-sdk";
import { Box, Card, Tooltip, Typography } from "@mui/material";
import { Link2, Paperclip } from "lucide-react";

import { AssigneeStack } from "./AssigneeAvatar";

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
        p: 1.125,
        borderRadius: 1,
        cursor: disabled ? "pointer" : "grab",
        opacity: isDragging ? 0.4 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        "&:hover": { borderColor: "var(--fs-accent-line)" },
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
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.4,
          }}
        >
          {card.description}
        </Typography>
      )}

      {/* Footer: labels left, ownership and attachments right. */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
        {card.labels.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.5, minWidth: 0, overflow: "hidden" }}>
            {card.labels.slice(0, 2).map((label) => (
              <CardLabel key={label} label={label} />
            ))}
            {card.labels.length > 2 && (
              <Tooltip title={card.labels.slice(2).join(", ")}>
                <Box component="span">
                  <CardLabel label={`+${card.labels.length - 2}`} />
                </Box>
              </Tooltip>
            )}
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 4 }} />

        {card.links.length > 0 && (
          <MetaCount icon={<Link2 size={11} />} value={card.links.length} />
        )}
        {card.attachments.length > 0 && (
          <MetaCount icon={<Paperclip size={11} />} value={card.attachments.length} />
        )}
        <AssigneeStack pubkeys={card.assignees} />
      </Box>
    </Card>
  );
}

function CardLabel({ label }: { label: string }) {
  return (
    <Box
      sx={{
        height: 17,
        px: 0.625,
        borderRadius: "3px",
        bgcolor: "action.selected",
        color: "text.primary",
        fontSize: 10.5,
        fontWeight: 500,
        lineHeight: "17px",
        whiteSpace: "nowrap",
        maxWidth: 84,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </Box>
  );
}

function MetaCount({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        color: "text.secondary",
        fontSize: 10.5,
      }}
    >
      {icon}
      {value}
    </Box>
  );
}
