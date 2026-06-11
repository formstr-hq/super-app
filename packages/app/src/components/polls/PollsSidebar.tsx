import { Box, Button, Chip, Divider, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { BarChart3, Compass, Plus } from "lucide-react";
import type { ReactNode } from "react";

export type PollSection = "my" | "discover";

interface PollsSidebarProps {
  myPollsCount: number;
  discoverCount: number;
  activeSection: PollSection;
  allTopics: string[];
  activeTopic: string | null;
  isLoading?: boolean;
  onNew: () => void;
  onSectionChange: (section: PollSection) => void;
  onToggleTopic: (topic: string | null) => void;
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

function NavButton({
  icon: Icon,
  label,
  count,
  active,
  loading,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  active: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
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
        bgcolor: active ? "text.primary" : "transparent",
        color: active ? "background.paper" : "text.primary",
        "&:hover": { bgcolor: active ? "text.primary" : "action.hover" },
      }}
    >
      <Icon size={14} style={{ flexShrink: 0, opacity: 0.75 }} />
      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {!loading && count > 0 && (
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            opacity: active ? 0.75 : 0.55,
            minWidth: 16,
            textAlign: "right",
          }}
        >
          {count}
        </Typography>
      )}
    </Box>
  );
}

export function PollsSidebar({
  myPollsCount,
  discoverCount,
  activeSection,
  allTopics,
  activeTopic,
  isLoading = false,
  onNew,
  onSectionChange,
  onToggleTopic,
}: PollsSidebarProps) {
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
        New Poll
      </Button>

      <NavButton
        icon={BarChart3}
        label="My Polls"
        count={myPollsCount}
        active={activeSection === "my"}
        loading={isLoading}
        onClick={() => onSectionChange("my")}
      />
      <NavButton
        icon={Compass}
        label="Discover"
        count={discoverCount}
        active={activeSection === "discover"}
        loading={isLoading}
        onClick={() => onSectionChange("discover")}
      />

      {allTopics.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <SectionLabel>Topics</SectionLabel>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", px: 0.5 }}>
            {allTopics.map((t) => {
              const on = activeTopic === t;
              return (
                <Chip
                  key={t}
                  label={`#${t}`}
                  size="small"
                  variant="outlined"
                  onClick={() => onToggleTopic(on ? null : t)}
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
  );
}
