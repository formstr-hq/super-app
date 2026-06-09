import { Box, Button, Dialog, DialogContent, TextField, Typography } from "@mui/material";
import { useState } from "react";

import { useAuthStore } from "../stores";

interface UnlockDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Re-authenticate the locked active account. ncryptsec needs a passphrase;
 *  extension/nip46 just reconnect. */
export function UnlockDialog({ open, onClose }: UnlockDialogProps) {
  const { pubkey, method, unlock } = useAuthStore();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = pubkey ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : "";

  const run = async () => {
    if (!pubkey) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pubkey, passphrase);
      setPassphrase("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wrong passphrase");
    } finally {
      setBusy(false);
    }
  };

  const needsPassphrase = method === "local";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: "100%", maxWidth: 360, borderRadius: 2 } }}
    >
      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body1" fontWeight={600}>
          Unlock account
        </Typography>
        <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
          {short}
        </Typography>
        {error && (
          <Box
            sx={{
              bgcolor: "error.main",
              color: "error.contrastText",
              borderRadius: 1,
              px: 2,
              py: 1,
              fontSize: 13,
            }}
          >
            {error}
          </Box>
        )}
        {needsPassphrase && (
          <TextField
            size="small"
            fullWidth
            type="password"
            label="Passphrase"
            value={passphrase}
            autoFocus
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
        )}
        <Button
          variant="contained"
          size="small"
          disabled={busy || (needsPassphrase && !passphrase)}
          onClick={() => void run()}
        >
          {busy ? "Unlocking…" : needsPassphrase ? "Unlock" : "Reconnect signer"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
