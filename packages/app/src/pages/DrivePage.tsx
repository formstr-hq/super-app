import { Alert, Box, LinearProgress } from "@mui/material";
import { useEffect, useRef, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { DriveSidebar } from "../components/drive/DriveSidebar";
import { DriveToolbar } from "../components/drive/DriveToolbar";
import { FileList } from "../components/drive/FileList";
import { MoveFileDialog } from "../components/drive/MoveFileDialog";
import { RenameFileDialog } from "../components/drive/RenameFileDialog";
import type { FileMetadata } from "../services/drive";
import { useDriveStore } from "../stores";

function depth(path: string): number {
  return path === "/" ? 0 : path.split("/").filter(Boolean).length;
}

export function DrivePage() {
  const {
    files: allFiles,
    isLoading,
    isUploading,
    error,
    currentFolder,
    servers,
    selectedServer,
    fetchFiles,
    loadServers,
    uploadFile,
    deleteFile,
    downloadFile,
    renameFile,
    moveFile,
    setCurrentFolder,
    addCustomFolder,
    setSelectedServer,
    addCustomServer,
    getFolders,
    getFilesInFolder,
  } = useDriveStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileMetadata | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileMetadata | null>(null);

  useEffect(() => {
    fetchFiles();
    loadServers();
  }, [fetchFiles, loadServers]);

  const allFolders = getFolders();
  const childFolders = allFolders.filter(
    (f) =>
      f !== currentFolder &&
      f.startsWith(currentFolder === "/" ? "/" : currentFolder + "/") &&
      depth(f) === depth(currentFolder) + 1,
  );
  const files = getFilesInFolder(currentFolder);

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

  const handleDownload = async (file: FileMetadata) => {
    setDownloadingHash(file.hash);
    try {
      const data = await downloadFile(file);
      const blob = new Blob([data as BlobPart], { type: file.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingHash(null);
    }
  };

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      <DriveSidebar
        folders={allFolders}
        currentFolder={currentFolder}
        files={allFiles}
        onSelect={setCurrentFolder}
        onNewFolder={(path) => {
          addCustomFolder(path);
          setCurrentFolder(path);
        }}
      />

      <Box
        sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <DriveToolbar
          currentFolder={currentFolder}
          servers={servers}
          selectedServer={selectedServer}
          isUploading={isUploading}
          onNavigate={setCurrentFolder}
          onSelectServer={setSelectedServer}
          onAddCustomServer={addCustomServer}
          onUploadClick={() => fileInputRef.current?.click()}
        />
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelect} />

        <AIPendingRow module="drive" />
        {error && (
          <Alert severity="error" sx={{ m: 2, mb: 0, py: 0.5 }}>
            {error}
          </Alert>
        )}
        {isUploading && <LinearProgress />}

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            ...(isDragOver && {
              outline: (theme) => `2px dashed ${theme.palette.primary.main}`,
              outlineOffset: -8,
              bgcolor: "action.hover",
            }),
          }}
        >
          <FileList
            childFolders={childFolders}
            files={files}
            isLoading={isLoading}
            downloadingHash={downloadingHash}
            onOpenFolder={setCurrentFolder}
            onDownload={handleDownload}
            onRename={setRenameTarget}
            onMove={setMoveTarget}
            onDelete={deleteFile}
          />
        </Box>
      </Box>

      <RenameFileDialog
        file={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={renameFile}
      />
      <MoveFileDialog
        file={moveTarget}
        folders={allFolders}
        onClose={() => setMoveTarget(null)}
        onMove={moveFile}
      />
    </Box>
  );
}
