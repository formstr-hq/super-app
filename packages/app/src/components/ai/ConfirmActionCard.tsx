import { Box, Button, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { AlertTriangle } from "lucide-react";

import type { ConfirmRequest } from "../../ai/types";

export function ConfirmActionCard({
  request,
  onApprove,
  onCancel,
}: {
  request: ConfirmRequest;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        my: 1,
        border: `1px solid ${theme.palette.warning.main}`,
        borderRadius: 1.5,
        bgcolor: "background.paper",
        p: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <AlertTriangle size={15} color={theme.palette.warning.main} />
        <Typography variant="body2" fontWeight={600}>
          Confirm: {request.toolName.replace(/_/g, " ")}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ color: "text.secondary", fontSize: 12.5, mb: 1.25 }}>
        {request.message}
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
        <Button size="small" variant="text" color="inherit" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="small" variant="contained" color="warning" onClick={onApprove}>
          Run action
        </Button>
      </Box>
    </Box>
  );
}
