import { fetchProfile, type NostrProfile } from "@formstr/agent/services/profile";
import {
  Avatar,
  Box,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  Snackbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { BadgeCheck, Copy, RefreshCw, UserRound } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useState } from "react";

import { copyText } from "../../lib/clipboard";
import { useAuthStore } from "../../stores";

export function ProfileSection() {
  const pubkey = useAuthStore((s) => s.pubkey);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);

  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try {
      setProfile(await fetchProfile(pubkey));
    } finally {
      setLoading(false);
    }
  }, [pubkey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isLoggedIn || !pubkey) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          Profile
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Log in to see your Nostr profile here.
        </Typography>
      </Box>
    );
  }

  let npub = pubkey;
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    /* show raw hex if encoding fails */
  }

  const displayName = profile?.displayName || profile?.name;

  const handleCopyNpub = async () => {
    const ok = await copyText(npub);
    setFeedback(ok ? "npub copied" : "Copy failed");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 560 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
          Profile
        </Typography>
        <Tooltip title="Reload profile from relays">
          <span>
            <IconButton size="small" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
        <Avatar src={profile?.picture} sx={{ width: 64, height: 64 }}>
          <UserRound size={28} />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography variant="subtitle1" fontWeight={600} noWrap>
              {displayName || "Unnamed"}
            </Typography>
            {loading && <CircularProgress size={12} />}
          </Box>
          {profile?.nip05 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <BadgeCheck size={13} style={{ color: "var(--mui-palette-success-main)" }} />
              <Typography variant="caption" color="text.secondary" noWrap>
                {profile.nip05}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
          Public key
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            px: 1,
            py: 0.5,
          }}
        >
          <Typography
            variant="caption"
            sx={{ fontFamily: "monospace", flex: 1, minWidth: 0, wordBreak: "break-all" }}
          >
            {npub}
          </Typography>
          <Tooltip title="Copy npub">
            <IconButton size="small" onClick={() => void handleCopyNpub()} aria-label="Copy npub">
              <Copy size={13} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {profile?.about && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            About
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {profile.about}
          </Typography>
        </Box>
      )}

      {profile?.website && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            Website
          </Typography>
          <MuiLink href={profile.website} target="_blank" rel="noreferrer noopener" variant="body2">
            {profile.website}
          </MuiLink>
        </Box>
      )}

      {profile?.lud16 && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            Lightning address
          </Typography>
          <Typography variant="body2">{profile.lud16}</Typography>
        </Box>
      )}

      {!loading && !profile && (
        <Typography variant="body2" color="text.secondary">
          No profile metadata found on your relays yet. Profiles created in other Nostr apps will
          appear here automatically.
        </Typography>
      )}

      <Snackbar
        open={!!feedback}
        autoHideDuration={2000}
        onClose={() => setFeedback("")}
        message={feedback}
      />
    </Box>
  );
}
