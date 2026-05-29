import { resolveRef } from "@formstr/core";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Calendar, ClipboardList, FileText, FolderOpen, Vote } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { EntityRef } from "../../ai/types";

const MODULE_ICONS: Record<string, typeof FileText> = {
  forms: ClipboardList,
  calendar: Calendar,
  pages: FileText,
  drive: FolderOpen,
  polls: Vote,
};

const MODULE_TEXT: Record<string, { light: string; dark: string }> = {
  forms: { light: "#1d4ed8", dark: "#93c5fd" },
  calendar: { light: "#c2410c", dark: "#fdba74" },
  pages: { light: "#15803d", dark: "#86efac" },
  drive: { light: "#7e22ce", dark: "#d8b4fe" },
  polls: { light: "#be185d", dark: "#f9a8d4" },
};

export function EntityCard({ entity }: { entity: EntityRef }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const mode = theme.palette.mode;
  const Icon = MODULE_ICONS[entity.module] ?? FileText;
  const textColor = MODULE_TEXT[entity.module]?.[mode] ?? theme.palette.text.secondary;
  const route = entity.route ?? (entity.ref ? resolveRef(entity.ref) : null);

  return (
    <Box
      component="button"
      onClick={() => {
        if (route) navigate(route);
      }}
      disabled={!route}
      title={`${entity.module}: ${entity.label}`}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        flexShrink: 0,
        border: `1px solid ${textColor}44`,
        borderRadius: 1,
        px: 1,
        py: 0.5,
        fontSize: 12,
        color: textColor,
        bgcolor: `${textColor}11`,
        cursor: route ? "pointer" : "default",
        transition: "filter 150ms",
        "&:hover": route ? { filter: "brightness(1.1)" } : {},
        "&:disabled": { opacity: 0.8 },
        background: "none",
        fontFamily: "inherit",
      }}
    >
      <Icon size={12} />
      <Typography
        component="span"
        variant="caption"
        noWrap
        sx={{ maxWidth: 120, color: "inherit", fontSize: 12 }}
      >
        {entity.label}
      </Typography>
    </Box>
  );
}
