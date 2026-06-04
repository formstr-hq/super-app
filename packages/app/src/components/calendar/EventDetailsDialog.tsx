import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { formatNpub } from "../../lib/npub";
import type { CalendarEvent, RSVPResponse } from "../../services/calendar";
import { fetchRsvpsForEvent, rsvpToEvent } from "../../services/calendar/rsvp";

import { RSVPBar, type RSVPBarPayload, type RSVPBarStatus } from "./RSVPBar";

interface EventDetailsDialogProps {
  event: CalendarEvent | null;
  currentUserPubkey: string | null;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}

const formatTime = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function EventDetailsDialog({
  event,
  currentUserPubkey,
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

  const myStatus = currentUserPubkey
    ? (rsvps.find((r) => r.pubkey === currentUserPubkey)?.status as RSVPBarStatus | undefined)
    : undefined;

  const submitRsvp = async (payload: RSVPBarPayload) => {
    setSubmitting(true);
    try {
      await rsvpToEvent(coordinate, payload.status, event.isPrivate, payload);
      const refreshed = await fetchRsvpsForEvent(coordinate);
      setRsvps(refreshed);
    } finally {
      setSubmitting(false);
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
          <RSVPBar
            event={event}
            myStatus={myStatus}
            isSubmitting={submitting}
            onSubmit={submitRsvp}
          />

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
            <Box key={r.pubkey} sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {formatNpub(r.pubkey)}
                </Typography>
                <Chip label={r.status} size="small" />
              </Box>
              {r.comment && (
                <Typography variant="caption" color="text.secondary">
                  “{r.comment}”
                </Typography>
              )}
              {r.suggestedStart && (
                <Typography variant="caption" color="text.secondary">
                  suggests {formatTime(r.suggestedStart)}
                  {r.suggestedEnd ? ` – ${formatTime(r.suggestedEnd)}` : ""}
                </Typography>
              )}
            </Box>
          ))}
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
