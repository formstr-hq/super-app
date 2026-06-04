import { Box, Checkbox, Divider, IconButton, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Plus, Settings2 } from "lucide-react";

import type { CalendarList } from "../../services/calendar";

interface CalendarSidebarProps {
  calendars: CalendarList[];
  visibleCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  onNewCalendar: () => void;
  /** Per-row edit control; the gear only renders when provided. */
  onEditCalendar?: (calendar: CalendarList) => void;
  showAllPublic: boolean;
  onToggleShowAllPublic: (value: boolean) => void;
}

export function CalendarSidebar({
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  onNewCalendar,
  onEditCalendar,
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
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 0.5,
          mb: 1,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "text.secondary",
          }}
        >
          My Calendars
        </Typography>
        <IconButton
          size="small"
          aria-label="New calendar"
          onClick={onNewCalendar}
          sx={{ color: "text.secondary", p: 0.25 }}
        >
          <Plus size={15} />
        </IconButton>
      </Box>

      <Box
        sx={{
          maxHeight: 280,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
        }}
      >
        {calendars.map((cal) => {
          const visible = visibleCalendarIds.has(cal.id);
          return (
            <Box
              key={cal.id}
              onClick={() => onToggleCalendar(cal.id)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 0.5,
                py: 0.75,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
                "&:hover .cal-edit": { opacity: 1 },
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor: visible ? cal.color || "primary.main" : "transparent",
                  border: `2px solid ${cal.color || theme.palette.text.secondary}`,
                  boxSizing: "border-box",
                }}
              />
              <Typography
                variant="caption"
                noWrap
                sx={{ flex: 1, color: visible ? "text.primary" : "text.secondary" }}
              >
                {cal.title || "Untitled"}
              </Typography>
              {onEditCalendar && (
                <IconButton
                  className="cal-edit"
                  size="small"
                  aria-label={`Edit ${cal.title || "Untitled"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditCalendar(cal);
                  }}
                  sx={{ p: 0.25, opacity: 0, color: "text.secondary" }}
                >
                  <Settings2 size={13} />
                </IconButton>
              )}
            </Box>
          );
        })}
        {calendars.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            No calendars yet
          </Typography>
        )}
      </Box>

      <Divider sx={{ my: 1 }} />

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
        <Typography variant="caption">Show all public</Typography>
      </Box>
    </Box>
  );
}
