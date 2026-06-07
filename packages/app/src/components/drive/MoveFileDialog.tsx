import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";

import type { FileMetadata } from "../../services/drive";

interface MoveFileDialogProps {
  file: FileMetadata | null;
  folders: string[];
  onClose: () => void;
  onMove: (file: FileMetadata, newFolder: string) => void;
}

const NEW_FOLDER = "__new__";

function folderLabel(path: string): string {
  return path === "/" ? "My Drive (root)" : path;
}

export function MoveFileDialog({ file, folders, onClose, onMove }: MoveFileDialogProps) {
  const [target, setTarget] = useState("/");
  const [newPath, setNewPath] = useState("");

  useEffect(() => {
    if (file) {
      setTarget(file.folder);
      setNewPath("");
    }
  }, [file]);

  const submit = () => {
    if (!file) return;
    let dest = target;
    if (target === NEW_FOLDER) {
      const trimmed = newPath.trim();
      if (!trimmed) return;
      dest = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    }
    if (dest !== file.folder) onMove(file, dest);
    onClose();
  };

  return (
    <Dialog open={!!file} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Move file</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          Move “{file?.name}” to
        </Typography>
        <TextField
          select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          size="small"
          fullWidth
        >
          {folders.map((f) => (
            <MenuItem key={f} value={f}>
              {folderLabel(f)}
            </MenuItem>
          ))}
          <MenuItem value={NEW_FOLDER}>New folder…</MenuItem>
        </TextField>
        {target === NEW_FOLDER && (
          <TextField
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="/path/to/folder"
            size="small"
            autoFocus
            fullWidth
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}
