import { Box, Divider, ListSubheader, Menu, MenuItem, Typography } from "@mui/material";
import { Check, ChevronDown, Settings2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  AI_PROVIDERS,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_LABELS,
  isProviderConfigured,
} from "../../lib/aiProviders";
import { useAIStore, useSettingsStore } from "../../stores";

export function ProviderModelPill() {
  const { aiProvider, aiModels, apiKeys, compatBaseUrl, setActiveProvider } = useSettingsStore();
  const { availableModels, setModel, initProvider } = useAIStore();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const activeModel = aiModels[aiProvider] || PROVIDER_DEFAULT_MODEL[aiProvider];
  const configured = AI_PROVIDERS.filter((p) =>
    isProviderConfigured({ apiKeys, compatBaseUrl }, p),
  );
  const models = availableModels.length > 0 ? availableModels : [activeModel];

  const close = () => setAnchorEl(null);

  return (
    <>
      <Box
        component="button"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          maxWidth: 150,
          px: 0.75,
          py: 0.25,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "text.secondary",
          fontSize: 11,
          borderRadius: 1,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Box
          component="span"
          sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {PROVIDER_LABELS[aiProvider]} · {activeModel.replace(/:latest$/, "")}
        </Box>
        <ChevronDown size={12} style={{ flexShrink: 0 }} />
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        PaperProps={{ sx: { minWidth: 220, maxHeight: 420 } }}
      >
        <ListSubheader sx={{ fontSize: 11, lineHeight: "28px", bgcolor: "transparent" }}>
          Provider
        </ListSubheader>
        {configured.map((p) => (
          <MenuItem
            key={p}
            dense
            selected={p === aiProvider}
            onClick={() => {
              if (p !== aiProvider) {
                setActiveProvider(p);
                void initProvider();
              }
              close();
            }}
            sx={{ fontSize: 13, gap: 1 }}
          >
            <Box sx={{ width: 14, display: "flex" }}>{p === aiProvider && <Check size={14} />}</Box>
            {PROVIDER_LABELS[p]}
          </MenuItem>
        ))}

        <Divider />
        <ListSubheader sx={{ fontSize: 11, lineHeight: "28px", bgcolor: "transparent" }}>
          Model
        </ListSubheader>
        {models.map((m) => (
          <MenuItem
            key={m}
            dense
            selected={m === activeModel}
            onClick={() => {
              setModel(m);
              close();
            }}
            sx={{ fontSize: 13, gap: 1 }}
          >
            <Box sx={{ width: 14, display: "flex" }}>
              {m === activeModel && <Check size={14} />}
            </Box>
            <Typography
              variant="inherit"
              sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {m.replace(/:latest$/, "")}
            </Typography>
          </MenuItem>
        ))}

        <Divider />
        <MenuItem
          dense
          onClick={() => {
            navigate("/settings");
            close();
          }}
          sx={{ fontSize: 13, gap: 1, color: "text.secondary" }}
        >
          <Settings2 size={14} />
          Manage keys in Settings
        </MenuItem>
      </Menu>
    </>
  );
}
