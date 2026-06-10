import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** One line; hidden on xs. */
  description?: string;
  /** Pinned right (primary action, toggles…). */
  action?: ReactNode;
}

/** Compact self-describing header at the top of each module's main pane. */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
          {title}
        </Typography>
        {description && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: { xs: "none", sm: "block" } }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0, display: "flex", gap: 1 }}>{action}</Box>}
    </Box>
  );
}
