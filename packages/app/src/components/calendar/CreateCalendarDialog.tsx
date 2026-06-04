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
import { useState } from "react";

interface CreateCalendarDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, color: string) => Promise<unknown>;
}

export function CreateCalendarDialog({ open, onClose, onCreate }: CreateCalendarDialogProps) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#334155");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!title) return;
    setIsSubmitting(true);
    try {
      await onCreate(title, color);
      setTitle("");
      setColor("#334155");
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>New Calendar</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 2 }}>
        <TextField
          label="Calendar name"
          size="small"
          fullWidth
          placeholder="My Calendar"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Color
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              component="input"
              type="color"
              value={color}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
              sx={{
                width: 48,
                height: 32,
                borderRadius: 1,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "transparent",
                cursor: "pointer",
                p: 0.25,
              }}
            />
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              {color}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={!title || isSubmitting}>
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
