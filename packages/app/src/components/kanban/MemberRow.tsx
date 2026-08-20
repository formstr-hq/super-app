import type { BoardMember, KanbanBoard } from "@formstr/kanban-sdk";
import { Box, IconButton, MenuItem, TextField, Tooltip, Typography } from "@mui/material";
import { UserMinus } from "lucide-react";

import { assignableRoles, roleHelp, roleLabel } from "../../kanban/roles";
import { formatNpub } from "../../lib/npub";
import { useProfileName } from "../../lib/profileCache";
import type { AssignableRole } from "../../stores/kanbanMembersStore";

import { AssigneeAvatar } from "./AssigneeAvatar";

interface MemberRowProps {
  member: BoardMember;
  board: KanbanBoard;
  /** Owner-only. Everyone else sees the roster with no controls. */
  manageable: boolean;
  busy: boolean;
  isSelf: boolean;
  onRoleChange: (role: AssignableRole) => void;
  onRemove: () => void;
}

export function MemberRow({
  member,
  board,
  manageable,
  busy,
  isSelf,
  onRoleChange,
  onRemove,
}: MemberRowProps) {
  const name = useProfileName(member.pubkey);
  const npub = formatNpub(member.pubkey);
  // The owner is the board's author — their role is the event's signature, not
  // a tag, so it cannot be changed or revoked by anyone including themselves.
  const editable = manageable && member.role !== "owner";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, py: 0.75 }}>
      <AssigneeAvatar pubkey={member.pubkey} size={26} />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500} noWrap>
          {name}
          {isSelf && (
            <Typography component="span" variant="caption" color="text.secondary">
              {" "}
              (you)
            </Typography>
          )}
        </Typography>
        {name !== npub && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {npub}
          </Typography>
        )}
      </Box>

      {editable ? (
        <TextField
          select
          size="small"
          value={member.role}
          disabled={busy}
          onChange={(e) => onRoleChange(e.target.value as AssignableRole)}
          inputProps={{ "aria-label": `Role for ${npub}` }}
          sx={{ width: 116 }}
        >
          {assignableRoles(board).map((role) => (
            <MenuItem key={role} value={role}>
              {roleLabel(role)}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Tooltip title={roleHelp(member.role)}>
          <Typography variant="caption" color="text.secondary">
            {roleLabel(member.role)}
          </Typography>
        </Tooltip>
      )}

      {editable && (
        <Tooltip title={board.isPrivate ? "Revoke access" : "Remove editor"}>
          <span>
            <IconButton
              size="small"
              aria-label={`Remove ${npub}`}
              disabled={busy}
              onClick={onRemove}
            >
              <UserMinus size={15} />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}
