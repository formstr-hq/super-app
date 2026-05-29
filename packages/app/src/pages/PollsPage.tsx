import { createRef } from "@formstr/core";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Grid2 as Grid,
  IconButton,
  LinearProgress,
  Paper,
  Radio,
  RadioGroup,
  Skeleton,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Plus, BarChart3, Eye, Link2, Vote, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import type { PollType, PollDraft, PollOption } from "../services/polls";
import { POLLS_KINDS } from "../services/polls/types";
import { usePollsStore } from "../stores";

export function PollsPage() {
  const {
    myPolls,
    recentPolls,
    isLoadingMine,
    isLoadingRecent,
    error,
    fetchMyPolls,
    fetchRecentPolls,
    createPoll,
  } = usePollsStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewPollId, setViewPollId] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const theme = useTheme();

  useEffect(() => {
    fetchMyPolls();
    fetchRecentPolls();
  }, [fetchMyPolls, fetchRecentPolls]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" fontWeight={600}>
          Polls
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<Plus size={16} />}
          onClick={() => setCreateOpen(true)}
        >
          New Poll
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ py: 0.5 }}>
          {error}
        </Alert>
      )}
      <AIPendingRow module="polls" />

      <Box>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: `1px solid ${theme.palette.divider}`, mb: 2 }}
        >
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                My Polls
                {myPolls.length > 0 && (
                  <Chip label={myPolls.length} size="small" sx={{ height: 16, fontSize: 10 }} />
                )}
              </Box>
            }
            sx={{ fontSize: 13, minHeight: 40 }}
          />
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                Recent
                {recentPolls.length > 0 && (
                  <Chip label={recentPolls.length} size="small" sx={{ height: 16, fontSize: 10 }} />
                )}
              </Box>
            }
            sx={{ fontSize: 13, minHeight: 40 }}
          />
        </Tabs>

        {tab === 0 &&
          (isLoadingMine ? (
            <PollSkeletons />
          ) : myPolls.length === 0 ? (
            <PollEmptyState onNew={() => setCreateOpen(true)} />
          ) : (
            <Grid container spacing={1.5}>
              {myPolls.map((poll) => (
                <Grid key={poll.id} size={{ xs: 12, sm: 6 }}>
                  <PollCard
                    question={poll.content}
                    pollType={poll.pollType}
                    optionCount={poll.options.length}
                    createdAt={poll.createdAt}
                    onView={() => setViewPollId(poll.id)}
                  />
                </Grid>
              ))}
            </Grid>
          ))}

        {tab === 1 &&
          (isLoadingRecent ? (
            <PollSkeletons />
          ) : recentPolls.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                py: 8,
                gap: 1,
                textAlign: "center",
              }}
            >
              <BarChart3 size={32} color={theme.palette.text.secondary} />
              <Typography variant="body2" color="text.secondary">
                No recent polls found
              </Typography>
            </Box>
          ) : (
            <Grid container spacing={1.5}>
              {recentPolls.map((poll) => (
                <Grid key={poll.id} size={{ xs: 12, sm: 6 }}>
                  <PollCard
                    question={poll.content}
                    pollType={poll.pollType}
                    optionCount={poll.options.length}
                    createdAt={poll.createdAt}
                    onView={() => setViewPollId(poll.id)}
                  />
                </Grid>
              ))}
            </Grid>
          ))}
      </Box>

      <CreatePollDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createPoll}
      />
      {viewPollId && <PollDetailDialog pollId={viewPollId} onClose={() => setViewPollId(null)} />}
    </Box>
  );
}

// ── Skeletons ─────────────────────────────────────────────

function PollSkeletons() {
  return (
    <Grid container spacing={1.5}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
            <Skeleton variant="text" width="75%" />
            <Skeleton variant="text" width="35%" sx={{ mt: 0.5 }} />
            <Box sx={{ display: "flex", gap: 0.75, mt: 1 }}>
              <Skeleton variant="rounded" width={70} height={18} sx={{ borderRadius: 10 }} />
              <Skeleton variant="rounded" width={80} height={18} sx={{ borderRadius: 10 }} />
            </Box>
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}

// ── Empty state ───────────────────────────────────────────

function PollEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 10,
        gap: 1.5,
        textAlign: "center",
      }}
    >
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: 2,
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BarChart3 size={28} color="text.secondary" />
      </Box>
      <Typography variant="body2" fontWeight={500}>
        No polls yet
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Create your first poll to gather responses
      </Typography>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Plus size={14} />}
        onClick={onNew}
        sx={{ mt: 0.5 }}
      >
        New Poll
      </Button>
    </Box>
  );
}

