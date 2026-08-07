import type { CardDraft, KanbanCard } from "@formstr/kanban-sdk";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";

interface CardDialogProps {
  open: boolean;
  /** When set, the dialog edits this card instead of creating one. */
  card?: KanbanCard;
  /** Column heading shown in the title, for context when creating. */
  columnName: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: CardDraft) => void;
  onDelete?: () => void;
}

/** Comma-separated input ⇄ string list, trimmed and de-duplicated. */
function parseList(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

export function CardDialog({
  open,
  card,
  columnName,
  saving,
  onClose,
  onSubmit,
  onDelete,
}: CardDialogProps) {
  const editing = card !== undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [assignees, setAssignees] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(card?.title ?? "");
    setDescription(card?.description ?? "");
    setLabels(card?.labels.join(", ") ?? "");
    setAssignees(card?.assignees.join(", ") ?? "");
  }, [open, card]);

  const canSubmit = title.trim().length > 0 && !saving;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      labels: parseList(labels),
      assignees: parseList(assignees),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
        {editing ? "Edit card" : `New card in ${columnName}`}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Title"
            size="small"
            fullWidth
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            label="Description"
            size="small"
            fullWidth
            multiline
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextField
            label="Labels"
            size="small"
            fullWidth
            placeholder="bug, urgent"
            helperText="Comma-separated"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
          />
          <TextField
            label="Assignees"
            size="small"
            fullWidth
            placeholder="hex pubkeys, comma-separated"
            value={assignees}
            onChange={(e) => setAssignees(e.target.value)}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {editing && onDelete && (
          <Button size="small" color="error" onClick={onDelete} sx={{ mr: "auto" }}>
            Delete
          </Button>
        )}
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" disabled={!canSubmit} onClick={submit}>
          {saving ? "Saving…" : editing ? "Save" : "Add card"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
