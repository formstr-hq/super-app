import { Box, Checkbox, Divider, IconButton, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Inbox, Plus, Settings2 } from "lucide-react";

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
  /** Pending invitation count for the rail badge. */
  pendingInvitations?: number;
  /** Which main view is active; drives the Invitations row's selected state. */
  view?: "calendar" | "invitations";
  /** When provided, the Invitations entry renders and opens the invitations view. */
  onOpenInvitations?: () => void;
}

export function CalendarSidebar({
  calendars,
  visibleCalendarIds,
  onToggleCalendar,
  onNewCalendar,
  onEditCalendar,
  showAllPublic,
  onToggleShowAllPublic,
  pendingInvitations = 0,
  view = "calendar",
  onOpenInvitations,
}: CalendarSidebarProps) {
  const theme = useTheme();
  const invitationsActive = view === "invitations";

  return (
    <Box
      component="aside"
      sx={{
        width: 236,
        flexShrink: 0,
        height: "100%",
        borderRight: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.mode === "dark" ? "background.default" : "grey.50",
        px: 1.25,
        py: 1.75,
        display: { xs: "none", sm: "flex" },
        flexDirection: "column",
        gap: 0.25,
      }}
    >
      {onOpenInvitations && (
        <Box
          component="button"
          type="button"
          onClick={onOpenInvitations}
          aria-label={`Invitations (${pendingInvitations} pending)`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            width: "100%",
            px: 1.1,
            py: 1,
            mb: 0.5,
            borderRadius: 1,
            border: "none",
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
            bgcolor: invitationsActive ? "text.primary" : "transparent",
            color: invitationsActive ? "background.paper" : "text.primary",
            "&:hover": { bgcolor: invitationsActive ? "text.primary" : "action.hover" },
          }}
        >
          <Inbox size={15} />
          <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>
            Invitations
          </Typography>
          {pendingInvitations > 0 && (
            <Box
              component="span"
              sx={{
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                px: 0.85,
                py: 0.4,
                borderRadius: 5,
                bgcolor: invitationsActive ? "background.paper" : "text.primary",
                color: invitationsActive ? "text.primary" : "background.paper",
              }}
            >
              {pendingInvitations}
            </Box>
          )}
        </Box>
      )}

      {onOpenInvitations && <Divider sx={{ mb: 0.75 }} />}

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
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
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
          flex: 1,
          minHeight: 0,
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
                px: 0.75,
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
                  width: 11,
                  height: 11,
                  borderRadius: "3px",
                  flexShrink: 0,
                  bgcolor: visible ? cal.color || "primary.main" : "transparent",
                  border: `2px solid ${cal.color || theme.palette.text.secondary}`,
                  boxSizing: "border-box",
                }}
              />
              <Typography
                variant="body2"
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
