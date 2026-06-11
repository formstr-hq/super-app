import { Box, Dialog, Typography } from "@mui/material";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["Command palette", "⌘K"],
  ["Save page", "⌘S"],
  ["Saved AI prompt", "/keyword"],
  ["Block menu (Pages editor)", "/"],
  ["Link entity (Pages editor)", "@"],
  ["This dialog", "?"],
];

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
          Keyboard shortcuts
        </Typography>
        {SHORTCUTS.map(([label, key]) => (
          <Box
            key={label}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              py: 0.75,
            }}
          >
            <Typography variant="body2">{label}</Typography>
            <Box
              component="kbd"
              sx={{
                fontFamily: "monospace",
                fontSize: 12,
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 0.5,
                px: 0.75,
                py: 0.25,
              }}
            >
              {key}
            </Box>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
}
