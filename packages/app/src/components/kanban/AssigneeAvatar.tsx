import { Box, Tooltip } from "@mui/material";

import { formatNpub } from "../../lib/npub";
import { avatarColor, avatarInitials } from "../../lib/pubkeyAvatar";

interface AssigneeAvatarProps {
  pubkey: string;
  size?: number;
}

/** A pubkey as a colour and two letters, with the readable npub on hover. */
export function AssigneeAvatar({ pubkey, size = 18 }: AssigneeAvatarProps) {
  return (
    <Tooltip title={formatNpub(pubkey)}>
      <Box
        aria-label={formatNpub(pubkey)}
        sx={{
          width: size,
          height: size,
          borderRadius: "3px",
          flexShrink: 0,
          bgcolor: avatarColor(pubkey),
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size <= 18 ? 9 : 10,
          fontWeight: 600,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          letterSpacing: "0.02em",
          userSelect: "none",
        }}
      >
        {avatarInitials(pubkey)}
      </Box>
    </Tooltip>
  );
}

interface AssigneeStackProps {
  pubkeys: string[];
  /** Show at most this many before collapsing the rest into a +N tile. */
  max?: number;
  size?: number;
}

export function AssigneeStack({ pubkeys, max = 2, size = 18 }: AssigneeStackProps) {
  if (pubkeys.length === 0) return null;
  const shown = pubkeys.slice(0, max);
  const overflow = pubkeys.length - shown.length;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.375 }}>
      {shown.map((pubkey) => (
        <AssigneeAvatar key={pubkey} pubkey={pubkey} size={size} />
      ))}
      {overflow > 0 && (
        <Tooltip title={pubkeys.slice(max).map(formatNpub).join(", ")}>
          <Box
            sx={{
              height: size,
              minWidth: size,
              px: 0.375,
              borderRadius: "3px",
              bgcolor: "action.selected",
              color: "text.secondary",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 600,
            }}
          >
            +{overflow}
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}
