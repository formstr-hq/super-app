import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { FolderOpen, File, Home, CloudUpload, Download, Trash2, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { useDriveStore } from "../stores";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function DrivePage() {
  const {
    isLoading,
    isUploading,
    error,
    currentFolder,
    fetchFiles,
    uploadFile,
    deleteFile,
    downloadFile,
    setCurrentFolder,
    getFolders,
    getFilesInFolder,
  } = useDriveStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const folders = getFolders().filter((f) => {
    if (currentFolder === "/") return !f.slice(1).includes("/") && f !== "/";
    return f.startsWith(currentFolder) && f !== currentFolder;
  });
  const files = getFilesInFolder(currentFolder);

  const breadcrumbs = currentFolder
    .split("/")
    .filter(Boolean)
    .reduce<{ label: string; path: string }[]>((acc, segment) => {
      const path = acc.length === 0 ? `/${segment}` : `${acc[acc.length - 1].path}/${segment}`;
      return [...acc, { label: segment, path }];
    }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile({ file, folder: currentFolder });
    e.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await uploadFile({ file, folder: currentFolder });
  };

  const handleDownload = async (metadata: Parameters<typeof downloadFile>[0]) => {
    setDownloadingHash(metadata.hash);
    try {
      const data = await downloadFile(metadata);
      const blob = new Blob([data as BlobPart], { type: metadata.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = metadata.name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingHash(null);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" fontWeight={600}>
          Drive
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={
            isUploading ? <CircularProgress size={14} color="inherit" /> : <CloudUpload size={16} />
          }
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? "Uploading…" : "Upload"}
        </Button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelect} />
      </Box>

      {error && (
        <Alert severity="error" sx={{ py: 0.5 }}>
          {error}
        </Alert>
      )}
      {isUploading && <LinearProgress sx={{ borderRadius: 1 }} />}

      <AIPendingRow module="drive" />

      {/* Breadcrumb */}
      <Box
        component="nav"
        aria-label="Folder path"
        sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}
      >
        <Box
          component="button"
          onClick={() => setCurrentFolder("/")}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            fontSize: 12,
            fontWeight: 500,
            px: 1,
            py: 0.375,
            borderRadius: 1,
            border: "none",
            cursor: "pointer",
            bgcolor: currentFolder === "/" ? "action.selected" : "transparent",
            color: currentFolder === "/" ? "text.primary" : "text.secondary",
            "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          }}
        >
          <Home size={12} />
          Root
        </Box>
        {breadcrumbs.map((crumb, i) => (
          <Box key={crumb.path} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <ChevronRight size={12} color={theme.palette.text.secondary} />
            <Box
              component="button"
              onClick={() => setCurrentFolder(crumb.path)}
              sx={{
                fontSize: 12,
                fontWeight: 500,
                px: 1,
                py: 0.375,
                borderRadius: 1,
                border: "none",
                cursor: "pointer",
                bgcolor: i === breadcrumbs.length - 1 ? "action.selected" : "transparent",
                color: i === breadcrumbs.length - 1 ? "text.primary" : "text.secondary",
                "&:hover": { bgcolor: "action.hover", color: "text.primary" },
              }}
            >
              {crumb.label}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Drop zone + content */}
      <Paper
        variant="outlined"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        sx={{
          borderRadius: 1.5,
          minHeight: 200,
          overflow: "hidden",
          borderStyle: isDragOver ? "dashed" : "solid",
          borderColor: isDragOver ? "primary.main" : "divider",
          bgcolor: isDragOver ? "action.hover" : "transparent",
          transition: "all 150ms",
        }}
      >
        {isLoading ? (
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5 }}>
                <Skeleton variant="rounded" width={16} height={16} />
                <Skeleton variant="text" sx={{ flex: 1 }} />
                <Skeleton variant="text" width={80} />
              </Box>
            ))}
          </Box>
        ) : folders.length === 0 && files.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              py: 8,
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
        ) : (
          <Box>
            {/* Folders */}
            {folders.map((folder) => {
              const label = folder.split("/").filter(Boolean).pop() ?? folder;
              return (
                <Box
                  key={folder}
                  component="button"
                  onClick={() => setCurrentFolder(folder)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: 2,
                    py: 1.25,
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    cursor: "pointer",
                    bgcolor: "transparent",
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    "&:hover": { bgcolor: "action.hover" },
                    "&:hover .folder-arrow": { opacity: 1 },
                  }}
                >
                  <FolderOpen size={16} color="#f59e0b" />
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {label}
                  </Typography>
                  <ChevronRight
                    size={14}
                    className="folder-arrow"
                    color={theme.palette.text.secondary}
                    style={{ opacity: 0, transition: "opacity 150ms" }}
                  />
                </Box>
              );
            })}

            {/* Files */}
            {files.map((file, idx) => (
              <Box
                key={file.hash}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1.25,
                  borderBottom:
                    idx < files.length - 1 ? `1px solid ${theme.palette.divider}` : "none",
                  "&:hover": { bgcolor: "action.hover" },
                  "&:hover .file-actions": { opacity: 1 },
                }}
              >
                <File size={16} color={theme.palette.text.secondary} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {file.name}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.25 }}>
                    <Typography variant="caption" color="text.secondary">
                      {formatBytes(file.size)}
                    </Typography>
                    <Chip
                      label={file.type}
                      size="small"
                      variant="outlined"
                      sx={{ height: 16, fontSize: 10 }}
                    />
                  </Box>
                </Box>
                <Box
                  className="file-actions"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.25,
                    opacity: 0,
                    transition: "opacity 150ms",
                  }}
                >
                  <Tooltip title="Download">
                    <IconButton
                      size="small"
                      disabled={downloadingHash === file.hash}
                      onClick={() => handleDownload(file)}
                    >
                      {downloadingHash === file.hash ? (
                        <CircularProgress size={14} />
                      ) : (
                        <Download size={14} />
                      )}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => deleteFile(file)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
