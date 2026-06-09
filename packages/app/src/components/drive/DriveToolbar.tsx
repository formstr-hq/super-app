import type { BlossomServerInfo } from "@formstr/agent/services/drive";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  ListSubheader,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ChevronRight, CloudUpload, HardDrive, Plus, Server } from "lucide-react";
import { useState } from "react";

interface DriveToolbarProps {
  currentFolder: string;
  servers: BlossomServerInfo[];
  selectedServer: string;
  isUploading: boolean;
  onNavigate: (folder: string) => void;
  onSelectServer: (url: string) => void;
  onAddCustomServer: (url: string) => void;
  onUploadClick: () => void;
}

const ADD_CUSTOM = "__add_custom__";

function sourceLabel(source: BlossomServerInfo["source"]): string {
  if (source === "relay") return " (from relay)";
  if (source === "custom") return " (custom)";
  return "";
}

export function DriveToolbar({
  currentFolder,
  servers,
  selectedServer,
  isUploading,
  onNavigate,
  onSelectServer,
  onAddCustomServer,
  onUploadClick,
}: DriveToolbarProps) {
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

  const crumbs = currentFolder
    .split("/")
    .filter(Boolean)
    .reduce<{ label: string; path: string }[]>((acc, segment) => {
      const path = acc.length === 0 ? `/${segment}` : `${acc[acc.length - 1].path}/${segment}`;
      return [...acc, { label: segment, path }];
    }, []);

  const addCustom = () => {
    const url = customUrl.trim();
    if (!url) return;
    onAddCustomServer(url);
    setCustomUrl("");
    setAdding(false);
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        py: 1.25,
        borderBottom: `1px solid ${theme.palette.divider}`,
        flexWrap: "wrap",
      }}
    >
      {/* Breadcrumb */}
      <Box
        component="nav"
        aria-label="Folder path"
        sx={{ display: "flex", alignItems: "center", gap: 0.25, minWidth: 0 }}
      >
        <Box component="button" onClick={() => onNavigate("/")} sx={crumbSx(currentFolder === "/")}>
          <HardDrive size={13} />
          My Drive
        </Box>
        {crumbs.map((crumb, i) => (
          <Box key={crumb.path} sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
            <ChevronRight size={13} color={theme.palette.text.disabled} />
            <Box
              component="button"
              onClick={() => onNavigate(crumb.path)}
              sx={crumbSx(i === crumbs.length - 1)}
            >
              {crumb.label}
            </Box>
          </Box>
        ))}
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Server selector */}
      {adding ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <TextField
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCustom();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="https://your-blossom-server.com"
            size="small"
            autoFocus
            sx={{ width: 240, "& .MuiInputBase-input": { fontSize: 12, py: 0.6 } }}
          />
          <Button size="small" onClick={addCustom}>
            Add
          </Button>
        </Box>
      ) : (
        <Tooltip title="Blossom server (where blobs are stored)">
          <Select
            value={selectedServer}
            onChange={(e) => {
              if (e.target.value === ADD_CUSTOM) {
                setAdding(true);
                return;
              }
              onSelectServer(e.target.value);
            }}
            size="small"
            startAdornment={<Server size={14} style={{ marginRight: 6, opacity: 0.6 }} />}
            sx={{ maxWidth: 280, "& .MuiSelect-select": { fontSize: 12, py: 0.7 } }}
          >
            <ListSubheader sx={{ fontSize: 11, lineHeight: 2 }}>Blossom server</ListSubheader>
            {servers.map((s) => (
              <MenuItem key={s.url} value={s.url} sx={{ fontSize: 12 }}>
                {s.url.replace(/^https?:\/\//, "")}
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ ml: 0.5, color: "text.secondary" }}
                >
                  {sourceLabel(s.source)}
                </Typography>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem value={ADD_CUSTOM} sx={{ fontSize: 12, gap: 0.75 }}>
              <Plus size={13} /> Add custom server…
            </MenuItem>
          </Select>
        </Tooltip>
      )}

      <Button
        variant="contained"
        size="small"
        startIcon={
          isUploading ? <CircularProgress size={14} color="inherit" /> : <CloudUpload size={16} />
        }
        onClick={onUploadClick}
        disabled={isUploading}
      >
        {isUploading ? "Uploading…" : "Upload"}
      </Button>
    </Box>
  );
}

function crumbSx(active: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 0.5,
    fontSize: 12,
    fontWeight: 600,
    px: 0.85,
    py: 0.375,
    borderRadius: 1,
    border: "none",
    cursor: "pointer",
    bgcolor: active ? "action.selected" : "transparent",
    color: active ? "text.primary" : "text.secondary",
    "&:hover": { bgcolor: "action.hover", color: "text.primary" },
  } as const;
}
