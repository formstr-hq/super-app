import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarList,
} from "@formstr/agent/services/calendar";
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { npubToHex } from "../../lib/npub";
import { buildRRuleString, parseRRuleString, type RRuleParts } from "../../lib/rrule";

import { RecurrenceField } from "./RecurrenceField";

/** Format an epoch-ms instant as a `datetime-local` input value in local time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(ms - offsetMs).toISOString().slice(0, 16);
}

interface EventDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: CalendarEventDraft) => Promise<unknown>;
  calendars: CalendarList[];
  /** When provided, the dialog is in edit mode and prefills from this event. */
  event?: CalendarEvent | null;
  defaultDate?: Date;
}

export function EventDialog({
  open,
  onClose,
  onSubmit,
  calendars,
  event,
  defaultDate,
}: EventDialogProps) {
  const editing = !!event;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [calendarId, setCalendarId] = useState("none");
  const [isPrivate, setIsPrivate] = useState(true);
  const [participantsText, setParticipantsText] = useState("");
  const [rruleParts, setRruleParts] = useState<RRuleParts | null>(null);
  const [formRef, setFormRef] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stable primitive so the reset effect doesn't re-run on every parent render
  // (the `calendars` array identity can change) — only when the default changes.
  const firstCalendarId = calendars[0]?.id;

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setDescription(event.description);
      setBegin(toLocalInput(event.begin));
      setEnd(toLocalInput(event.end));
      setLocation(event.location[0] ?? "");
      setCalendarId(event.calendarId ?? "none");
      setIsPrivate(event.isPrivate);
      setParticipantsText(event.participants.join(", "));
      setRruleParts(parseRRuleString(event.repeat.rrule));
      setFormRef(event.registrationFormRef ?? "");
      setAdvancedOpen(
        !!event.repeat.rrule || !!event.registrationFormRef || event.participants.length > 0,
      );
    } else {
      const base = defaultDate ?? new Date();
      setTitle("");
      setDescription("");
      setLocation("");
      // Default to the first calendar so the (private-by-default) event has a
      // home where its viewKey is stored — matching calendar.formstr.app.
      setCalendarId(firstCalendarId ?? "none");
      // Private (encrypted, viewKey-backed) by default, like the standalone, so
      // new events are shareable + visible in calendar.formstr.app.
      setIsPrivate(true);
      setParticipantsText("");
      setRruleParts(null);
      setFormRef("");
      setAdvancedOpen(false);
      setBegin(toLocalInput(base.getTime()));
      setEnd(toLocalInput(base.getTime() + 3_600_000));
    }
  }, [open, event, defaultDate, firstCalendarId]);

  const handleSubmit = async () => {
    if (!title || !begin) return;
    setIsSubmitting(true);
    try {
      const beginDate = new Date(begin);
      const endDate = end ? new Date(end) : new Date(beginDate.getTime() + 3_600_000);
      const participants = participantsText
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(npubToHex)
        .filter((p): p is string => !!p);
      await onSubmit({
        title,
        description,
        begin: beginDate,
        end: endDate,
        location: location || undefined,
        calendarId: calendarId === "none" ? undefined : calendarId,
        isPrivate,
        participants: participants.length ? participants : undefined,
        rrule: buildRRuleString(rruleParts),
        registrationFormRef: formRef || undefined,
        existingId: event?.id,
      });
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? "Edit Event" : "New Event"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 2 }}>
        <TextField
          label="Title"
          size="small"
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <TextField
            label="Start"
            size="small"
            type="datetime-local"
            value={begin}
            onChange={(e) => setBegin(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="End"
            size="small"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
        <TextField
          label="Location (optional)"
          size="small"
          fullWidth
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextField
          label="Description (optional)"
          size="small"
          fullWidth
          multiline
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {calendars.length > 0 && (
          <FormControl size="small" fullWidth>
            <Select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              <MenuItem value="none">No calendar</MenuItem>
              {calendars.map((cal) => (
                <MenuItem key={cal.id} value={cal.id}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      sx={{
                        width: 11,
                        height: 11,
                        borderRadius: "3px",
                        bgcolor: cal.color,
                        flexShrink: 0,
                      }}
                    />
                    {cal.title || "Untitled"}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
          }
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Lock size={12} />
              <Typography variant="body2">Private (encrypted)</Typography>
            </Box>
          }
        />

        <Button
          size="small"
          variant="text"
          onClick={() => setAdvancedOpen((v) => !v)}
          startIcon={advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          sx={{ alignSelf: "flex-start", color: "text.secondary" }}
        >
          Advanced
        </Button>
        <Collapse in={advancedOpen} unmountOnExit>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              label="Participants (npub or hex, comma-separated)"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={participantsText}
              onChange={(e) => setParticipantsText(e.target.value)}
              helperText="Each participant receives a NIP-59 invitation."
            />
            <RecurrenceField value={rruleParts} onChange={setRruleParts} />
            <TextField
              label="Registration form (naddr/coordinate, optional)"
              size="small"
              fullWidth
              value={formRef}
              onChange={(e) => setFormRef(e.target.value)}
            />
          </Box>
        </Collapse>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!title || !begin || isSubmitting}
        >
          {isSubmitting ? "Saving…" : editing ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
