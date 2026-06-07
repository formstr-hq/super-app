import type { ShareResult } from "@formstr/agent/services/pages";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Check, Copy, Lock } from "lucide-react";
import { useEffect, useState } from "react";

interface SharePageDialogProps {
  open: boolean;
  onClose: () => void;
  /** Mints keys + publishes; returns the share link. */
  onShare: (canEdit: boolean) => Promise<ShareResult | null>;
}

export function SharePageDialog({ open, onClose, onShare }: SharePageDialogProps) {
  const [canEdit, setCanEdit] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setResult(null);
      setCanEdit(false);
      setCopied(false);
    }
  }, [open]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await onShare(canEdit);
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Share page</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}>
        <RadioGroup
          value={canEdit ? "edit" : "view"}
          onChange={(e) => setCanEdit(e.target.value === "edit")}
        >
          <FormControlLabel
            value="view"
            control={<Radio size="small" />}
            label={
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  View only
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Recipients can read, not edit
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            value="edit"
            control={<Radio size="small" />}
            label={
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  Can edit
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Recipients get an edit key too
                </Typography>
              </Box>
            }
          />
        </RadioGroup>

        {result && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <TextField
              value={result.url}
              size="small"
              fullWidth
              InputProps={{ readOnly: true, sx: { fontFamily: "monospace", fontSize: 12 } }}
            />
            <Tooltip title={copied ? "Copied!" : "Copy"}>
              <IconButton size="small" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
          <Lock size={12} />
          <Typography variant="caption">
            Keys live in the link’s <code>#fragment</code> — never sent to relays.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={generate} disabled={busy}>
          {busy ? "Generating…" : result ? "Regenerate" : "Generate link"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
