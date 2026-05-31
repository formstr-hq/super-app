import { IconButton, Tooltip } from "@mui/material";
import { BarChart3, Link, Pencil, Trash2 } from "lucide-react";

import type { FormSummary } from "../../services/forms/types";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
  iconSize?: number;
}

/** Row of fill / responses / copy-link / delete actions, shared by FormCard and the list row. */
export function FormActions({
  form,
  onFill,
  onViewResponses,
  onDelete,
  onCopyLink,
  iconSize = 14,
}: Props) {
  return (
    <>
      <Tooltip title="Fill form">
        <IconButton size="small" onClick={() => onFill(form)}>
          <Pencil size={iconSize} />
        </IconButton>
      </Tooltip>
      <Tooltip title="View responses">
        <IconButton size="small" onClick={() => onViewResponses(form)}>
          <BarChart3 size={iconSize} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Copy link">
        <IconButton size="small" onClick={() => onCopyLink(form)}>
          <Link size={iconSize} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Delete">
        <IconButton size="small" color="error" onClick={() => onDelete(form)}>
          <Trash2 size={iconSize} />
        </IconButton>
      </Tooltip>
    </>
  );
}
