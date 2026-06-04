import { Paper, Typography } from "@mui/material";
import { Lock } from "lucide-react";

import type { CalendarEvent } from "../../services/calendar";

interface EventCardProps {
  event: CalendarEvent;
  onClick: () => void;
}

export function EventCard({ event, onClick }: EventCardProps) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {event.isPrivate && <Lock size={12} aria-label="private" />}
      <Typography variant="body2" fontWeight={500} sx={{ flex: 1, minWidth: 0 }} noWrap>
        {event.title}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {new Date(event.begin).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Typography>
    </Paper>
  );
}