// ── Poll Card ─────────────────────────────────────────────

function PollCard({
  question,
  pollType,
  optionCount,
  createdAt,
  onView,
}: {
  question: string;
  pollType: PollType;
  optionCount: number;
  createdAt: number;
  onView: () => void;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 1.5,
        cursor: "pointer",
        "&:hover": { boxShadow: 2 },
        "&:hover .poll-view": { opacity: 1 },
        transition: "box-shadow 150ms",
      }}
      onClick={onView}
    >
      <Typography variant="body2" fontWeight={500} sx={{ mb: 1, lineHeight: 1.4 }}>
        {question}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Chip
          label={pollType === "singlechoice" ? "Single choice" : "Multiple choice"}
          size="small"
        />
        <Chip label={`${optionCount} options`} size="small" variant="outlined" />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          {new Date(createdAt * 1000).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Typography>
        <Button
          className="poll-view"
          size="small"
          variant="text"
          startIcon={<Eye size={12} />}
          sx={{ fontSize: 12, opacity: 0, transition: "opacity 150ms", color: "text.secondary" }}
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          View
        </Button>
      </Box>
    </Paper>
  );
}

// ── Create Poll Dialog ────────────────────────────────────

function CreatePollDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: PollDraft) => Promise<unknown>;
}) {
  const [question, setQuestion] = useState("");
  const [pollType, setPollType] = useState<PollType>("singlechoice");
  const [options, setOptions] = useState<PollOption[]>([
    { id: "1", label: "" },
    { id: "2", label: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addOption = () => setOptions([...options, { id: String(options.length + 1), label: "" }]);
  const updateOption = (index: number, label: string) => {
    const u = [...options];
    u[index] = { ...u[index], label };
    setOptions(u);
  };
  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    try {
      await onCreate({ question, pollType, options });
      setQuestion("");
      setPollType("singlechoice");
      setOptions([
        { id: "1", label: "" },
        { id: "2", label: "" },
      ]);
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = question.trim() && options.every((o) => o.label.trim()) && !isSubmitting;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create Poll</DialogTitle>
      <DialogContentText sx={{ px: 3, pb: 0 }}>
        Ask a question and collect responses.
      </DialogContentText>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <TextField
          label="Question"
          size="small"
          fullWidth
          placeholder="What would you like to ask?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />

        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Response type
          </Typography>
          <RadioGroup
            value={pollType}
            onChange={(e) => setPollType(e.target.value as PollType)}
            row
          >
            <FormControlLabel
              value="singlechoice"
              control={<Radio size="small" />}
              label={<Typography variant="body2">Single choice</Typography>}
            />
            <FormControlLabel
              value="multiplechoice"
              control={<Radio size="small" />}
              label={<Typography variant="body2">Multiple choice</Typography>}
            />
          </RadioGroup>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
            Options
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
              maxHeight: 192,
              overflowY: "auto",
              pr: 0.5,
            }}
          >
            {options.map((opt, index) => (
              <Box key={opt.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: 20, textAlign: "right", flexShrink: 0 }}
                >
                  {index + 1}.
                </Typography>
                <TextField
                  size="small"
                  placeholder={`Option ${index + 1}`}
                  value={opt.label}
                  onChange={(e) => updateOption(index, e.target.value)}
                  sx={{ flex: 1, "& .MuiInputBase-input": { py: 0.625, fontSize: 13 } }}
                />
                <IconButton
                  size="small"
                  color="error"
                  disabled={options.length <= 2}
                  onClick={() => removeOption(index)}
                >
                  <X size={13} />
                </IconButton>
              </Box>
            ))}
          </Box>
          <Button
            size="small"
            variant="text"
            startIcon={<Plus size={13} />}
            onClick={addOption}
            sx={{ mt: 0.5, color: "text.secondary", fontSize: 12 }}
          >
            Add option
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={!isValid}>
          {isSubmitting ? "Creating…" : "Create Poll"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Poll Detail Dialog ────────────────────────────────────

function PollDetailDialog({ pollId, onClose }: { pollId: string; onClose: () => void }) {
  const { currentPoll, currentResults, isLoadingDetail, loadPoll, loadResults, submitResponse } =
    usePollsStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [voted, setVoted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadPoll(pollId);
    loadResults(pollId);
    setSelected([]);
    setVoted(false);
  }, [pollId, loadPoll, loadResults]);

  const handleCopyLink = async () => {
    if (!currentPoll) return;
    try {
      const naddr = createRef("polls", POLLS_KINDS.poll, currentPoll.pubkey, currentPoll.id);
      await navigator.clipboard.writeText(naddr);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleVote = async () => {
    if (!currentPoll || selected.length === 0) return;
    await submitResponse(pollId, currentPoll.pubkey, selected);
    setVoted(true);
    loadResults(pollId);
  };

  const resultEntries = currentResults ? Array.from(currentResults.results.entries()) : [];
  const totalVotes = currentResults?.totalVotes ?? 0;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isLoadingDetail ? "Loading…" : (currentPoll?.content ?? "Poll")}</DialogTitle>
      {currentResults && (
        <DialogContentText sx={{ px: 3, pb: 0 }}>
          {totalVotes} response{totalVotes !== 1 ? "s" : ""}
        </DialogContentText>
      )}
      <DialogContent>
        {isLoadingDetail ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={40} />
            ))}
          </Box>
        ) : currentPoll ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* Voting options */}
            {!voted && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                {currentPoll.pollType === "singlechoice" ? (
                  <RadioGroup
                    value={selected[0] ?? ""}
                    onChange={(e) => setSelected([e.target.value])}
                  >
                    {currentPoll.options.map((opt) => (
                      <Paper
                        key={opt.id}
                        variant="outlined"
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.5,
                          py: 1,
                          cursor: "pointer",
                          borderRadius: 1,
                          borderColor: selected[0] === opt.id ? "primary.main" : "divider",
                          bgcolor: selected[0] === opt.id ? "primary.main" + "0A" : "transparent",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                        onClick={() => setSelected([opt.id])}
                      >
                        <Radio value={opt.id} size="small" sx={{ p: 0 }} />
                        <Typography variant="body2">{opt.label}</Typography>
                      </Paper>
                    ))}
                  </RadioGroup>
                ) : (
                  currentPoll.options.map((opt) => (
                    <Paper
                      key={opt.id}
                      variant="outlined"
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        px: 1.5,
                        py: 1,
                        cursor: "pointer",
                        borderRadius: 1,
                        borderColor: selected.includes(opt.id) ? "primary.main" : "divider",
                        bgcolor: selected.includes(opt.id) ? "primary.main" + "0A" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                      onClick={() =>
                        setSelected(
                          selected.includes(opt.id)
                            ? selected.filter((id) => id !== opt.id)
                            : [...selected, opt.id],
                        )
                      }
                    >
                      <Checkbox
                        checked={selected.includes(opt.id)}
                        size="small"
                        sx={{ p: 0 }}
                        onChange={() => {}}
                      />
                      <Typography variant="body2">{opt.label}</Typography>
                    </Paper>
                  ))
                )}
              </Box>
            )}

            {/* Results */}
            {currentResults && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {voted && (
                  <Alert severity="success" sx={{ py: 0.25 }}>
                    Your vote was recorded.
                  </Alert>
                )}
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "text.secondary",
                  }}
                >
                  Results
                </Typography>
                {resultEntries.map(([optionId, result]) => {
                  const option = currentPoll.options.find((o) => o.id === optionId);
                  return (
                    <Box key={optionId}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          mb: 0.5,
                        }}
                      >
                        <Typography variant="body2">{option?.label ?? optionId}</Typography>
                        <Typography variant="caption" fontWeight={500} color="text.secondary">
                          {result.percentage.toFixed(0)}%
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={result.percentage}
                        sx={{ height: 6, borderRadius: 1 }}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        ) : (
          <Typography variant="body2" color="error">
            Poll not found
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {currentPoll && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<Link2 size={14} />}
            onClick={handleCopyLink}
          >
            {copied ? "Copied!" : "Copy link"}
          </Button>
        )}
        {!voted && currentPoll && (
          <Button
            variant="contained"
            size="small"
            startIcon={<Vote size={14} />}
            onClick={handleVote}
            disabled={selected.length === 0 || isLoadingDetail}
          >
            Submit Vote
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
