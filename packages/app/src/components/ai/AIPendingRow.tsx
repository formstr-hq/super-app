import { Box, Skeleton, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useAIPendingStore, type AIModule } from "../../stores/aiPendingStore";

interface AIPendingRowProps {
  module: AIModule;
  label?: string;
}

export function AIPendingRow({ module, label }: AIPendingRowProps) {
  const theme = useTheme();
  const allPending = useAIPendingStore((s) => s.pending);
  const pending = useMemo(
    () => allPending.filter((p) => p.module === module),
    [allPending, module],
  );

  if (pending.length === 0) return null;

  return (
    <Box
      sx={{
        mb: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        borderRadius: 1.5,
        border: `1px dashed ${theme.palette.primary.main}44`,
        bgcolor: `${theme.palette.primary.main}08`,
        p: 1.5,
      }}
    >
      {pending.map((entry) => (
        <Box key={entry.id} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Sparkles
            size={16}
            style={{
              flexShrink: 0,
              color: theme.palette.primary.main,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography variant="caption" fontWeight={500} sx={{ color: "primary.main" }}>
                AI is running
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: "monospace", color: "primary.main" }}>
                {entry.toolName}
              </Typography>
              {label && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  — {label}
                </Typography>
              )}
            </Box>
            <Skeleton variant="text" width="75%" height={12} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
