import {
  Box,
  Button,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

interface CalendarHeaderProps {
  monthLabel: string;
  viewMode: "month" | "list";
  onViewModeChange: (mode: "month" | "list") => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewEvent: () => void;
}

export function CalendarHeader({
  monthLabel,
  viewMode,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  onNewEvent,
}: CalendarHeaderProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton size="small" aria-label="Previous month" onClick={onPrev}>
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton size="small" aria-label="Next month" onClick={onNext}>
          <ChevronRight size={18} />
        </IconButton>
        <Typography variant="h6" fontWeight={600} sx={{ minWidth: 140 }}>
          {monthLabel}
        </Typography>
        <Button size="small" variant="outlined" onClick={onToday}>
          Today
        </Button>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={viewMode}
          onChange={(_, v) => v && onViewModeChange(v)}
        >
          <ToggleButton value="month">Month</ToggleButton>
          <ToggleButton value="list">List</ToggleButton>
        </ToggleButtonGroup>
        <Button
          variant="contained"
          size="small"
          startIcon={<Plus size={16} />}
          onClick={onNewEvent}
        >
          New Event
        </Button>
      </Box>
    </Box>
  );
}
