import { Box, Button, Link as MuiLink, Typography } from "@mui/material";
import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

import { useSettingsStore } from "../stores/settingsStore";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** e.g. "or ask the AI to draft one" — opens the AI panel. */
  aiHint?: string;
  /** Compact variant for panels/dialogs (smaller paddings, no icon tile). */
  compact?: boolean;
}

/** Shared empty state: icon tile, one-line explanation, primary CTA, AI shortcut. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  aiHint,
  compact = false,
}: EmptyStateProps) {
  const setAIPanelOpen = useSettingsStore((s) => s.setAIPanelOpen);

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        py: compact ? 3 : 8,
        px: 2,
        textAlign: "center",
      }}
    >
      {!compact && (
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.5,
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            mb: 0.5,
          }}
        >
          <Icon size={17} />
        </Box>
      )}
      <Typography variant="body2" fontWeight={600}>
        {title}
      </Typography>
      {description && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ maxWidth: 360, lineHeight: 1.5 }}
        >
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button
          size="small"
          variant="contained"
          startIcon={<Plus size={14} />}
          onClick={onAction}
          sx={{ mt: 0.75 }}
        >
          {actionLabel}
        </Button>
      )}
      {aiHint && (
        <MuiLink
          component="button"
          type="button"
          variant="caption"
          color="text.secondary"
          onClick={() => setAIPanelOpen(true)}
        >
          {aiHint}
        </MuiLink>
      )}
    </Box>
  );
}
