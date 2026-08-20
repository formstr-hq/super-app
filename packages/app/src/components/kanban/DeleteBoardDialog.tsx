import type { KanbanBoard } from "@formstr/kanban-sdk";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

interface DeleteBoardDialogProps {
  open: boolean;
  board?: KanbanBoard;
  cardCount: number;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteBoardDialog({
  open,
  board,
  cardCount,
  deleting,
  onClose,
  onConfirm,
}: DeleteBoardDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Delete this board?</DialogTitle>

      <DialogContent>
        <Typography variant="body2">
          “{board?.title || "Untitled board"}” and its {cardCount}{" "}
          {cardCount === 1 ? "card" : "cards"} will be tombstoned.
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          A Nostr deletion is a request, not an erasure. Relays that honor NIP-09 will stop serving
          the board, but any that ignore it — or that already handed a copy to another client — keep
          theirs. Treat this as “remove from my boards”, not “destroy everywhere”.
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          color="error"
          variant="contained"
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting ? "Deleting…" : "Delete board"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
