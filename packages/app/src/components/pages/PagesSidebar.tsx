import { Box, Button, Chip, Divider, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { FileText, Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { PageSummary } from "../../services/pages";

interface PagesSidebarProps {
  pages: PageSummary[];
  sharedPages: PageSummary[];
  selectedAddress?: string;
  allTags: string[];
  activeTag: string | null;
  onSelect: (page: PageSummary) => void;
  onNew: () => void;
  onToggleTag: (tag: string | null) => void;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: "text.secondary",
        px: 0.5,
        mt: 1.5,
        mb: 0.5,
      }}
    >
      {children}
    </Typography>
  );
}

function PageRow({
  page,
  selected,
  onClick,
}: {
  page: PageSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const sub = page.shared
    ? `from ${page.pubkey.slice(0, 8)}…`
    : new Date(page.createdAt * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

  return (
    <Box
      role="button"
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 0.85,
        py: 0.85,
        borderRadius: 1,
        cursor: "pointer",
        bgcolor: selected ? "text.primary" : "transparent",
        color: selected ? "background.paper" : "text.primary",
        "&:hover": { bgcolor: selected ? "text.primary" : "action.hover" },
      }}
    >
      <FileText size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={500} noWrap>
          {page.title || "Untitled"}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          sx={{
            display: "block",
            color: selected ? "background.paper" : "text.secondary",
            opacity: selected ? 0.7 : 1,
          }}
        >
          {sub}
        </Typography>
      </Box>
      {page.shared && (
        <Box
          component="span"
          sx={{
            flexShrink: 0,
            fontSize: 9.5,
            fontWeight: 600,
            lineHeight: 1,
            px: 0.7,
            py: 0.3,
            borderRadius: 5,
            border: 1,
            borderColor: selected ? "background.paper" : "divider",
            color: selected ? "background.paper" : "text.secondary",
            opacity: selected ? 0.85 : 1,
          }}
        >
          {page.canEdit ? "edit" : "view"}
        </Box>
      )}
    </Box>
  );
}

export function PagesSidebar({
  pages,
  sharedPages,
  selectedAddress,
  allTags,
  activeTag,
  onSelect,
  onNew,
  onToggleTag,
}: PagesSidebarProps) {
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
        sx={{ mb: 0.5 }}
      >
        New Page
      </Button>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
        }}
      >
        <SectionLabel>My Pages</SectionLabel>
        {pages.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            No pages yet
          </Typography>
        ) : (
          pages.map((p) => (
            <PageRow
              key={p.address}
              page={p}
              selected={p.address === selectedAddress}
              onClick={() => onSelect(p)}
            />
          ))
        )}

        {sharedPages.length > 0 && (
          <>
            <SectionLabel>Shared with me</SectionLabel>
            {sharedPages.map((p) => (
              <PageRow
                key={p.address}
                page={p}
                selected={p.address === selectedAddress}
                onClick={() => onSelect(p)}
              />
            ))}
          </>
        )}

        {allTags.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <SectionLabel>Tags</SectionLabel>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", px: 0.5 }}>
              {allTags.map((t) => {
                const on = activeTag === t;
                return (
                  <Chip
                    key={t}
                    label={t}
                    size="small"
                    variant="outlined"
                    onClick={() => onToggleTag(on ? null : t)}
                    sx={{
                      height: 22,
                      fontSize: 11,
                      cursor: "pointer",
                      ...(on && {
                        bgcolor: "text.primary",
                        color: "background.paper",
                        borderColor: "text.primary",
                        "&:hover": { bgcolor: "text.primary" },
                      }),
                    }}
                  />
                );
              })}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
