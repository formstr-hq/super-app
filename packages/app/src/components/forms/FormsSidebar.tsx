import { Box, Button, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { FileText, LayoutTemplate, Plus, SquarePen, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type FormsCategory = "my" | "shared" | "drafts" | "templates";

interface FormsSidebarProps {
  active: FormsCategory;
  myCount: number;
  onSelect: (category: FormsCategory) => void;
  onNew: () => void;
}

const CATEGORIES: { key: FormsCategory; label: string; Icon: LucideIcon }[] = [
  { key: "my", label: "My Forms", Icon: FileText },
  { key: "shared", label: "Shared with me", Icon: Users },
  { key: "drafts", label: "Drafts", Icon: SquarePen },
  { key: "templates", label: "Templates", Icon: LayoutTemplate },
];

export function FormsSidebar({ active, myCount, onSelect, onNew }: FormsSidebarProps) {
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
        New Form
      </Button>

      {CATEGORIES.map(({ key, label, Icon }) => {
        const selected = key === active;
        const count = key === "my" ? myCount : undefined;
        return (
          <Box
            key={key}
            role="button"
            onClick={() => onSelect(key)}
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
            <Icon size={15} style={{ flexShrink: 0, opacity: 0.8 }} />
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
      })}
    </Box>
  );
}
