import { Paper, Typography } from "@mui/material";
import { Lock } from "lucide-react";

import type { CalendarEvent } from "../../services/calendar";

interface EventCardProps {
  event: CalendarEvent;
  onClick: () => void;
  color?: string;
}

export function EventCard({ event, onClick, color }: EventCardProps) {
  const accent = color ?? "transparent";
  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={onClick}
      style={{ borderLeft: `3px solid ${accent}` }}
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
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, width: 64 }}>
        {new Date(event.begin).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Typography>
      <Typography variant="body2" fontWeight={500} sx={{ flex: 1, minWidth: 0 }} noWrap>
        {event.title}
      </Typography>
    </Paper>
  );
}
