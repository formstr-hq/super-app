import { useEffect, useRef, useState } from "react";
import {
  FolderOpen, File, Home, CloudUpload, Download, Trash2, ChevronRight, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDriveStore } from "../stores";
import { AIPendingRow } from "../components/ai/AIPendingRow";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function DrivePage() {
  const {
    isLoading, isUploading, error, currentFolder,
    fetchFiles, uploadFile, deleteFile, downloadFile,
    setCurrentFolder, getFolders, getFilesInFolder,
  } = useDriveStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Drive</h1>
        <Button
          size="sm"
          className="gap-1.5 h-8"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading…</>
          ) : (
            <><CloudUpload className="h-3.5 w-3.5" />Upload</>
          )}
        </Button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileSelect} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <AIPendingRow module="drive" />

      {/* Upload progress bar */}
      {isUploading && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse w-1/3" />
        </div>
      )}

      {/* Breadcrumb */}
      <nav aria-label="Folder path" className="flex items-center gap-1 text-sm flex-wrap">
        <button
          onClick={() => setCurrentFolder("/")}
          className={cn(
            "flex items-center gap-1 text-xs font-medium rounded px-1.5 py-0.5 transition-colors duration-150",
            currentFolder === "/"
              ? "text-foreground bg-muted"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <Home className="h-3 w-3" />
          Root
        </button>
        {breadcrumbs.map((crumb, i) => (
          <div key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              onClick={() => setCurrentFolder(crumb.path)}
              className={cn(
                "text-xs font-medium rounded px-1.5 py-0.5 transition-colors duration-150",
                i === breadcrumbs.length - 1
                  ? "text-foreground bg-muted"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {crumb.label}
            </button>
          </div>
        ))}
      </nav>

      {/* Drop zone + content */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "rounded-lg border-2 transition-colors duration-150 min-h-50",
          isDragOver
            ? "border-primary bg-primary/5 border-dashed"
            : "border-border border-solid"
        )}
      >
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <CloudUpload className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Drop files here</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                or use the Upload button above
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Folders */}
            {folders.map((folder) => {
              const label = folder.split("/").filter(Boolean).pop() ?? folder;
              return (
                <button
                  key={folder}
                  onClick={() => setCurrentFolder(folder)}
                  className="group w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors duration-150 text-left"
                >
                  <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="text-sm text-foreground flex-1 truncate">{label}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            })}

            {/* Files */}
            {files.map((file) => (
              <div key={file.hash} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors duration-150">
                <File className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{file.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                    <Badge variant="outline" className="text-xs py-0 h-4">{file.type}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    disabled={downloadingHash === file.hash}
                    onClick={() => handleDownload(file)}
                    aria-label="Download"
                  >
                    {downloadingHash === file.hash
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteFile(file)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm font-medium text-primary">Drop to upload</p>
          </div>
        )}
      </div>
    </div>
  );
}
