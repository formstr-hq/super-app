import { Box, ButtonBase, Card, Divider, Tooltip, Typography } from "@mui/material";
import { BarChart3, Link, Lock, Pencil, Trash2 } from "lucide-react";
import type React from "react";

import type { FormSummary } from "../../services/forms/types";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
}

type ActionCell = {
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  key: string;
  danger?: boolean;
};

const ACTION_CELLS: ActionCell[] = [
  { label: "Fill Form", Icon: Pencil, key: "fill" },
  { label: "Responses", Icon: BarChart3, key: "responses" },
  { label: "Copy Link", Icon: Link, key: "copy" },
  { label: "Delete", Icon: Trash2, key: "delete", danger: true },
];

export function FormCard({ form, onFill, onViewResponses, onDelete, onCopyLink }: Props) {
  const handlers: Record<string, () => void> = {
    fill: () => onFill(form),
    responses: () => onViewResponses(form),
    copy: () => onCopyLink(form),
    delete: () => onDelete(form),
  };

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ px: 2, pt: 2, pb: 1.75, display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Typography
          variant="subtitle2"
          sx={{ flex: 1, fontWeight: 600, lineHeight: 1.5, letterSpacing: "-0.01em" }}
        >
          {form.name}
        </Typography>
        {form.isEncrypted && (
          <Tooltip title="Encrypted">
            <Box
              component="span"
              aria-label="Encrypted"
              sx={{
                color: "text.disabled",
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
                mt: "2px",
              }}
            >
              <Lock size={13} />
            </Box>
          </Tooltip>
        )}
      </Box>

      <Divider />

      <Box
        sx={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}
        onClick={(e) => e.stopPropagation()}
      >
        {ACTION_CELLS.map(({ label, Icon, key, danger }, i) => (
          <ButtonBase
            key={key}
            onClick={handlers[key]}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.75,
              py: 1.75,
              borderTop: i >= 2 ? "1px solid" : undefined,
              borderLeft: i % 2 === 1 ? "1px solid" : undefined,
              borderColor: "divider",
              color: danger ? "error.main" : "text.secondary",
              transition: "background-color 0.15s ease, color 0.15s ease",
              "&:hover": {
                bgcolor: danger ? "rgba(220, 38, 38, 0.07)" : "action.hover",
                color: danger ? "error.main" : "text.primary",
              },
            }}
          >
            <Icon size={15} />
            <Typography
              component="span"
              sx={{
                fontSize: 11.5,
                fontWeight: 500,
                letterSpacing: "0.01em",
                color: "inherit",
                lineHeight: 1,
              }}
            >
              {label}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </Card>
  );
}
