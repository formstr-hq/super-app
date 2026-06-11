import type { FormSummary } from "@formstr/agent/services/forms/types";
import { Box, Card, Divider, Tooltip, Typography } from "@mui/material";
import { Lock } from "lucide-react";

import { FormActions } from "./FormActions";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onEdit?: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
}

export function FormCard({ form, onFill, onEdit, onViewResponses, onDelete, onCopyLink }: Props) {
  const meta: string[] = [];
  if (form.responseCount !== undefined) {
    meta.push(`${form.responseCount} ${form.responseCount === 1 ? "response" : "responses"}`);
  }
  if (form.createdAt > 0) {
    meta.push(
      new Date(form.createdAt * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  }

  return (
    <Card
      variant="outlined"
      sx={{
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        transition: "border-color 0.15s ease",
        "&:hover": { borderColor: "text.disabled" },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Typography
          variant="subtitle2"
          sx={{ flex: 1, fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.01em" }}
        >
          {form.name}
        </Typography>
        {form.isEncrypted && (
          <Tooltip title="Encrypted">
            <Box
              component="span"
              aria-label="Encrypted"
              sx={{ color: "text.disabled", display: "flex", flexShrink: 0, mt: "2px" }}
            >
              <Lock size={13} />
            </Box>
          </Tooltip>
        )}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ minHeight: 18 }}>
        {meta.join(" · ") || "—"}
      </Typography>

      <Divider sx={{ mt: 0.25 }} />

      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <FormActions
          form={form}
          onFill={onFill}
          onEdit={onEdit}
          onViewResponses={onViewResponses}
          onDelete={onDelete}
          onCopyLink={onCopyLink}
        />
      </Box>
    </Card>
  );
}
