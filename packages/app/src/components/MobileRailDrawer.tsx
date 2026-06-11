import { Box, Drawer, Fab } from "@mui/material";
import { PanelLeft } from "lucide-react";
import { useState, type ReactNode } from "react";

interface MobileRailDrawerProps {
  /** Render the module rail; call `close` after a navigation so the drawer dismisses. */
  children: (close: () => void) => ReactNode;
  ariaLabel?: string;
}

/**
 * Phone-size access to a module's side rail. The rails hide themselves below
 * the `sm` breakpoint, which left their content (page lists, folders, calendar
 * toggles, …) unreachable on phones — this floats a small launcher that opens
 * the same rail inside an overlay drawer. Invisible at `sm` and up.
 */
export function MobileRailDrawer({ children, ariaLabel }: MobileRailDrawerProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Fab
        size="small"
        aria-label={ariaLabel ?? "Open panel"}
        onClick={() => setOpen(true)}
        sx={{
          display: { xs: "flex", sm: "none" },
          position: "fixed",
          bottom: 16,
          left: 16,
          zIndex: (t) => t.zIndex.fab,
          bgcolor: "background.paper",
          color: "text.primary",
          border: 1,
          borderColor: "divider",
          boxShadow: 3,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <PanelLeft size={18} />
      </Fab>

      <Drawer open={open} onClose={close} sx={{ display: { sm: "none" } }}>
        <Box
          sx={{
            width: 272,
            height: "100%",
            display: "flex",
            // The rails carry `display: { xs: "none", sm: "flex" }` on their
            // <aside> root; inside the drawer they must show at phone widths.
            "& > aside": { display: "flex", width: "100%", borderRight: "none" },
          }}
        >
          {children(close)}
        </Box>
      </Drawer>
    </>
  );
}
