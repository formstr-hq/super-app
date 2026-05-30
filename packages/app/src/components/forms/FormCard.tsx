import { Box, Card, CardContent, Chip, IconButton, Tooltip, Typography } from "@mui/material";
import { BarChart3, Link, Pencil, Trash2, Lock } from "lucide-react";
import { useState } from "react";

import type { FormSummary } from "../../services/forms/types";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
}

export function FormCard({ form, onFill, onViewResponses, onDelete, onCopyLink }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <Card
      variant="outlined"
      sx={{ cursor: "pointer", position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onFill(form)}
    >
      <CardContent sx={{ pb: "12px !important" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>
            {form.name}
          </Typography>
          {form.isEncrypted && (
            <Chip
              icon={<Lock size={11} />}
              label="Encrypted"
              size="small"
              variant="outlined"
              sx={{ fontSize: 11 }}
            />
          )}
        </Box>

        {hovered && (
          <Box sx={{ display: "flex", gap: 0.5, mt: 1 }} onClick={(e) => e.stopPropagation()}>
            <Tooltip title="Fill form">
              <IconButton size="small" onClick={() => onFill(form)}>
                <Pencil size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip title="View responses">
              <IconButton size="small" onClick={() => onViewResponses(form)}>
                <BarChart3 size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy link">
              <IconButton size="small" onClick={() => onCopyLink(form)}>
                <Link size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={() => onDelete(form)}>
                <Trash2 size={14} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
