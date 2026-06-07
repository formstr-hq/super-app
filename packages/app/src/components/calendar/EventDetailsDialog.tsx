import type { CalendarEvent, CalendarList, RSVPResponse } from "@formstr/agent/services/calendar";
import { fetchRsvpsForEvent, rsvpToEvent } from "@formstr/agent/services/calendar/rsvp";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  Divider,
  Typography,
} from "@mui/material";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { calendarForEvent } from "../../lib/calendarMembership";
import { formatNpub } from "../../lib/npub";

import { RSVPBar, type RSVPBarPayload, type RSVPBarStatus } from "./RSVPBar";

interface EventDetailsDialogProps {
  event: CalendarEvent | null;
  currentUserPubkey: string | null;
  calendars?: CalendarList[];
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}

function formatWhen(beginMs: number, endMs: number): string {
  const begin = new Date(beginMs);
  const end = new Date(endMs);
  const datePart = begin.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = begin.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const endTime = end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${startTime}–${endTime}`;
}

function formatSuggested(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(pubkey: string): string {
  return pubkey.slice(0, 2).toUpperCase();
}

function StatusPill({ status }: { status: string }) {
  const accepted = status === "accepted";
  return (
    <Box
      component="span"
      sx={{
        fontSize: 11,
        px: "9px",
        py: "2px",
        borderRadius: "20px",
        border: "1px solid",
        borderColor: accepted ? "transparent" : "divider",
        bgcolor: accepted ? "text.primary" : "transparent",
        color: accepted ? "background.paper" : "text.secondary",
        whiteSpace: "nowrap",
        textTransform: "capitalize",
      }}
    >
      {status}
    </Box>
  );
}

export function EventDetailsDialog({
  event,
  currentUserPubkey,
  calendars = [],
  onClose,
  onEdit,
  onDelete,
}: EventDetailsDialogProps) {
  const [rsvps, setRsvps] = useState<RSVPResponse[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const coordinate = event ? `${event.kind}:${event.user}:${event.id}` : "";
  const isAuthor = !!event && event.user === currentUserPubkey;

  useEffect(() => {
    if (!event) return;
    let active = true;
    fetchRsvpsForEvent(coordinate, event.viewKey)
      .then((r) => {
        if (active) setRsvps(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [event, coordinate]);

  if (!event) return null;

  const calendar = calendarForEvent(event, calendars);

  const myStatus = currentUserPubkey
    ? (rsvps.find((r) => r.pubkey === currentUserPubkey)?.status as RSVPBarStatus | undefined)
    : undefined;

  const submitRsvp = async (payload: RSVPBarPayload) => {
    setSubmitting(true);
    try {
      await rsvpToEvent(coordinate, payload.status, event.isPrivate, payload, event.viewKey);
      const refreshed = await fetchRsvpsForEvent(coordinate, event.viewKey);
      setRsvps(refreshed);
    } finally {
      setSubmitting(false);
    }
  };

  const metaRows: { label: string; content: React.ReactNode }[] = [
    {
      label: "When",
      content: formatWhen(event.begin, event.end),
    },
    ...(event.location.length ? [{ label: "Where", content: event.location.join(", ") }] : []),
    ...(calendar
      ? [
          {
            label: "Calendar",
            content: (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "3px",
                    bgcolor: calendar.color,
                    flexShrink: 0,
                  }}
                />
                <span>{calendar.title || "Untitled"}</span>
              </Box>
            ),
          },
        ]
      : []),
  ];

  return (
    <Dialog open={!!event} onClose={onClose} fullWidth maxWidth="sm">
      <Box sx={{ px: 3, pt: 2.5, pb: 0 }}>
        <Typography
          variant="h6"
          fontWeight={700}
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          {event.isPrivate && <Lock size={16} />}
          {event.title}
        </Typography>
        {event.description && (
          <DialogContentText sx={{ mt: 0.5, fontSize: 13 }}>{event.description}</DialogContentText>
        )}
      </Box>

      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {metaRows.map((row) => (
            <Box key={row.label} sx={{ display: "flex", gap: 2 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ width: 64, flexShrink: 0, fontSize: 13 }}
              >
                {row.label}
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13.5 }}>
                {row.content}
              </Typography>
            </Box>
          ))}

          <Divider sx={{ my: 1 }} />
          <RSVPBar
            event={event}
            myStatus={myStatus}
            isSubmitting={submitting}
            onSubmit={submitRsvp}
          />

          {rsvps.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography
                variant="caption"
                fontWeight={700}
                color="text.secondary"
                sx={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
              >
                Attendees · {rsvps.length}
              </Typography>
              {rsvps.map((r) => (
                <Box key={r.pubkey} sx={{ display: "flex", flexDirection: "column" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, py: 0.5 }}>
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        bgcolor: "action.hover",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "text.secondary",
                      }}
                    >
                      {initials(r.pubkey)}
                    </Box>
                    <Typography variant="body2" sx={{ flex: 1, fontSize: 13.5 }}>
                      {formatNpub(r.pubkey)}
                      {r.pubkey === event.user && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 0.5 }}
                        >
                          (organiser)
                        </Typography>
                      )}
                    </Typography>
                    <StatusPill status={r.status} />
                  </Box>
                  {r.comment && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: "34px", mt: "-3px", pb: 0.5 }}
                    >
                      "{r.comment}"
                    </Typography>
                  )}
                  {r.suggestedStart && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: "34px", mt: r.comment ? 0 : "-3px", pb: 0.5 }}
                    >
                      suggests {formatSuggested(r.suggestedStart)}
                      {r.suggestedEnd ? ` – ${formatSuggested(r.suggestedEnd)}` : ""}
                    </Typography>
                  )}
                </Box>
              ))}
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        {isAuthor && (
          <>
            <Button
              color="error"
              variant="outlined"
              startIcon={<Trash2 size={14} />}
              onClick={() => onDelete(event)}
              sx={{ mr: "auto" }}
            >
              Delete
            </Button>
            <Button
              variant="outlined"
              startIcon={<Pencil size={14} />}
              onClick={() => onEdit(event)}
            >
              Edit
            </Button>
          </>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
