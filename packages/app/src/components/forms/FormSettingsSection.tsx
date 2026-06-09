import type { FormSettings } from "@formstr/agent/services/forms/types";
import {
  Box,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { npubToHex, formatNpub } from "../../lib/npub";

interface Props {
  settings: FormSettings;
  onChange: (patch: Partial<FormSettings>) => void;
}

export function FormSettingsSection({ settings, onChange }: Props) {
  const [npubInput, setNpubInput] = useState("");
  const [npubError, setNpubError] = useState<string | null>(null);

  const addResponder = () => {
    const hex = npubToHex(npubInput);
    if (!hex) {
      setNpubError("Enter a valid npub or hex pubkey");
      return;
    }
    const existing = settings.allowedResponders ?? [];
    if (!existing.includes(hex)) onChange({ allowedResponders: [...existing, hex] });
    setNpubInput("");
    setNpubError(null);
  };

  const removeResponder = (hex: string) =>
    onChange({ allowedResponders: (settings.allowedResponders ?? []).filter((h) => h !== hex) });

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Typography variant="body2" fontWeight={500}>
          Settings
        </Typography>
        <Divider sx={{ flex: 1 }} />
      </Box>

      <TextField
        label="Thank-you message (optional)"
        placeholder="Thanks for your response!"
        value={settings.thankYouText ?? ""}
        onChange={(e) => onChange({ thankYouText: e.target.value })}
        size="small"
        fullWidth
        multiline
        rows={2}
        sx={{ mb: 1.5 }}
      />

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={settings.disallowAnonymous ?? false}
            onChange={(e) => onChange({ disallowAnonymous: e.target.checked })}
          />
        }
        label={<Typography variant="body2">Require login to respond</Typography>}
      />

      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Allowed responders (optional — leave empty for anyone)
        </Typography>
        <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="npub1… or hex pubkey"
            value={npubInput}
            error={!!npubError}
            helperText={npubError ?? undefined}
            onChange={(e) => setNpubInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addResponder();
              }
            }}
          />
          <IconButton size="small" onClick={addResponder} aria-label="Add responder">
            <Plus size={16} />
          </IconButton>
        </Box>
        {(settings.allowedResponders ?? []).length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
            {(settings.allowedResponders ?? []).map((hex) => (
              <Chip
                key={hex}
                size="small"
                label={formatNpub(hex)}
                onDelete={() => removeResponder(hex)}
                deleteIcon={<X size={12} />}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
