import { Box, Tooltip } from "@mui/material";
import { useEffect, useState } from "react";

import { formatNpub } from "../../lib/npub";
import { useProfile } from "../../lib/profileCache";
import { avatarColor, avatarInitials, initialsFromName } from "../../lib/pubkeyAvatar";

interface AssigneeAvatarProps {
  pubkey: string;
  size?: number;
}

/**
 * Someone's face, or the next best thing.
 *
 * Three steps down: the kind-0 picture, the initials of the kind-0 name, then
 * two characters of the npub. Each step is what the one before it falls back to
 * — on first paint nothing has been fetched yet, so every avatar starts at the
 * npub and improves in place when the profile lands.
 */
export function AssigneeAvatar({ pubkey, size = 18 }: AssigneeAvatarProps) {
  const profile = useProfile(pubkey);
  const [pictureFailed, setPictureFailed] = useState(false);

  const name = profile?.displayName || profile?.name || "";
  const npub = formatNpub(pubkey);
  const picture = profile?.picture;

  // A rotated profile deserves a fresh attempt at its new picture.
  useEffect(() => setPictureFailed(false), [picture]);

  const tile = {
    width: size,
    height: size,
    borderRadius: "3px",
    flexShrink: 0,
  };

  if (picture && !pictureFailed) {
    return (
      <Tooltip title={name || npub}>
        <Box
          component="img"
          src={picture}
          alt={name || npub}
          // Picture URLs rot — the host disappears, the CDN blocks the referrer.
          // A broken image element identifies nobody; the initials still do.
          onError={() => setPictureFailed(true)}
          sx={{ ...tile, objectFit: "cover", bgcolor: avatarColor(pubkey) }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={name || npub}>
      <Box
        aria-label={npub}
        sx={{
          ...tile,
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
        {initialsFromName(name) ?? avatarInitials(pubkey)}
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
