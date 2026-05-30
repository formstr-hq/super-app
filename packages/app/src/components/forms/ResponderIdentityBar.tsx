import { Box, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { PersonStanding, UserX } from "lucide-react";

import { useAuthStore } from "../../stores";

export type IdentityMode = "anonymous" | "me";

interface Props {
  mode: IdentityMode;
  onChange: (mode: IdentityMode) => void;
  /** When true, hides both options (form requires login — parent handles that flow). */
  requiresLogin?: boolean;
}

export function ResponderIdentityBar({ mode, onChange, requiresLogin }: Props) {
  const pubkey = useAuthStore((s) => s.pubkey);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  if (requiresLogin || !isLoggedIn) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
      <Typography variant="caption" color="text.secondary">
        Submit as:
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_, val) => {
          if (val) onChange(val as IdentityMode);
        }}
      >
        <ToggleButton value="anonymous">
          <UserX size={14} style={{ marginRight: 4 }} />
          Anonymous
        </ToggleButton>
        <ToggleButton value="me">
          <PersonStanding size={14} style={{ marginRight: 4 }} />
          {pubkey ? pubkey.slice(0, 8) + "…" : "Me"}
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
