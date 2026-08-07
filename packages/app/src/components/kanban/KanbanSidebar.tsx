import type { KanbanBoard } from "@formstr/kanban-sdk";
import { Box, Button, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Lock, Plus, SquareKanban } from "lucide-react";

import { boardKey } from "../../kanban/boardKey";

interface KanbanSidebarProps {
  boards: KanbanBoard[];
  /** `boardKey` of the open board, or null on the board list. */
  activeKey: string | null;
  onSelect: (board: KanbanBoard | null) => void;
  onNew: () => void;
}

export function KanbanSidebar({ boards, activeKey, onSelect, onNew }: KanbanSidebarProps) {
  const theme = useTheme();

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
        overflowY: "auto",
      }}
    >
      <Button
        variant="contained"
        size="small"
        startIcon={<Plus size={16} />}
        onClick={onNew}
        fullWidth
        sx={{ mb: 1 }}
      >
        New Board
      </Button>

      <SidebarRow
        label="All boards"
        icon={<SquareKanban size={15} style={{ flexShrink: 0, opacity: 0.8 }} />}
        selected={activeKey === null}
        onClick={() => onSelect(null)}
        count={boards.length}
      />

      {boards.map((board) => {
        const key = boardKey(board);
        return (
          <SidebarRow
            key={key}
            label={board.title || "Untitled board"}
            icon={
              board.isPrivate ? (
                <Lock size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
              ) : (
                <Box sx={{ width: 13, flexShrink: 0 }} />
              )
            }
            selected={key === activeKey}
            onClick={() => onSelect(board)}
          />
        );
      })}
    </Box>
  );
}

interface SidebarRowProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  count?: number;
  onClick: () => void;
}

function SidebarRow({ label, icon, selected, count, onClick }: SidebarRowProps) {
  return (
    <Box
      role="button"
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.85,
        borderRadius: 1,
        cursor: "pointer",
        bgcolor: selected ? "text.primary" : "transparent",
        color: selected ? "background.paper" : "text.primary",
        "&:hover": { bgcolor: selected ? "text.primary" : "action.hover" },
      }}
    >
      {icon}
      <Typography variant="body2" fontWeight={selected ? 600 : 500} sx={{ flex: 1 }} noWrap>
        {label}
      </Typography>
      {count !== undefined && count > 0 && (
        <Typography
          variant="caption"
          sx={{
            color: selected ? "background.paper" : "text.secondary",
            opacity: selected ? 0.7 : 1,
          }}
        >
          {count}
        </Typography>
      )}
    </Box>
  );
}
