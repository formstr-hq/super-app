import { Box, Button, Chip, Divider, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { BarChart3, Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { Poll } from "../../services/polls";

interface PollsSidebarProps {
  myPolls: Poll[];
  recentPolls: Poll[];
  selectedId?: string;
  allTopics: string[];
  activeTopic: string | null;
  onSelect: (poll: Poll) => void;
  onNew: () => void;
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

function PollRow({
  poll,
  selected,
  onClick,
}: {
  poll: Poll;
  selected: boolean;
  onClick: () => void;
}) {
  const ended = poll.endsAt ? poll.endsAt * 1000 < Date.now() : false;
  const sub = new Date(poll.createdAt * 1000).toLocaleDateString(undefined, {
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
      <BarChart3 size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={500} noWrap>
          {poll.content || "Untitled poll"}
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
          {poll.pollType === "multiplechoice" ? "Multiple · " : ""}
          {poll.options.length} options · {ended ? "ended" : sub}
        </Typography>
      </Box>
    </Box>
  );
}

export function PollsSidebar({
  myPolls,
  recentPolls,
  selectedId,
  allTopics,
  activeTopic,
  onSelect,
  onNew,
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
        <SectionLabel>My Polls</SectionLabel>
        {myPolls.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            No polls yet
          </Typography>
        ) : (
          myPolls.map((p) => (
            <PollRow
              key={p.id}
              poll={p}
              selected={p.id === selectedId}
              onClick={() => onSelect(p)}
            />
          ))
        )}

        {recentPolls.length > 0 && (
          <>
            <SectionLabel>Discover</SectionLabel>
            {recentPolls.map((p) => (
              <PollRow
                key={p.id}
                poll={p}
                selected={p.id === selectedId}
                onClick={() => onSelect(p)}
              />
            ))}
          </>
        )}

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
    </Box>
  );
}
