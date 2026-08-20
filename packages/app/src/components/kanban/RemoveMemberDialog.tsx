import type { KanbanBoard } from "@formstr/kanban-sdk";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

import { formatNpub } from "../../lib/npub";
import { useProfileName } from "../../lib/profileCache";

interface RemoveMemberDialogProps {
  open: boolean;
  board?: KanbanBoard;
  pubkey?: string;
  cardCount: number;
  removing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RemoveMemberDialog({
  open,
  board,
  pubkey,
  cardCount,
  removing,
  onClose,
  onConfirm,
}: RemoveMemberDialogProps) {
  const name = useProfileName(pubkey ?? null);
  const who = pubkey ? name : "this member";
  const isPrivate = board?.isPrivate ?? false;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
        {isPrivate ? "Revoke access?" : "Remove editor?"}
      </DialogTitle>

      <DialogContent>
        <Typography variant="body2">
          {who}
          {pubkey && name !== formatNpub(pubkey) ? ` (${formatNpub(pubkey)})` : ""} will be removed
          from “{board?.title || "Untitled board"}”.
        </Typography>

        {isPrivate ? (
          <>
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              This rotates the board key: {cardCount} {cardCount === 1 ? "card" : "cards"} and their
              comments are republished under a new key, and everyone still on the board is
              re-invited automatically. On a large board it takes a while.
            </Typography>
            <Alert severity="warning" sx={{ mt: 1.5, py: 0.25 }}>
              <Typography variant="caption">
                Rotation is not atomic — a failure part-way leaves some cards under the new key and
                some under the old. It is also not retroactive: copies already published under the
                old key stay on relays and stay readable to anyone who kept it. This stops future
                reads, not past ones.
              </Typography>
            </Alert>
          </>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            This board is public, so this removes their permission to change cards — not their
            ability to read it. Anyone can read a public board.
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          color="error"
          variant="contained"
          disabled={removing}
          onClick={onConfirm}
        >
          {removing ? "Removing…" : isPrivate ? "Revoke and rotate key" : "Remove"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
