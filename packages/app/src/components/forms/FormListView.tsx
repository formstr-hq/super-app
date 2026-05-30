import { Box, Button, Grid2 as MuiGrid, Skeleton, Typography } from "@mui/material";
import { Plus } from "lucide-react";

import type { FormSummary } from "../../services/forms/types";

import { FormCard } from "./FormCard";

interface Props {
  forms: FormSummary[];
  isLoading: boolean;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
  onCreateNew: () => void;
}

export function FormListView({
  forms,
  isLoading,
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
