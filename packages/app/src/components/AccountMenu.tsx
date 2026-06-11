import { Avatar, Box, Divider, Menu, MenuItem, Typography } from "@mui/material";
import { Check, ChevronDown, Copy, Lock, LogOut, Plus, Settings } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { copyText } from "../lib/clipboard";
import { useAuthStore } from "../stores";

function npubOf(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

const shorten = (s: string) => `${s.slice(0, 10)}…${s.slice(-4)}`;

interface AccountMenuProps {
  /** "header": avatar + name + chevron. "sidebar": full-width row. */
  variant?: "header" | "sidebar";
}

/** Account chip + menu: kind-0 identity, copyable npub, account switching, logout. */
export function AccountMenu({ variant = "header" }: AccountMenuProps) {
  const { accounts, pubkey, profile, switchAccount, logout, openAuthModal } = useAuthStore();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  if (!pubkey) return null;
  const npub = npubOf(pubkey);
  const displayName = profile?.displayName ?? profile?.name ?? shorten(npub);
  const close = () => setAnchorEl(null);

  const handleCopy = () => {
    void copyText(npub).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const avatar = (
    <Avatar src={profile?.picture} sx={{ width: 26, height: 26, fontSize: 11 }}>
      {displayName.slice(0, 1).toUpperCase()}
    </Avatar>
  );

  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
        aria-label="Account menu"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          width: variant === "sidebar" ? "100%" : "auto",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
          color: "text.primary",
          borderRadius: 1,
          px: variant === "sidebar" ? 1 : 0.5,
          py: 0.5,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        {avatar}
        <Typography
          variant="body2"
          fontWeight={550}
          noWrap
          sx={{
            maxWidth: 140,
            display: variant === "header" ? { xs: "none", md: "block" } : "block",
          }}
        >
          {displayName}
        </Typography>
        <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        PaperProps={{ sx: { minWidth: 220, mt: 0.5 } }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        {/* Identity block */}
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {displayName}
          </Typography>
          <Box
            onClick={handleCopy}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: "pointer",
              color: "text.secondary",
              "&:hover": { color: "text.primary" },
            }}
          >
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              {shorten(npub)}
            </Typography>
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </Box>
        </Box>
        <Divider />

        {accounts.length > 1 && [
          ...accounts.map((acc) => (
            <MenuItem
              key={acc.pubkey}
              dense
              selected={acc.pubkey === pubkey}
              onClick={() => {
                if (acc.pubkey !== pubkey) void switchAccount(acc.pubkey);
                close();
              }}
              sx={{ gap: 1, fontSize: 12.5, fontFamily: "monospace" }}
            >
              {acc.locked && <Lock size={12} />}
              {shorten(acc.npub)}
            </MenuItem>
          )),
          <Divider key="acc-div" />,
        ]}

        <MenuItem
          dense
          onClick={() => {
            openAuthModal("login");
            close();
          }}
          sx={{ gap: 1.5, fontSize: 13 }}
        >
          <Plus size={14} />
          Add account
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            navigate("/settings");
            close();
          }}
          sx={{ gap: 1.5, fontSize: 13 }}
        >
          <Settings size={14} />
          Profile &amp; settings
        </MenuItem>
        <Divider />
        <MenuItem
          dense
          onClick={() => {
            void logout();
            close();
          }}
          sx={{ gap: 1.5, fontSize: 13, color: "error.main" }}
        >
          <LogOut size={14} />
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
