import { Box, Chip, IconButton, Popover, TextField, Typography } from "@mui/material";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

interface PageTagsPopoverProps {
  anchorEl: HTMLElement | null;
  tags: string[];
  onClose: () => void;
  onChange: (tags: string[]) => void;
}

export function PageTagsPopover({ anchorEl, tags, onClose, onChange }: PageTagsPopoverProps) {
  const [draft, setDraft] = useState("");
  const [local, setLocal] = useState<string[]>(tags);

  useEffect(() => setLocal(tags), [tags, anchorEl]);

  const add = () => {
    const t = draft.trim().toLowerCase();
    if (!t || local.includes(t)) {
      setDraft("");
      return;
    }
    const next = [...local, t];
    setLocal(next);
    setDraft("");
    onChange(next);
  };

  const remove = (t: string) => {
    const next = local.filter((x) => x !== t);
    setLocal(next);
    onChange(next);
  };

  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{ paper: { sx: { p: 1.5, width: 260 } } }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Labels
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", my: 1 }}>
        {local.length === 0 && (
          <Typography variant="caption" color="text.disabled">
            No labels yet
          </Typography>
        )}
        {local.map((t) => (
          <Chip
            key={t}
            label={t}
            size="small"
            onDelete={() => remove(t)}
            deleteIcon={<X size={12} />}
            sx={{ height: 22, fontSize: 11 }}
          />
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          size="small"
          fullWidth
          placeholder="Add label…"
        />
        <IconButton size="small" onClick={add}>
          <Plus size={16} />
        </IconButton>
      </Box>
    </Popover>
  );
}
