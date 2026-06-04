import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";
import { Check, CircleHelp, Lock, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatNpub } from "../../lib/npub";
import type { CalendarEvent, RSVPResponse } from "../../services/calendar";
import { fetchRsvpsForEvent, rsvpToEvent } from "../../services/calendar/rsvp";

interface EventDetailsDialogProps {
  event: CalendarEvent | null;
  currentUserPubkey: string | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}

export function EventDetailsDialog({
  event,
  currentUserPubkey,
  onClose,
  onEdit,
  onDelete,
}: EventDetailsDialogProps) {
  const [rsvps, setRsvps] = useState<RSVPResponse[]>([]);
  const [rsvpBusy, setRsvpBusy] = useState<string | null>(null);

  const coordinate = event ? `${event.kind}:${event.user}:${event.id}` : "";
  const isAuthor = !!event && event.user === currentUserPubkey;

  useEffect(() => {
    if (!event) return;
    let active = true;
    fetchRsvpsForEvent(coordinate)
      .then((r) => {
        if (active) setRsvps(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [event, coordinate]);

  if (!event) return null;

  const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const rows = [
    { label: "Start", value: formatDate(event.begin) },
    { label: "End", value: formatDate(event.end) },
    ...(event.location.length ? [{ label: "Location", value: event.location.join(", ") }] : []),
    ...(event.repeat.rrule ? [{ label: "Repeats", value: event.repeat.rrule }] : []),
  ];

  const sendRsvp = async (status: "accepted" | "declined" | "tentative") => {
    setRsvpBusy(status);
    try {
      await rsvpToEvent(coordinate, status, event.isPrivate);
      const refreshed = await fetchRsvpsForEvent(coordinate);
      setRsvps(refreshed);
    } finally {
      setRsvpBusy(null);
    }
  };

  return (
    <Dialog open={!!event} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {event.isPrivate && <Lock size={16} />}
        {event.title}
      </DialogTitle>
      {event.description && (
        <DialogContentText sx={{ px: 3, pb: 0 }}>{event.description}</DialogContentText>
      )}
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((row) => (
            <Box key={row.label} sx={{ display: "flex", gap: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ width: 64, flexShrink: 0 }}>
                {row.label}
              </Typography>
              <Typography variant="body2">{row.value}</Typography>
            </Box>
          ))}

          <Divider />
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            Attendees ({rsvps.length})
          </Typography>
          {rsvps.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No RSVPs yet.
            </Typography>
          )}
          {rsvps.map((r) => (
            <Box
              key={r.pubkey}
              sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {formatNpub(r.pubkey)}
              </Typography>
              <Chip label={r.status} size="small" />
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        {isAuthor ? (
          <>
            <Button
              color="error"
              variant="outlined"
              startIcon={<Trash2 size={14} />}
              onClick={() => onDelete(event)}
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
            <Button onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={
                rsvpBusy === "accepted" ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <Check size={14} />
                )
              }
              disabled={!!rsvpBusy}
              onClick={() => sendRsvp("accepted")}
            >
              Accept
            </Button>
            <Button
              variant="outlined"
              startIcon={
                rsvpBusy === "tentative" ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <CircleHelp size={14} />
                )
              }
              disabled={!!rsvpBusy}
              onClick={() => sendRsvp("tentative")}
            >
              Maybe
            </Button>
            <Button
              variant="text"
              startIcon={
                rsvpBusy === "declined" ? (
                  <CircularProgress size={12} color="inherit" />
                ) : (
                  <X size={14} />
                )
              }
              disabled={!!rsvpBusy}
              onClick={() => sendRsvp("declined")}
            >
              Decline
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
