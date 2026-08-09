import type { BoardInvitation } from "@formstr/kanban-sdk";
import { Alert, Box, Button, CircularProgress, Chip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowLeft, Check, Inbox, RefreshCw, X } from "lucide-react";
import { useSnackbar } from "notistack";
import { useEffect } from "react";

import { roleLabel } from "../../kanban/roles";
import { formatNpub } from "../../lib/npub";
import { useProfileName } from "../../lib/profileCache";
import { useKanbanMembersStore } from "../../stores/kanbanMembersStore";
import { EmptyState } from "../EmptyState";

import { AssigneeAvatar } from "./AssigneeAvatar";

interface InvitationsViewProps {
  onBack: () => void;
  /** Called with the accepted board's coordinate, which is also its board key. */
  onOpenBoard: (coordinate: string) => void;
}

/**
 * The board-invitation inbox.
 *
 * Invitations arrive as NIP-59 gift wraps addressed to the user's pubkey and
 * carry the board's view key, so they cannot hang off a board page — until one
 * is accepted, the board is not readable and not in any list.
 */
export function InvitationsView({ onBack, onOpenBoard }: InvitationsViewProps) {
  const { enqueueSnackbar } = useSnackbar();
  const invitations = useKanbanMembersStore((s) => s.invitations);
  const loading = useKanbanMembersStore((s) => s.isLoadingInvitations);
  const busy = useKanbanMembersStore((s) => s.busy);
  const error = useKanbanMembersStore((s) => s.error);
  const clearError = useKanbanMembersStore((s) => s.clearError);
  const load = useKanbanMembersStore((s) => s.loadInvitations);
  const accept = useKanbanMembersStore((s) => s.acceptInvitation);
  const dismiss = useKanbanMembersStore((s) => s.dismissInvitation);

  useEffect(() => {
    void load();
  }, [load]);

  const onAccept = async (invitation: BoardInvitation) => {
    const coordinate = await accept(invitation);
    if (!coordinate) return;
    enqueueSnackbar("Board added to your boards.", { variant: "success" });
    onOpenBoard(coordinate);
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
        <Typography variant="h6" fontWeight={600}>
          Board invitations · {invitations.length}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="small"
            startIcon={
              loading ? <CircularProgress size={12} color="inherit" /> : <RefreshCw size={14} />
            }
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ArrowLeft size={15} />}
            onClick={onBack}
          >
            Back to boards
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {invitations.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={loading ? "Looking for invitations…" : "No pending invitations"}
          description="When someone invites you to a private board, the invitation lands here with the key that opens it."
          compact
        />
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {invitations.map((invitation) => (
            <InvitationRow
              key={invitation.wrapId}
              invitation={invitation}
              busy={busy === invitation.wrapId}
              onAccept={() => void onAccept(invitation)}
              onDismiss={() => void dismiss(invitation)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface InvitationRowProps {
  invitation: BoardInvitation;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

function InvitationRow({ invitation, busy, onAccept, onDismiss }: InvitationRowProps) {
  const theme = useTheme();
  const inviter = useProfileName(invitation.inviterPubkey);
  // The board's title lives inside the encrypted event, which cannot be read
  // until the key in this invitation is used — so identify it by its `d` tag.
  const boardId = invitation.coordinate.split(":")[2] ?? invitation.coordinate;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1.5,
        borderBottom: `1px solid ${theme.palette.divider}`,
      }}
    >
      <AssigneeAvatar pubkey={invitation.inviterPubkey} size={28} />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {inviter}
          </Typography>
          <Chip
            label={roleLabel(invitation.role)}
            size="small"
            sx={{ height: 17, fontSize: 10.5 }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          invited you to board {boardId} · {formatNpub(invitation.inviterPubkey)}
        </Typography>
        {invitation.message && (
          <Typography variant="caption" sx={{ display: "block", mt: 0.25 }}>
            “{invitation.message}”
          </Typography>
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
        <Button
          size="small"
          variant="contained"
          startIcon={busy ? <CircularProgress size={10} color="inherit" /> : <Check size={12} />}
          disabled={busy}
          onClick={onAccept}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4, minWidth: 0 }}
        >
          Accept
        </Button>
        <Button
          size="small"
          variant="text"
          startIcon={<X size={12} />}
          disabled={busy}
          onClick={onDismiss}
          sx={{ fontSize: 11.5, px: 1.25, py: 0.4, color: "text.secondary", minWidth: 0 }}
        >
          Dismiss
        </Button>
      </Box>
    </Box>
  );
}
