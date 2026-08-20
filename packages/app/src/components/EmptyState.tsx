import { Box, Button, Link as MuiLink, Typography } from "@mui/material";
import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

import { useSettingsStore } from "../stores/settingsStore";
import { DISPLAY_FONT } from "../theme";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** e.g. "or ask the AI to draft one" — opens the AI panel. */
  aiHint?: string;
  /** Compact variant for panels/dialogs (smaller paddings, no mark). */
  compact?: boolean;
}

const MARK = 72;
const ARMS = 6;

/**
 * The wordmark's asterisk at rest, wrapped around the module's own icon.
 *
 * Empty is the first screen most people see, so it carries the identity rather
 * than the generic grey tile it replaced. Static by design — the animated
 * asterisk means "relays are live" and must not be diluted into decoration.
 */
function AsteriskMark({ icon: Icon }: { icon: LucideIcon }) {
  const c = MARK / 2;
  return (
    <Box sx={{ position: "relative", width: MARK, height: MARK, mb: 1 }}>
      <svg width={MARK} height={MARK} viewBox={`0 0 ${MARK} ${MARK}`} aria-hidden="true">
        {Array.from({ length: ARMS }, (_, i) => {
          const rad = ((-90 + (i * 360) / ARMS) * Math.PI) / 180;
          const dx = Math.cos(rad);
          const dy = Math.sin(rad);
          return (
            <line
              key={i}
              x1={(c + dx * 17).toFixed(2)}
              y1={(c + dy * 17).toFixed(2)}
              x2={(c + dx * 32).toFixed(2)}
              y2={(c + dy * 32).toFixed(2)}
              stroke="var(--fs-accent)"
              strokeOpacity={0.4}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fs-accent)",
        }}
      >
        <Icon size={20} />
      </Box>
    </Box>
  );
}

/** Shared empty state: asterisk mark, one-line explanation, primary CTA, AI shortcut. */
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
      {!compact && <AsteriskMark icon={Icon} />}
      <Typography
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 700,
          fontSize: compact ? "0.9375rem" : "1.125rem",
          letterSpacing: "-0.025em",
          lineHeight: 1.25,
        }}
      >
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
