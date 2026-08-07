import type { KanbanBoard } from "@formstr/kanban-sdk";
import { Box, Card, CardActionArea, Chip, Typography } from "@mui/material";
import { Lock, Users } from "lucide-react";

interface BoardCardProps {
  board: KanbanBoard;
  cardCount?: number;
  onOpen: () => void;
}

export function BoardCard({ board, cardCount, onOpen }: BoardCardProps) {
  const collaborators = board.maintainers.length + board.members.length;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}>
      <CardActionArea onClick={onOpen} sx={{ height: "100%", p: 2, alignItems: "stretch" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="subtitle2" fontWeight={600} noWrap sx={{ flex: 1 }}>
              {board.title || "Untitled board"}
            </Typography>
            {board.isPrivate && <Lock size={13} aria-label="Private board" />}
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              flex: 1,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {board.description || "No description"}
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
            <Chip
              size="small"
              label={`${board.columns.length} column${board.columns.length === 1 ? "" : "s"}`}
              sx={{ height: 20, fontSize: 11 }}
            />
            {cardCount !== undefined && (
              <Chip
                size="small"
                label={`${cardCount} card${cardCount === 1 ? "" : "s"}`}
                sx={{ height: 20, fontSize: 11 }}
              />
            )}
            {collaborators > 0 && (
              <Chip
                size="small"
                icon={<Users size={11} />}
                label={collaborators}
                sx={{ height: 20, fontSize: 11 }}
              />
            )}
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
}
