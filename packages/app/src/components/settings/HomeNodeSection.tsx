import { Box, FormControlLabel, IconButton, Switch, TextField, Typography } from "@mui/material";
import { Check, Copy, Server } from "lucide-react";
import { useState } from "react";

import { getTransportNpub } from "../../ai/acp/transportIdentity";
import { copyText } from "../../lib/clipboard";
import { useSettingsStore } from "../../stores/settingsStore";

/**
 * Configure a home node: an always-on machine running `@formstr/home-node` that
 * pipes the assistant to a local ACP harness (e.g. opencode) over Nostr. When
 * enabled, the AI panel routes prompts there instead of to a local LLM provider.
 */
export function HomeNodeSection() {
  const { homeNodeEnabled, homeNodeNpub, homeNodeCwd, homeNodeRelays, setHomeNode } =
    useSettingsStore();
  const npubLooksValid = homeNodeNpub.startsWith("npub1") && homeNodeNpub.length > 20;
  const transportNpub = getTransportNpub();
  const [copied, setCopied] = useState(false);
  // Raw text so commas/spaces survive typing; parsed to an array on change.
  const [relaysText, setRelaysText] = useState(homeNodeRelays.join(", "));

  const copyDeviceNpub = () => {
    void copyText(transportNpub).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Server size={16} />
        <Typography variant="subtitle2" fontWeight={600}>
          Home node (remote harness)
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1.5 }}>
        Route the assistant to your own machine over Nostr (ACP). Your home node must whitelist this
        device&apos;s npub.
      </Typography>

      <FormControlLabel
        control={
          <Switch
            checked={homeNodeEnabled}
            onChange={(e) => setHomeNode({ enabled: e.target.checked })}
          />
        }
        label="Use my home node for the AI assistant"
      />

      <Box
        sx={{
          mt: 1,
          p: 1.25,
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          This device&apos;s transport npub —{" "}
          <strong>add it to your home node&apos;s allow list</strong> (not your login npub):
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
          <Typography
            variant="caption"
            sx={{ fontFamily: "monospace", wordBreak: "break-all", flex: 1 }}
          >
            {transportNpub}
          </Typography>
          <IconButton size="small" onClick={copyDeviceNpub} title="Copy">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </Box>
      </Box>

      <TextField
        fullWidth
        size="small"
        label="Home node npub"
        placeholder="npub1…"
        value={homeNodeNpub}
        onChange={(e) => setHomeNode({ npub: e.target.value.trim() })}
        error={homeNodeNpub.length > 0 && !npubLooksValid}
        helperText={
          homeNodeNpub.length > 0 && !npubLooksValid
            ? "Doesn't look like an npub"
            : "Printed by the home node on startup"
        }
        sx={{ mt: 1.5 }}
      />

      <TextField
        fullWidth
        size="small"
        label="Project directory (on the home node)"
        placeholder="."
        value={homeNodeCwd}
        onChange={(e) => setHomeNode({ cwd: e.target.value })}
        helperText={'Working directory the harness opens. "." uses the home node’s launch dir.'}
        sx={{ mt: 1.5 }}
      />

      <TextField
        fullWidth
        size="small"
        label="Home node relays (comma or newline separated)"
        placeholder="wss://relay.example.com, wss://another.relay"
        multiline
        minRows={1}
        value={relaysText}
        onChange={(e) => {
          setRelaysText(e.target.value);
          setHomeNode({
            relays: e.target.value
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          });
        }}
        helperText={
          (homeNodeRelays.length
            ? `${homeNodeRelays.length} relay(s) set. `
            : "Leave blank for app defaults. ") + "Must overlap a relay your home node uses."
        }
        sx={{ mt: 1.5 }}
      />
    </Box>
  );
}
