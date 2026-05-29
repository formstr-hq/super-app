import { SignerUnavailableError } from "@formstr/core";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Eye, EyeOff, Key, Puzzle, Radio, UserRound } from "lucide-react";
import { useState } from "react";

import { useAuthStore } from "../stores";

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { loginWithNsec, loginWithNip07, loginAsGuest } = useAuthStore();
  const [nsecExpanded, setNsecExpanded] = useState(false);
  const [nsec, setNsec] = useState("");
  const [showNsec, setShowNsec] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const theme = useTheme();

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setLoading(key);
    setError(null);
    try {
      await fn();
      setNsec("");
      onClose();
    } catch (e) {
      if (e instanceof SignerUnavailableError && e.code === "no-signer") {
        setError("Browser extension not detected — install Alby, nos2x, or use a private key.");
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: "100%", maxWidth: 380, borderRadius: 2, overflow: "hidden" } }}
    >
      {/* Header */}
      <Box
        sx={{
          bgcolor: "background.paper",
          borderBottom: `1px solid ${theme.palette.divider}`,
          px: 3,
          py: 2.5,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              bgcolor: "text.primary",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Radio size={16} style={{ color: theme.palette.background.default }} />
          </Box>
          <Typography variant="body1" fontWeight={600}>
            Welcome to Formstr
          </Typography>
        </Box>
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", ml: "44px", display: "block" }}
        >
          A decentralised workspace powered by Nostr
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
              opacity: 0.9,
            }}
          >
            {error}
          </Box>
        )}

        {/* NIP-07 Extension — primary */}
        <Box
          onClick={() => wrap("nip07", loginWithNip07)}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            border: `2px solid ${theme.palette.text.primary}`,
            borderRadius: 1.5,
            px: 2,
            py: 1.5,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            bgcolor: "background.paper",
            transition: "background 150ms",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Puzzle size={20} style={{ color: theme.palette.text.primary, flexShrink: 0 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={500}>
              {loading === "nip07" ? "Connecting…" : "Browser Extension"}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              NIP-07 (Alby, nos2x, …)
            </Typography>
          </Box>
          {loading === "nip07" && (
            <Box
              sx={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "2px solid",
                borderColor: "text.primary",
                borderTopColor: "transparent",
                animation: "spin 0.6s linear infinite",
                "@keyframes spin": { to: { transform: "rotate(360deg)" } },
              }}
            />
          )}
        </Box>

        <Divider />

        {/* nsec — expandable */}
        <Box>
          <Box
            onClick={() => setNsecExpanded((v) => !v)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: nsecExpanded ? "6px 6px 0 0" : 1.5,
              px: 2,
              py: 1.5,
              cursor: "pointer",
              bgcolor: "background.default",
              transition: "background 150ms",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Key size={20} style={{ color: theme.palette.text.secondary, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={500}>
                Private Key
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                nsec… or hex key
              </Typography>
            </Box>
          </Box>

          {nsecExpanded && (
            <Box
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderTop: 0,
                borderRadius: "0 0 6px 6px",
                px: 2,
                pb: 2,
                pt: 1.5,
                bgcolor: "background.paper",
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
              }}
            >
              <TextField
                size="small"
                fullWidth
                type={showNsec ? "text" : "password"}
                placeholder="nsec1…"
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
                autoComplete="off"
                inputProps={{ style: { fontFamily: "monospace", fontSize: 13 } }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        edge="end"
                        onClick={() => setShowNsec((v) => !v)}
                        aria-label={showNsec ? "Hide key" : "Show key"}
                      >
                        {showNsec ? <EyeOff size={14} /> : <Eye size={14} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                variant="contained"
                size="small"
                fullWidth
                disabled={!nsec.trim() || !!loading}
                onClick={() => wrap("nsec", () => loginWithNsec(nsec))}
              >
                {loading === "nsec" ? "Signing in…" : "Sign in"}
              </Button>
            </Box>
          )}
        </Box>

        {/* Guest */}
        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={<UserRound size={16} />}
          onClick={() => wrap("guest", loginAsGuest)}
          disabled={!!loading}
          sx={{ borderStyle: "dashed", borderColor: "divider", color: "text.secondary" }}
        >
          {loading === "guest" ? "Creating account…" : "Continue as Guest"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
