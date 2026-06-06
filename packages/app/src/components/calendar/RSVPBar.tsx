import {
  Box,
  Button,
  ButtonGroup,
  Collapse,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

export type RSVPBarStatus = "accepted" | "declined" | "tentative";

export interface RSVPBarPayload {
  status: RSVPBarStatus;
  /** Unix seconds — only set when the user proposes a different time. */
  suggestedStart?: number;
  suggestedEnd?: number;
  comment?: string;
}

interface RSVPBarProps {
  /** The event being responded to; begin/end are ms timestamps. */
  event: { begin: number; end: number };
  /** The current user's existing status, used to highlight the active choice. */
  myStatus?: RSVPBarStatus;
  isSubmitting: boolean;
  onSubmit: (payload: RSVPBarPayload) => void;
}

const STATUS_LABELS: { label: string; status: RSVPBarStatus }[] = [
  { label: "Yes", status: "accepted" },
  { label: "Maybe", status: "tentative" },
  { label: "No", status: "declined" },
];

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The RSVP questionnaire for a calendar event: a Yes/Maybe/No segmented
 * control plus collapsible "suggest a new time" and "add a note" sections.
 * Clicking a status button submits immediately, carrying whatever suggested
 * time / note the user has entered. Matches calendar.formstr.app feature-for-
 * feature, restyled monochrome per the approved super-app mockup.
 */
export function RSVPBar({ event, myStatus, isSubmitting, onSubmit }: RSVPBarProps) {
  const initialStart = toLocalInput(event.begin);
  const initialEnd = toLocalInput(event.end);

  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [comment, setComment] = useState("");
  const [showTime, setShowTime] = useState(false);
  const [showNote, setShowNote] = useState(false);

  const buildPayload = (status: RSVPBarStatus): RSVPBarPayload => ({
    status,
    // Only propose a time when the user actually changed it from the event's own.
    suggestedStart:
      start && start !== initialStart ? Math.floor(new Date(start).getTime() / 1000) : undefined,
    suggestedEnd:
      end && end !== initialEnd ? Math.floor(new Date(end).getTime() / 1000) : undefined,
    comment: comment.trim() || undefined,
  });

  const submit = (status: RSVPBarStatus) => onSubmit(buildPayload(status));

  return (
    <Stack spacing={1.25}>
      <Typography variant="subtitle2" fontWeight={600}>
        Will you be attending?
      </Typography>

      <ButtonGroup size="small" disabled={isSubmitting} disableElevation>
        {STATUS_LABELS.map(({ label, status }) => (
          <Button
            key={status}
            variant={myStatus === status ? "contained" : "outlined"}
            color="inherit"
            onClick={() => submit(status)}
          >
            {label}
          </Button>
        ))}
      </ButtonGroup>

      <Box>
        <Typography variant="caption" color="text.secondary">
          Can&apos;t attend at this time?{" "}
          <Link
            component="button"
            type="button"
            underline="hover"
            color="text.primary"
            fontWeight={600}
            onClick={() => setShowTime((v) => !v)}
            sx={{ verticalAlign: "baseline" }}
          >
            Suggest a new time
          </Link>
          <ChevronDown size={12} style={{ marginLeft: 2, verticalAlign: "middle", opacity: 0.6 }} />
        </Typography>
        <Collapse in={showTime}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
            <TextField
              label="New start"
              type="datetime-local"
              size="small"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="New end"
              type="datetime-local"
              size="small"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
        </Collapse>
      </Box>

      <Box>
        <Link
          component="button"
          type="button"
          underline="hover"
          color="text.primary"
          fontWeight={600}
          variant="caption"
          onClick={() => setShowNote((v) => !v)}
        >
          Add a note
          <ChevronDown size={12} style={{ marginLeft: 2, verticalAlign: "middle", opacity: 0.6 }} />
        </Link>
        <Collapse in={showNote}>
          <TextField
            placeholder="Add a note"
            multiline
            minRows={2}
            size="small"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          />
        </Collapse>
      </Box>
    </Stack>
  );
}
