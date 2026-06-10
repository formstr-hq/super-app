import type { FormSummary } from "@formstr/agent/services/forms/types";
import { Button, IconButton, ListItemIcon, Menu, MenuItem, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { BarChart3, Link, MoreHorizontal, Pencil, TextCursorInput, Trash2 } from "lucide-react";
import { useState } from "react";

interface Props {
  form: FormSummary;
  onFill: (form: FormSummary) => void;
  onEdit?: (form: FormSummary) => void;
  onViewResponses: (form: FormSummary) => void;
  onDelete: (form: FormSummary) => void;
  onCopyLink: (form: FormSummary) => void;
}

const btnSx = {
  fontSize: 12,
  px: 1,
  py: 0.25,
  minWidth: 0,
  color: "text.primary",
  borderColor: "divider",
} as const;

/** Labeled Fill / Responses / Share actions + a ⋯ overflow (Edit, Copy link, Delete). */
export function FormActions({
  form,
  onFill,
  onEdit,
  onViewResponses,
  onDelete,
  onCopyLink,
}: Props) {
  const theme = useTheme();
  const xs = useMediaQuery(theme.breakpoints.down("sm"));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const close = () => setAnchorEl(null);
  const run = (fn: (f: FormSummary) => void) => {
    fn(form);
    close();
  };

  return (
    <>
      {!xs && (
        <>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={btnSx}
            onClick={() => onFill(form)}
          >
            Fill
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={btnSx}
            onClick={() => onViewResponses(form)}
          >
            Responses
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            sx={btnSx}
            onClick={() => onCopyLink(form)}
          >
            Share
          </Button>
        </>
      )}
      <IconButton
        size="small"
        aria-label="More actions"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreHorizontal size={15} />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        {xs && (
          <MenuItem dense onClick={() => run(onFill)}>
            <ListItemIcon>
              <TextCursorInput size={14} />
            </ListItemIcon>
            Fill
          </MenuItem>
        )}
        {xs && (
          <MenuItem dense onClick={() => run(onViewResponses)}>
            <ListItemIcon>
              <BarChart3 size={14} />
            </ListItemIcon>
            Responses
          </MenuItem>
        )}
        {xs && (
          <MenuItem dense onClick={() => run(onCopyLink)}>
            <ListItemIcon>
              <Link size={14} />
            </ListItemIcon>
            Copy link
          </MenuItem>
        )}
        {onEdit && (
          <MenuItem dense onClick={() => run(onEdit)}>
            <ListItemIcon>
              <Pencil size={14} />
            </ListItemIcon>
            Edit
          </MenuItem>
        )}
        {!xs && (
          <MenuItem dense onClick={() => run(onCopyLink)}>
            <ListItemIcon>
              <Link size={14} />
            </ListItemIcon>
            Copy link
          </MenuItem>
        )}
        <MenuItem dense onClick={() => run(onDelete)} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "error.main" }}>
            <Trash2 size={14} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}
