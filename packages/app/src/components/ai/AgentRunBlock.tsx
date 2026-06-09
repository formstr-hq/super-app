import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Check, Loader2, Slash, X } from "lucide-react";

import type { RunStep } from "../../ai/types";

function StepIcon({ status }: { status: RunStep["status"] }) {
  const theme = useTheme();
  if (status === "running")
    return <Loader2 size={12} style={{ animation: "spin 0.6s linear infinite" }} />;
  if (status === "success") return <Check size={12} color="#22c55e" />;
  if (status === "declined") return <Slash size={12} color={theme.palette.text.secondary} />;
  return <X size={12} color={theme.palette.error.main} />;
}

export function AgentRunBlock({ steps }: { steps: RunStep[] }) {
  const theme = useTheme();
  if (steps.length === 0) return null;

  const modules = Array.from(new Set(steps.map((s) => s.module).filter(Boolean)));
  const doneCount = steps.filter((s) => s.status !== "running").length;

  return (
    <Box
      sx={{
        my: 0.75,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 1.25,
          py: 0.75,
          borderBottom: `1px solid ${theme.palette.divider}`,
          fontSize: 11,
          color: "text.secondary",
        }}
      >
        Working across {modules.join(" · ") || "tools"} — {doneCount}/{steps.length} done
      </Box>
      {steps.map((s) => (
        <Box
          key={s.id}
          sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.6 }}
          title={s.resultText}
        >
          <StepIcon status={s.status} />
          <Typography
            component="span"
            sx={{ fontFamily: "monospace", fontSize: 11.5, textTransform: "lowercase" }}
          >
            {s.toolName.replace(/_/g, " ")}
          </Typography>
          {s.resultText && (
            <Typography
              component="span"
              noWrap
              sx={{ fontSize: 11, color: "text.secondary", flex: 1, minWidth: 0 }}
            >
              {s.resultText.split("\n")[0]}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
