import { Box, Card, CardContent, Chip, Typography } from "@mui/material";
import { Lock } from "lucide-react";
import { useState } from "react";

import type { FormSummary } from "../../services/forms/types";

import { FormActions } from "./FormActions";

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
            <FormActions
              form={form}
              onFill={onFill}
              onViewResponses={onViewResponses}
              onDelete={onDelete}
              onCopyLink={onCopyLink}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
