import { Box, Button, Grid2 as MuiGrid, Paper, Skeleton, Tooltip, Typography } from "@mui/material";
import { Lock, Plus } from "lucide-react";

import type { FormSummary } from "../../services/forms/types";
import type { FormsView } from "../../stores/settingsStore";

import { FormActions } from "./FormActions";
import { FormCard } from "./FormCard";

interface Props {
  forms: FormSummary[];
  isLoading: boolean;
  view?: FormsView;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
  onCreateNew: () => void;
}

export function FormListView({
  forms,
  isLoading,
  view = "grid",
  onFill,
  onViewResponses,
  onDelete,
  onCopyLink,
  onCreateNew,
}: Props) {
  if (isLoading) {
    return (
      <MuiGrid container spacing={1.5}>
        {[1, 2, 3].map((i) => (
          <MuiGrid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Skeleton variant="rounded" height={80} />
          </MuiGrid>
        ))}
      </MuiGrid>
    );
  }

  if (forms.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No forms yet. Create your first form to get started.
        </Typography>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={onCreateNew}>
          New Form
        </Button>
      </Box>
    );
  }

  if (view === "list") {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
        {forms.map((form, i) => (
          <Box
            key={`${form.pubkey}:${form.id}`}
            onClick={() => onFill(form)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1.25,
              cursor: "pointer",
              borderTop: i === 0 ? "none" : "1px solid",
              borderColor: "divider",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Typography variant="body2" fontWeight={500} noWrap sx={{ flex: 1, minWidth: 0 }}>
              {form.name}
            </Typography>
            {form.isEncrypted && (
              <Tooltip title="Encrypted">
                <Box
                  component="span"
                  sx={{ color: "text.disabled", display: "flex", alignItems: "center" }}
                >
                  <Lock size={13} />
                </Box>
              </Tooltip>
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: "none", sm: "block" }, minWidth: 96, textAlign: "right" }}
            >
              {form.createdAt ? new Date(form.createdAt * 1000).toLocaleDateString() : "—"}
            </Typography>
            <Box sx={{ display: "flex", gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
              <FormActions
                form={form}
                onFill={onFill}
                onViewResponses={onViewResponses}
                onDelete={onDelete}
                onCopyLink={onCopyLink}
              />
            </Box>
          </Box>
        ))}
      </Paper>
    );
  }

  return (
    <MuiGrid container spacing={1.5}>
      {forms.map((form) => (
        <MuiGrid key={`${form.pubkey}:${form.id}`} size={{ xs: 12, sm: 6, lg: 4 }}>
          <FormCard
            form={form}
            onFill={onFill}
            onViewResponses={onViewResponses}
            onDelete={onDelete}
            onCopyLink={onCopyLink}
          />
        </MuiGrid>
      ))}
    </MuiGrid>
  );
}
