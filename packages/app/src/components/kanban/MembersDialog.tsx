import type { KanbanBoard } from "@formstr/kanban-sdk";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useSnackbar } from "notistack";
import { useEffect, useState } from "react";

import {
  assignableRoles,
  boardMembers,
  canManageMembers,
  parseInvitee,
  roleLabel,
} from "../../kanban/roles";
import { useKanbanMembersStore, type AssignableRole } from "../../stores/kanbanMembersStore";

import { MemberRow } from "./MemberRow";
import { RemoveMemberDialog } from "./RemoveMemberDialog";

interface MembersDialogProps {
  open: boolean;
  board?: KanbanBoard;
  /** The signed-in pubkey, for the "(you)" marker and the owner gate. */
  self: string | null;
  /** Live cards on the board — what a key rotation would have to republish. */
  cardCount: number;
  onClose: () => void;
}

export function MembersDialog({ open, board, self, cardCount, onClose }: MembersDialogProps) {
  const { enqueueSnackbar } = useSnackbar();
  const busy = useKanbanMembersStore((s) => s.busy);
  const error = useKanbanMembersStore((s) => s.error);
  const clearError = useKanbanMembersStore((s) => s.clearError);
  const invite = useKanbanMembersStore((s) => s.invite);
  const setRole = useKanbanMembersStore((s) => s.setRole);
  const removeMember = useKanbanMembersStore((s) => s.removeMember);

  const [input, setInput] = useState("");
  const [role, setRoleChoice] = useState<AssignableRole>("maintainer");
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInput("");
    setNote("");
    setInputError(null);
    setRemoving(null);
    clearError();
  }, [open, clearError]);

  // A public board has no viewer role, so a stale "member" choice would ask for
  // something the board cannot express.
  useEffect(() => {
    if (board && !board.isPrivate) setRoleChoice("maintainer");
  }, [board]);

  if (!board) return null;

  const manageable = canManageMembers(board, self);
  const members = boardMembers(board);

  const submitInvite = async () => {
    const parsed = parseInvitee(input, board, self);
    if ("error" in parsed) {
      setInputError(parsed.error);
      return;
    }
    setInputError(null);
    try {
      await invite(board, parsed.pubkey, role, note.trim() || undefined);
      setInput("");
      setNote("");
      enqueueSnackbar(
        board.isPrivate
          ? "Invitation sent — it carries the board key."
          : "Editor added to the board.",
        { variant: "success" },
      );
    } catch {
      /* the store holds the message; the Alert below shows it */
    }
  };

  const changeRole = async (pubkey: string, next: AssignableRole) => {
    try {
      await setRole(board, pubkey, next);
      enqueueSnackbar(
        board.isPrivate
          ? `Role changed to ${roleLabel(next).toLowerCase()} — invitation re-sent.`
          : `Role changed to ${roleLabel(next).toLowerCase()}.`,
        { variant: "success" },
      );
    } catch {
      /* store error */
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await removeMember(board, removing);
      enqueueSnackbar(
        board.isPrivate ? "Access revoked and board key rotated." : "Editor removed.",
        { variant: "success" },
      );
      setRemoving(null);
    } catch {
      // Leave the dialog up: after a failed rotation the member list is exactly
      // what the user needs to look at.
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Members · {members.length}</DialogTitle>

        <DialogContent>
          {error && (
            <Alert severity="error" onClose={clearError} sx={{ mb: 1.5 }}>
              {error}
            </Alert>
          )}

          {!manageable && (
            <Alert severity="info" sx={{ mb: 1.5, py: 0.25 }}>
              <Typography variant="caption">Only the board owner can change members.</Typography>
            </Alert>
          )}

          <Stack divider={<Divider flexItem />}>
            {members.map((member) => (
              <MemberRow
                key={member.pubkey}
                member={member}
                board={board}
                manageable={manageable}
                busy={busy === member.pubkey}
                isSelf={member.pubkey === self}
                onRoleChange={(next) => void changeRole(member.pubkey, next)}
                onRemove={() => setRemoving(member.pubkey)}
              />
            ))}
          </Stack>

          {manageable && (
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="caption" color="text.secondary">
                Invite someone
              </Typography>

              <Box sx={{ display: "flex", gap: 1, mt: 0.75 }}>
                <TextField
                  size="small"
                  fullWidth
                  label="npub or hex public key"
                  value={input}
                  error={Boolean(inputError)}
                  helperText={inputError ?? " "}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setInputError(null);
                  }}
                />
                <TextField
                  select
                  size="small"
                  label="Role"
                  value={role}
                  disabled={!board.isPrivate}
                  onChange={(e) => setRoleChoice(e.target.value as AssignableRole)}
                  sx={{ width: 132 }}
                  helperText=" "
                >
                  {assignableRoles(board).map((option) => (
                    <MenuItem key={option} value={option}>
                      {roleLabel(option)}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>

              {board.isPrivate && (
                <TextField
                  size="small"
                  fullWidth
                  label="Message (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  sx={{ mt: 0.5 }}
                />
              )}

              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1.5 }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy !== null || input.trim().length === 0}
                  onClick={() => void submitInvite()}
                >
                  {busy !== null ? "Sending…" : "Invite"}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {board.isPrivate
                    ? "Editors can change cards; viewers can only read. The invitation carries the board key, encrypted to them."
                    : "This board is public — anyone can read it. Editors are the people who may change its cards."}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <RemoveMemberDialog
        open={removing !== null}
        board={board}
        pubkey={removing ?? undefined}
        cardCount={cardCount}
        removing={busy !== null && busy === removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
