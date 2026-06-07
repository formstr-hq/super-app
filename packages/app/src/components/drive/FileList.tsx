import type { FileMetadata } from "@formstr/agent/services/drive";
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  ChevronRight,
  CloudUpload,
  Download,
  File as FileIcon,
  FolderClosed,
  FolderInput,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";

interface FileListProps {
  childFolders: string[];
  files: FileMetadata[];
  isLoading: boolean;
  downloadingHash: string | null;
  onOpenFolder: (folder: string) => void;
  onDownload: (file: FileMetadata) => void;
  onRename: (file: FileMetadata) => void;
  onMove: (file: FileMetadata) => void;
  onDelete: (file: FileMetadata) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const GRID = "1fr 90px 120px 110px 40px";

export function FileList({
  childFolders,
  files,
  isLoading,
  downloadingHash,
  onOpenFolder,
  onDownload,
  onRename,
  onMove,
  onDelete,
}: FileListProps) {
  const theme = useTheme();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuFile, setMenuFile] = useState<FileMetadata | null>(null);

  const openMenu = (e: React.MouseEvent<HTMLElement>, file: FileMetadata) => {
    setMenuAnchor(e.currentTarget);
    setMenuFile(file);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuFile(null);
  };
  const run = (fn: (f: FileMetadata) => void) => {
    if (menuFile) fn(menuFile);
    closeMenu();
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5 }}>
            <Skeleton variant="rounded" width={16} height={16} />
            <Skeleton variant="text" sx={{ flex: 1 }} />
            <Skeleton variant="text" width={70} />
          </Box>
        ))}
      </Box>
    );
  }

  if (childFolders.length === 0 && files.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: 10,
          gap: 1.5,
          textAlign: "center",
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: 2,
            bgcolor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CloudUpload size={28} color={theme.palette.text.secondary} />
        </Box>
        <Typography variant="body2" fontWeight={500}>
          Drop files here
        </Typography>
        <Typography variant="caption" color="text.secondary">
          or use the Upload button above
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Header row */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 1.25,
          px: 2,
          py: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          position: "sticky",
          top: 0,
          bgcolor: "background.paper",
          zIndex: 1,
        }}
      >
        {["Name", "Size", "Type", "Modified", ""].map((h, i) => (
          <Typography
            key={i}
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              fontWeight: 600,
            }}
          >
            {h}
          </Typography>
        ))}
      </Box>

      {/* Folders first */}
      {childFolders.map((folder) => (
        <Box
          key={folder}
          role="button"
          onClick={() => onOpenFolder(folder)}
          sx={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 1.25,
            alignItems: "center",
            px: 2,
            py: 1.15,
            cursor: "pointer",
            borderBottom: `1px solid ${theme.palette.divider}`,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
            <FolderClosed
              size={16}
              color={theme.palette.text.secondary}
              style={{ flexShrink: 0 }}
            />
            <Typography variant="body2" fontWeight={600} noWrap>
              {folder.split("/").filter(Boolean).pop()}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            —
          </Typography>
          <span />
          <span />
          <ChevronRight size={15} color={theme.palette.text.disabled} />
        </Box>
      ))}

      {/* Files */}
      {files.map((file) => (
        <Box
          key={file.hash}
          sx={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 1.25,
            alignItems: "center",
            px: 2,
            py: 1.15,
            borderBottom: `1px solid ${theme.palette.divider}`,
            "&:hover": { bgcolor: "action.hover" },
            "&:hover .file-actions": { opacity: 1 },
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
            <FileIcon size={16} color={theme.palette.text.secondary} style={{ flexShrink: 0 }} />
            <Typography variant="body2" noWrap>
              {file.name}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {formatBytes(file.size)}
          </Typography>
          <Box sx={{ minWidth: 0 }}>
            {file.type && (
              <Chip
                label={file.type.split("/").pop()}
                size="small"
                variant="outlined"
                sx={{ height: 18, fontSize: 10, maxWidth: "100%" }}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {new Date(file.uploadedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </Typography>
          <Box
            className="file-actions"
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              opacity: 0,
              transition: "opacity 150ms",
            }}
          >
            <Tooltip title="Download">
              <span>
                <IconButton
                  size="small"
                  disabled={downloadingHash === file.hash}
                  onClick={() => onDownload(file)}
                >
                  {downloadingHash === file.hash ? (
                    <CircularProgress size={14} />
                  ) : (
                    <Download size={15} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <IconButton size="small" onClick={(e) => openMenu(e, file)}>
              <MoreVertical size={15} />
            </IconButton>
          </Box>
        </Box>
      ))}

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}>
        <MenuItem onClick={() => run(onRename)}>
          <ListItemIcon>
            <Pencil size={15} />
          </ListItemIcon>
          Rename
        </MenuItem>
        <MenuItem onClick={() => run(onMove)}>
          <ListItemIcon>
            <FolderInput size={15} />
          </ListItemIcon>
          Move
        </MenuItem>
        <MenuItem onClick={() => run(onDelete)} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "error.main" }}>
            <Trash2 size={15} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
}
