import { Box, Button, Checkbox, Divider, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Plus } from "lucide-react";

import type { CalendarList } from "../../services/calendar";

interface CalendarSidebarProps {
  calendars: CalendarList[];
  visibleCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  onNewCalendar: () => void;
  showAllPublic: boolean;
  onToggleShowAllPublic: (value: boolean) => void;
}

export function CalendarSidebar({
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  onNewCalendar,
  showAllPublic,
  onToggleShowAllPublic,
}: CalendarSidebarProps) {
  const theme = useTheme();
  return (
    <Box
      component="aside"
      sx={{
        width: 208,
        flexShrink: 0,
        borderRight: `1px solid ${theme.palette.divider}`,
        px: 1.5,
        py: 2,
        display: { xs: "none", sm: "block" },
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "text.secondary",
          px: 0.5,
          mb: 1,
          display: "block",
        }}
      >
        My Calendars
      </Typography>

      <Box
        sx={{
          maxHeight: 256,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
          mb: 1,
        }}
      >
        {calendars.map((cal) => (
          <Box
            key={cal.id}
            component="label"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 0.5,
              py: 0.75,
              borderRadius: 1,
              cursor: "pointer",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Checkbox
              size="small"
              checked={visibleCalendarIds.has(cal.id)}
              onChange={() => onToggleCalendar(cal.id)}
              sx={{ p: 0 }}
            />
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                bgcolor: cal.color || "primary.main",
              }}
            />
            <Typography variant="caption" noWrap>
              {cal.title || "Untitled"}
            </Typography>
          </Box>
        ))}
        {calendars.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            No calendars yet
          </Typography>
        )}
      </Box>

      <Button
        size="small"
        variant="text"
        startIcon={<Plus size={12} />}
        onClick={onNewCalendar}
        sx={{
          color: "text.secondary",
          fontSize: 12,
          justifyContent: "flex-start",
          px: 0.5,
          mb: 0.5,
        }}
      >
        New Calendar
      </Button>

      <Divider sx={{ my: 0.75 }} />

      <Box
        component="label"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 0.5,
          py: 0.75,
          borderRadius: 1,
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Checkbox
          size="small"
          checked={showAllPublic}
          onChange={(e) => onToggleShowAllPublic(e.target.checked)}
          sx={{ p: 0 }}
        />
        <Typography variant="caption">Show All Public</Typography>
      </Box>
    </Box>
  );
}
