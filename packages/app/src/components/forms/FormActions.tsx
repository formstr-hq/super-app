import type { FormSummary } from "@formstr/agent/services/forms/types";
import { IconButton, Tooltip } from "@mui/material";
import { BarChart3, Link, Pencil, TextCursorInput, Trash2 } from "lucide-react";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onEdit?: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
  iconSize?: number;
}

/** Row of fill / edit / responses / copy-link / delete actions, shared by FormCard and the list row. */
export function FormActions({
  form,
  onFill,
  onEdit,
  onViewResponses,
  onDelete,
  onCopyLink,
  iconSize = 14,
}: Props) {
  return (
    <>
      <Tooltip title="Fill form">
        <IconButton size="small" onClick={() => onFill(form)}>
          <TextCursorInput size={iconSize} />
        </IconButton>
      </Tooltip>
      {onEdit && (
        <Tooltip title="Edit form">
          <IconButton size="small" onClick={() => onEdit(form)}>
            <Pencil size={iconSize} />
          </IconButton>
        </Tooltip>
      )}
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
