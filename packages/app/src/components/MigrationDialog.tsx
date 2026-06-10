import { Box, Button, Dialog, DialogContent, TextField, Typography } from "@mui/material";
import { useState } from "react";

import { useAuthStore } from "../stores";

/** One-time prompt for users upgrading from the old plaintext-key storage:
 *  encrypt the existing key with a passphrase (NIP-49). */
export function MigrationDialog() {
  const { legacyMigration, completeLegacyMigration, dismissLegacyMigration } = useAuthStore();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = legacyMigration !== null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeLegacyMigration(passphrase);
      setPassphrase("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} PaperProps={{ sx: { width: "100%", maxWidth: 380, borderRadius: 2 } }}>
      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body1" fontWeight={600}>
          Secure your key
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Formstr now stores keys encrypted. Set a passphrase to protect your existing key — you'll
          enter it after each reload. Your unprotected key will be removed.
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
        <TextField
          size="small"
          fullWidth
          type="password"
          label="New passphrase"
          value={passphrase}
          autoFocus
          onChange={(e) => setPassphrase(e.target.value)}
        />
        <Button
          variant="contained"
          size="small"
          disabled={busy || !passphrase}
          onClick={() => void run()}
        >
          {busy ? "Securing…" : "Secure key"}
        </Button>
        <Typography
          variant="caption"
          onClick={() => dismissLegacyMigration()}
          sx={{ color: "text.secondary", cursor: "pointer", textAlign: "center" }}
        >
          Discard this key and sign in differently
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
