import { createRef } from "@formstr/core";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Radio,
  Skeleton,
  Typography,
} from "@mui/material";
import { BarChart3, Check, Link2, MoreVertical, Trash2, Users, Vote } from "lucide-react";
import { useEffect, useState } from "react";

import type { Poll, PollResults } from "../../services/polls";
import { POLLS_KINDS } from "../../services/polls/types";

import { VotersModal } from "./VotersModal";

interface PollDetailProps {
  poll: Poll | null;
  results: PollResults | null;
  isLoading: boolean;
  currentUserPubkey: string | null;
  onVote: (optionIds: string[]) => Promise<void>;
  onClearVotes: () => void;
  onDelete: () => void;
}

export function PollDetail({
  poll,
  results,
  isLoading,
  currentUserPubkey,
  onVote,
  onClearVotes,
  onDelete,
}: PollDetailProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [votersOpen, setVotersOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const ended = poll?.endsAt ? poll.endsAt * 1000 < Date.now() : false;

  // Reset interaction state whenever the open poll changes; show results up-front for ended polls.
  useEffect(() => {
    setSelected([]);
    setShowResults(ended);
  }, [poll?.id, ended]);

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 1.5, maxWidth: 640 }}>
        <Skeleton variant="text" width="60%" height={32} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={44} />
        ))}
      </Box>
    );
  }

  if (!poll) {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          color: "text.secondary",
        }}
      >
        <BarChart3 size={40} strokeWidth={1.4} />
        <Typography variant="body2" fontWeight={500}>
          Select a poll or create a new one
        </Typography>
      </Box>
    );
  }

  const isOwner = !!currentUserPubkey && currentUserPubkey === poll.pubkey;
  const totalVotes = results?.totalVotes ?? 0;
  const toggle = (optionId: string) => {
    if (poll.pollType === "singlechoice") setSelected([optionId]);
    else
      setSelected((s) =>
        s.includes(optionId) ? s.filter((x) => x !== optionId) : [...s, optionId],
      );
  };

  const handleVote = async () => {
    if (selected.length === 0) return;
    await onVote(selected);
    setShowResults(true);
  };

  const handleCopyLink = async () => {
    setMenuAnchor(null);
    try {
      const naddr = createRef("polls", POLLS_KINDS.poll, poll.pubkey, poll.id);
      await navigator.clipboard.writeText(naddr);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const meta = [
    poll.pollType === "multiplechoice" ? "Multiple choice" : "Single choice",
    `${totalVotes} vote${totalVotes !== 1 ? "s" : ""}`,
    poll.endsAt
      ? ended
        ? "ended"
        : `ends ${new Date(poll.endsAt * 1000).toLocaleDateString()}`
      : null,
    isOwner ? "by you" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 2, md: 4 }, py: 3 }}>
      <Box sx={{ maxWidth: 640, mx: "auto" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} sx={{ lineHeight: 1.3 }}>
              {poll.content}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {meta}
            </Typography>
          </Box>
          <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <MoreVertical size={18} />
          </IconButton>
        </Box>

        {ended && (
          <Alert severity="info" sx={{ mt: 2, py: 0.25 }}>
            This poll has ended.
          </Alert>
        )}

        {copied && (
          <Alert severity="success" sx={{ mt: 2, py: 0.25 }}>
            Poll link copied.
          </Alert>
        )}

        <Box sx={{ mt: 2.5, display: "flex", flexDirection: "column", gap: 1 }}>
          {showResults
            ? poll.options.map((opt) => {
                const r = results?.results.get(opt.id);
                const pct = r?.percentage ?? 0;
                return (
                  <Box key={opt.id}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="body2">{opt.label}</Typography>
                      <Typography variant="caption" color="text.secondary" fontWeight={500}>
                        {r?.count ?? 0} · {pct.toFixed(0)}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{ height: 7, borderRadius: 1 }}
                    />
                  </Box>
                );
              })
            : poll.options.map((opt) => {
                const on = selected.includes(opt.id);
                return (
                  <Paper
                    key={opt.id}
                    variant="outlined"
                    onClick={() => !ended && toggle(opt.id)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      px: 1.5,
                      py: 1,
                      borderRadius: 1,
                      cursor: ended ? "default" : "pointer",
                      borderColor: on ? "text.primary" : "divider",
                      "&:hover": { bgcolor: ended ? "transparent" : "action.hover" },
                    }}
                  >
                    {poll.pollType === "singlechoice" ? (
                      <Radio checked={on} size="small" sx={{ p: 0 }} disabled={ended} />
                    ) : (
                      <Checkbox
                        checked={on}
                        size="small"
                        sx={{ p: 0 }}
                        disabled={ended}
                        onChange={() => {}}
                      />
                    )}
                    <Typography variant="body2">{opt.label}</Typography>
                  </Paper>
                );
              })}
        </Box>

        <Box sx={{ display: "flex", gap: 1, mt: 2.5, alignItems: "center" }}>
          {!ended && (
            <Button
              variant="contained"
              size="small"
              startIcon={<Vote size={15} />}
              onClick={handleVote}
              disabled={selected.length === 0}
            >
              {showResults ? "Update vote" : "Vote"}
            </Button>
          )}
          <Button variant="outlined" size="small" onClick={() => setShowResults((v) => !v)}>
            {showResults ? "Hide results" : "Results"}
          </Button>
        </Box>
      </Box>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={handleCopyLink}>
          {copied ? (
            <Check size={15} style={{ marginRight: 8 }} />
          ) : (
            <Link2 size={15} style={{ marginRight: 8 }} />
          )}
          Copy poll link
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setVotersOpen(true);
          }}
        >
          <Users size={15} style={{ marginRight: 8 }} />
          See voters
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onClearVotes();
          }}
        >
          Clear my votes
        </MenuItem>
        {isOwner && (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onDelete();
            }}
            sx={{ color: "error.main" }}
          >
            <Trash2 size={15} style={{ marginRight: 8 }} />
            Delete poll
          </MenuItem>
        )}
      </Menu>

      <VotersModal
        open={votersOpen}
        onClose={() => setVotersOpen(false)}
        options={poll.options}
        results={results?.results ?? new Map()}
        totalVotes={totalVotes}
      />
    </Box>
  );
}
