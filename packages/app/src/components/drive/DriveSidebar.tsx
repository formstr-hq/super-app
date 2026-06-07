import { Box, Button, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Check, FolderClosed, FolderOpen, HardDrive, Plus, X } from "lucide-react";
import { useState } from "react";

import type { FileMetadata } from "../../services/drive";

interface DriveSidebarProps {
  folders: string[];
  currentFolder: string;
  files: FileMetadata[];
  onSelect: (folder: string) => void;
  onNewFolder: (path: string) => void;
}

function folderLabel(path: string): string {
  if (path === "/") return "My Drive";
  return path.split("/").filter(Boolean).pop() ?? path;
}

function depth(path: string): number {
  if (path === "/") return 0;
  return path.split("/").filter(Boolean).length;
}

export function DriveSidebar({
  folders,
  currentFolder,
  files,
  onSelect,
  onNewFolder,
}: DriveSidebarProps) {
  const theme = useTheme();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");

  const itemCount = (folder: string) => {
    const directFiles = files.filter((f) => f.folder === folder).length;
    const directFolders = folders.filter(
      (f) =>
        f !== folder &&
        f.startsWith(folder === "/" ? "/" : folder + "/") &&
        depth(f) === depth(folder) + 1,
    ).length;
    return directFiles + directFolders;
  };

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const path = currentFolder === "/" ? `/${trimmed}` : `${currentFolder}/${trimmed}`;
    onNewFolder(path);
    setName("");
    setShowNew(false);
  };

  return (
    <Box
      component="aside"
      sx={{
        width: 248,
        flexShrink: 0,
        height: "100%",
        borderRight: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.mode === "dark" ? "background.default" : "grey.50",
        px: 1.25,
        py: 1.75,
        display: { xs: "none", sm: "flex" },
        flexDirection: "column",
        gap: 0.25,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 0.5,
          mb: 0.5,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "text.secondary",
          }}
        >
          Folders
        </Typography>
        <Tooltip title="New folder">
          <IconButton size="small" onClick={() => setShowNew((v) => !v)}>
            <Plus size={15} />
          </IconButton>
        </Tooltip>
      </Box>

      {showNew && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 0.5, mb: 0.5 }}>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setShowNew(false);
                setName("");
              }
            }}
            placeholder="Folder name"
            size="small"
            autoFocus
            fullWidth
            sx={{ "& .MuiInputBase-input": { fontSize: 13, py: 0.5 } }}
          />
          <IconButton size="small" onClick={commit}>
            <Check size={15} />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => {
              setShowNew(false);
              setName("");
            }}
          >
            <X size={15} />
          </IconButton>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
        }}
      >
        {folders.map((folder) => {
          const selected = folder === currentFolder;
          const isRoot = folder === "/";
          const Icon = isRoot ? HardDrive : selected ? FolderOpen : FolderClosed;
          return (
            <Box
              key={folder}
              role="button"
              onClick={() => onSelect(folder)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                pr: 0.85,
                py: 0.7,
                pl: `${8 + depth(folder) * 14}px`,
                borderRadius: 1,
                cursor: "pointer",
                bgcolor: selected ? "text.primary" : "transparent",
                color: selected ? "background.paper" : "text.primary",
                "&:hover": { bgcolor: selected ? "text.primary" : "action.hover" },
              }}
            >
              <Icon size={15} style={{ flexShrink: 0, opacity: 0.8 }} />
              <Typography variant="body2" fontWeight={selected ? 600 : 500} noWrap sx={{ flex: 1 }}>
                {folderLabel(folder)}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: selected ? "background.paper" : "text.secondary",
                  opacity: selected ? 0.7 : 1,
                }}
              >
                {itemCount(folder) || ""}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Button
        variant="text"
        size="small"
        startIcon={<Plus size={15} />}
        onClick={() => setShowNew(true)}
        sx={{ mt: 0.5, justifyContent: "flex-start", color: "text.secondary" }}
      >
        New folder
      </Button>
    </Box>
  );
}
