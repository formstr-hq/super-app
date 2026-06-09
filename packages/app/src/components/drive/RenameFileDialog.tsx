import type { FileMetadata } from "@formstr/agent/services/drive";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";

interface RenameFileDialogProps {
  file: FileMetadata | null;
  onClose: () => void;
  onRename: (file: FileMetadata, newName: string) => void;
}

export function RenameFileDialog({ file, onClose, onRename }: RenameFileDialogProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (file) setName(file.name);
  }, [file]);

  const submit = () => {
    const trimmed = name.trim();
    if (!file || !trimmed || trimmed === file.name) {
      onClose();
      return;
    }
    onRename(file, trimmed);
    onClose();
  };

  return (
    <Dialog open={!!file} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Rename file</DialogTitle>
      <DialogContent>
        <TextField
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
          fullWidth
          size="small"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit}>
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}
