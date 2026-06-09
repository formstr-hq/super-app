import { Box, Button, Dialog, DialogContent, Divider, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Key, Puzzle, Radio, ScanLine, UserPlus } from "lucide-react";
import QRCode from "qrcode";
import { useState } from "react";

import { useAuthStore } from "../stores";

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = null | "create" | "import" | "bunker" | "qr";

const NOSTRCONNECT_RELAY = "wss://relay.nsec.app";

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const {
    loginWithExtension,
    createAccount,
    importKey,
    loginWithBunkerUri,
    loginWithNostrConnect,
  } = useAuthStore();
  const theme = useTheme();

  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passphrase, setPassphrase] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [bunkerUri, setBunkerUri] = useState("");
  const [createdNcryptsec, setCreatedNcryptsec] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const reset = () => {
    setMode(null);
    setBusy(false);
    setError(null);
    setPassphrase("");
    setKeyInput("");
    setBunkerUri("");
    setCreatedNcryptsec(null);
    setQrDataUrl(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      PaperProps={{ sx: { width: "100%", maxWidth: 400, borderRadius: 2, overflow: "hidden" } }}
    >
      <Box
        sx={{
          bgcolor: "background.paper",
          borderBottom: `1px solid ${theme.palette.divider}`,
          px: 3,
          py: 2.5,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            bgcolor: "text.primary",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Radio size={16} style={{ color: theme.palette.background.default }} />
        </Box>
        <Typography variant="body1" fontWeight={600}>
          Sign in to Formstr
        </Typography>
      </Box>

      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
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

        {createdNcryptsec ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography variant="body2" fontWeight={600}>
              Save your encrypted key
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              This <strong>ncryptsec</strong> + your passphrase are the only way back into this
              account on another device. Store it somewhere safe.
            </Typography>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={createdNcryptsec}
              InputProps={{ readOnly: true, sx: { fontFamily: "monospace", fontSize: 12 } }}
            />
            <Button variant="contained" size="small" onClick={close}>
              Done
            </Button>
          </Box>
        ) : mode === null ? (
          <>
            <RowButton
              icon={<Puzzle size={20} />}
              title={busy ? "Connecting…" : "Browser Extension"}
              subtitle="NIP-07 (Alby, nos2x, …)"
              primary
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await loginWithExtension();
                  close();
                })
              }
            />
            <Divider />
            <RowButton
              icon={<UserPlus size={20} />}
              title="Create new account"
              subtitle="Encrypted with a passphrase (NIP-49)"
              disabled={busy}
              onClick={() => {
                setMode("create");
                setError(null);
              }}
            />
            <RowButton
              icon={<Key size={20} />}
              title="Import private key"
              subtitle="nsec / hex / ncryptsec + passphrase"
              disabled={busy}
              onClick={() => {
                setMode("import");
                setError(null);
              }}
            />
            <RowButton
              icon={<Radio size={20} />}
              title="Remote signer (bunker)"
              subtitle="NIP-46 bunker:// URI"
              disabled={busy}
              onClick={() => {
                setMode("bunker");
                setError(null);
              }}
            />
            <RowButton
              icon={<ScanLine size={20} />}
              title="Remote signer (QR)"
              subtitle="nostrconnect:// pairing"
              disabled={busy}
              onClick={() => {
                setMode("qr");
                setError(null);
              }}
            />
          </>
        ) : mode === "create" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              type="password"
              label="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
            />
            <Button
              variant="contained"
              size="small"
              disabled={!passphrase || busy}
              onClick={() =>
                run(async () => {
                  const { ncryptsec } = await createAccount(passphrase);
                  setCreatedNcryptsec(ncryptsec);
                })
              }
            >
              {busy ? "Creating…" : "Create account"}
            </Button>
            <BackLink onClick={reset} />
          </Box>
        ) : mode === "import" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              label="nsec / hex / ncryptsec"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              inputProps={{ style: { fontFamily: "monospace", fontSize: 12 } }}
              autoFocus
            />
            <TextField
              size="small"
              fullWidth
              type="password"
              label="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              helperText="Encrypts the key at rest (and decrypts an ncryptsec)."
            />
            <Button
              variant="contained"
              size="small"
              disabled={!keyInput.trim() || !passphrase || busy}
              onClick={() =>
                run(async () => {
                  await importKey(keyInput, passphrase);
                  close();
                })
              }
            >
              {busy ? "Importing…" : "Import"}
            </Button>
            <BackLink onClick={reset} />
          </Box>
        ) : mode === "bunker" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              label="bunker:// URI"
              value={bunkerUri}
              onChange={(e) => setBunkerUri(e.target.value)}
              inputProps={{ style: { fontFamily: "monospace", fontSize: 12 } }}
              autoFocus
            />
            <Button
              variant="contained"
              size="small"
              disabled={!bunkerUri.trim() || busy}
              onClick={() =>
                run(async () => {
                  await loginWithBunkerUri(bunkerUri);
                  close();
                })
              }
            >
              {busy ? "Connecting…" : "Connect"}
            </Button>
            <BackLink onClick={reset} />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "center" }}>
            {qrDataUrl ? (
              <>
                <Box
                  component="img"
                  src={qrDataUrl}
                  alt="nostrconnect QR"
                  sx={{ width: 220, height: 220 }}
                />
                <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
                  Scan with your remote signer (Amber, …). Waiting for pairing…
                </Typography>
              </>
            ) : (
              <Button
                variant="contained"
                size="small"
                fullWidth
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await loginWithNostrConnect({
                      relays: [NOSTRCONNECT_RELAY],
                      onUri: async (uri) => setQrDataUrl(await QRCode.toDataURL(uri)),
                    });
                    close();
                  })
                }
              >
                {busy ? "Generating…" : "Generate pairing QR"}
              </Button>
            )}
            <BackLink onClick={reset} />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RowButton(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <Box
      onClick={props.disabled ? undefined : props.onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        border: `${props.primary ? 2 : 1}px solid ${
          props.primary ? theme.palette.text.primary : theme.palette.divider
        }`,
        borderRadius: 1.5,
        px: 2,
        py: 1.5,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{ color: "text.primary", flexShrink: 0, display: "flex" }}>{props.icon}</Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2" fontWeight={500}>
          {props.title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.subtitle}
        </Typography>
      </Box>
    </Box>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Typography
      variant="caption"
      onClick={onClick}
      sx={{
        color: "text.secondary",
        cursor: "pointer",
        textAlign: "center",
        "&:hover": { color: "text.primary" },
      }}
    >
      ← Back
    </Typography>
  );
}
