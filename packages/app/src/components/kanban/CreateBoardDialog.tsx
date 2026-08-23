import type { BoardDraft, Column, KanbanBoard } from "@formstr/kanban-sdk";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

const DEFAULT_COLUMNS: Column[] = [
  { id: "todo", name: "To Do", order: 0 },
  { id: "doing", name: "In Progress", order: 1 },
  { id: "done", name: "Done", order: 2 },
];

interface CreateBoardDialogProps {
  open: boolean;
  /** When set, the dialog edits this board instead of creating one. */
  board?: KanbanBoard;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: BoardDraft) => void;
}

export function CreateBoardDialog({
  open,
  board,
  saving,
  onClose,
  onSubmit,
}: CreateBoardDialogProps) {
  const editing = board !== undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(board?.title ?? "");
    setDescription(board?.description ?? "");
    setColumns(board ? [...board.columns].sort((a, b) => a.order - b.order) : DEFAULT_COLUMNS);
    setIsPrivate(board?.isPrivate ?? false);
  }, [open, board]);

  const renameColumn = (index: number, name: string) => {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, name } : c)));
  };

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      { id: crypto.randomUUID().slice(0, 8), name: "New column", order: prev.length },
    ]);
  };

  const removeColumn = (index: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== index).map((c, i) => ({ ...c, order: i })));
  };

  const canSubmit = title.trim().length > 0 && columns.length > 0 && !saving;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      columns: columns.map((c, i) => ({
        ...c,
        name: c.name.trim() || `Column ${i + 1}`,
        order: i,
      })),
      // Privacy is fixed at creation: a board's kind (30301 vs 32301) is its
      // identity, so flipping it would orphan every existing card.
      ...(editing ? {} : { private: isPrivate }),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
        {editing ? "Edit board" : "New board"}
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
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <Box>
            <Typography variant="caption" color="text.secondary">
              Columns
            </Typography>
            <Stack spacing={1} sx={{ mt: 0.75 }}>
              {columns.map((column, i) => (
                <Box key={column.id} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={column.name}
                    onChange={(e) => renameColumn(i, e.target.value)}
                    inputProps={{ "aria-label": `Column ${i + 1} name` }}
                  />
                  <IconButton
                    size="small"
                    aria-label={`Remove column ${column.name}`}
                    disabled={columns.length === 1}
                    onClick={() => removeColumn(i)}
                  >
                    <X size={14} />
                  </IconButton>
                </Box>
              ))}
            </Stack>
            <Button size="small" startIcon={<Plus size={13} />} onClick={addColumn} sx={{ mt: 1 }}>
              Add column
            </Button>
          </Box>

          {!editing && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Private board</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Encrypted under a view key. Only people you share the key with can read it.
                  </Typography>
                </Box>
              }
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" disabled={!canSubmit} onClick={submit}>
          {saving ? "Saving…" : editing ? "Save" : "Create board"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
