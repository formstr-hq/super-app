import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";

import type { CalendarList } from "../../services/calendar";

/** Calendar swatch palette — the first eight standalone presets. */
const PRESET_COLORS = [
  "#4285f4",
  "#0b8043",
  "#8e24aa",
  "#d50000",
  "#f4511e",
  "#f6bf26",
  "#039be5",
  "#616161",
];

export interface CalendarSaveData {
  /** Present when editing an existing calendar. */
  id?: string;
  title: string;
  description: string;
  color: string;
}

interface CalendarManageDialogProps {
  open: boolean;
  /** When provided the dialog opens in edit mode and prefills from this list. */
  calendar?: CalendarList | null;
  onClose: () => void;
  onSave: (data: CalendarSaveData) => Promise<unknown> | void;
  /** Only rendered (as a Delete action) in edit mode. */
  onDelete?: (calendar: CalendarList) => Promise<unknown> | void;
}

/**
 * Create / edit / delete a calendar. Monochrome per the approved super-app
 * mockup: Name, optional Description, an eight-swatch color picker, and a
 * Delete action that only appears when editing.
 */
export function CalendarManageDialog({
  open,
  calendar,
  onClose,
  onSave,
  onDelete,
}: CalendarManageDialogProps) {
  const isEdit = !!calendar;
  const [title, setTitle] = useState(calendar?.title ?? "");
  const [description, setDescription] = useState(calendar?.description ?? "");
  const [color, setColor] = useState(calendar?.color ?? PRESET_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);

  // Re-hydrate when the dialog is reused for a different calendar (or reopened).
  useEffect(() => {
    setTitle(calendar?.title ?? "");
    setDescription(calendar?.description ?? "");
    setColor(calendar?.color ?? PRESET_COLORS[0]);
  }, [calendar, open]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSave({
        id: calendar?.id,
        title: title.trim(),
        description: description.trim(),
        color,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{isEdit ? "Edit calendar" : "New calendar"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <TextField
          label="Name"
          size="small"
          fullWidth
          placeholder="Work"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="Description (optional)"
          size="small"
          fullWidth
          placeholder="What's this calendar for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Color
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {PRESET_COLORS.map((preset) => (
              <Box
                key={preset}
                component="button"
                type="button"
                aria-label={`Color ${preset}`}
                onClick={() => setColor(preset)}
                sx={{
                  width: 26,
                  height: 26,
                  p: 0,
                  borderRadius: "50%",
                  bgcolor: preset,
                  cursor: "pointer",
                  border: "2px solid",
                  borderColor: color === preset ? "text.primary" : "transparent",
                  boxShadow: color === preset ? "0 0 0 2px #fff inset" : "none",
                }}
              />
            ))}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: isEdit && onDelete ? "space-between" : "flex-end" }}>
        {isEdit && onDelete && (
          <Button color="error" onClick={() => onDelete(calendar)} disabled={submitting}>
            Delete
          </Button>
        )}
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={!title.trim() || submitting}>
            Save
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
