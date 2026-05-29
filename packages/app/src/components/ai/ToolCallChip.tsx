import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  Calendar,
  Check,
  ClipboardList,
  FileText,
  FolderOpen,
  Loader2,
  Vote,
  Wrench,
  X,
} from "lucide-react";

import type { ToolCall } from "../../ai/types";
import { moduleForTool } from "../../stores/aiPendingStore";

const MODULE_ICONS = {
  forms: ClipboardList,
  calendar: Calendar,
  pages: FileText,
  drive: FolderOpen,
  polls: Vote,
} as const;

const MODULE_COLORS: Record<string, { light: string; dark: string }> = {
  forms: { light: "#2563eb22", dark: "#1d4ed822" },
  calendar: { light: "#ea580c22", dark: "#c2410c22" },
  pages: { light: "#16a34a22", dark: "#15803d22" },
  drive: { light: "#9333ea22", dark: "#7e22ce22" },
  polls: { light: "#db277722", dark: "#be185d22" },
};

const MODULE_TEXT: Record<string, { light: string; dark: string }> = {
  forms: { light: "#1d4ed8", dark: "#93c5fd" },
  calendar: { light: "#c2410c", dark: "#fdba74" },
  pages: { light: "#15803d", dark: "#86efac" },
  drive: { light: "#7e22ce", dark: "#d8b4fe" },
  polls: { light: "#be185d", dark: "#f9a8d4" },
};

function humanize(toolName: string) {
  return toolName.replace(/_/g, " ");
}

export function ToolCallChip({ toolCall }: { toolCall: ToolCall }) {
  const status = toolCall.status ?? "pending";
  const module = moduleForTool(toolCall.name);
  const Icon = module ? MODULE_ICONS[module] : Wrench;
  const theme = useTheme();
  const mode = theme.palette.mode;

  const bgColor = module ? MODULE_COLORS[module]?.[mode] : undefined;
  const textColor = module ? MODULE_TEXT[module]?.[mode] : theme.palette.text.secondary;

  const StatusIcon = status === "pending" ? Loader2 : status === "success" ? Check : X;
  const statusColor =
    status === "success" ? "#22c55e" : status === "error" ? theme.palette.error.main : textColor;

  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        borderRadius: "20px",
        border: `1px solid ${textColor}44`,
        bgcolor: bgColor ?? "background.paper",
        color: textColor,
        px: 1,
        py: 0.25,
        fontSize: 11,
        fontWeight: 500,
      }}
      title={toolCall.resultMessage ?? humanize(toolCall.name)}
    >
      <Icon size={11} />
      <Box component="span" sx={{ fontFamily: "monospace", textTransform: "lowercase" }}>
        {humanize(toolCall.name)}
      </Box>
      <Box component="span" sx={{ color: statusColor }}>
        <StatusIcon
          size={11}
          style={{ animation: status === "pending" ? "spin 0.6s linear infinite" : undefined }}
        />
      </Box>
    </Box>
  );
}
