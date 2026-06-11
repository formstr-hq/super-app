import type { Poll } from "@formstr/agent/services/polls";
import { Alert, Box, Button, Grid2 as MuiGrid, Typography } from "@mui/material";
import { ArrowLeft, Plus } from "lucide-react";
import { BarChart3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { EmptyState } from "../components/EmptyState";
import { MobileRailDrawer } from "../components/MobileRailDrawer";
import { PageHeader } from "../components/PageHeader";
import { CreatePollDialog } from "../components/polls/CreatePollDialog";
import { PollCard } from "../components/polls/PollCard";
import { PollDetail } from "../components/polls/PollDetail";
import { PollsSidebar, type PollSection } from "../components/polls/PollsSidebar";
import { useAuthStore, usePollsStore } from "../stores";

export function PollsPage() {
  const {
    myPolls,
    recentPolls,
    currentPoll,
    currentResults,
    isLoadingMine,
    isLoadingRecent,
    isLoadingDetail,
    error,
    fetchMyPolls,
    fetchRecentPolls,
    loadPoll,
    loadResults,
    createPoll,
    submitResponse,
    deletePoll,
    clearMyVotes,
  } = usePollsStore();
  const pubkey = useAuthStore((s) => s.pubkey);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PollSection>("my");

  useEffect(() => {
    if (pubkey) fetchMyPolls();
  }, [pubkey, fetchMyPolls]);

  useEffect(() => {
    fetchRecentPolls();
  }, [fetchRecentPolls]);

  const discover = useMemo(() => {
    const mine = new Set(myPolls.map((p) => p.id));
    return recentPolls.filter((p) => !mine.has(p.id));
  }, [myPolls, recentPolls]);

  const allTopics = useMemo(() => {
    const set = new Set<string>();
    for (const p of [...myPolls, ...discover]) for (const t of p.hashtags) set.add(t);
    return [...set].sort();
  }, [myPolls, discover]);

  const byTopic = (list: Poll[]) =>
    activeTopic ? list.filter((p) => p.hashtags.includes(activeTopic)) : list;

  const visiblePolls = byTopic(activeSection === "my" ? myPolls : discover);

  const handleSelect = (poll: Poll) => {
    setSelectedId(poll.id);
    loadPoll(poll.id);
    loadResults(poll);
  };

  const handleBack = () => setSelectedId(null);

  const handleVote = async (optionIds: string[]) => {
    if (!currentPoll) return;
    await submitResponse(currentPoll, optionIds);
    await loadResults(currentPoll);
  };

  const handleDelete = async () => {
    if (!currentPoll) return;
    await deletePoll(currentPoll);
    setSelectedId(null);
  };

  const renderRail = (onNavigate: () => void) => (
    <PollsSidebar
      myPollsCount={myPolls.length}
      discoverCount={discover.length}
      activeSection={activeSection}
      allTopics={allTopics}
      activeTopic={activeTopic}
      isLoading={isLoadingMine || isLoadingRecent}
      onNew={() => {
        setCreateOpen(true);
        onNavigate();
      }}
      onSectionChange={(s) => {
        setActiveSection(s);
        setSelectedId(null);
        onNavigate();
      }}
      onToggleTopic={setActiveTopic}
    />
  );

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      {renderRail(() => {})}
      <MobileRailDrawer ariaLabel="Open polls panel">{renderRail}</MobileRailDrawer>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <AIPendingRow module="polls" />
        <PageHeader
          title="Polls"
          description="Public Nostr polls with live tallies and optional proof-of-work gates."
          action={
            <Button
              size="small"
              variant="contained"
              startIcon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              New poll
            </Button>
          }
        />
        {error && (
          <Alert severity="error" sx={{ m: 2, mb: 0, py: 0.5 }}>
            {error}
          </Alert>
        )}

        {selectedId ? (
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box sx={{ px: { xs: 2, md: 4 }, pt: 1.5, pb: 0 }}>
              <Button
                size="small"
                startIcon={<ArrowLeft size={14} />}
                onClick={handleBack}
                sx={{ textTransform: "none", color: "text.secondary" }}
              >
                {activeSection === "my" ? "My Polls" : "Discover"}
              </Button>
            </Box>
            <PollDetail
              poll={currentPoll}
              results={currentResults}
              isLoading={isLoadingDetail}
              currentUserPubkey={pubkey}
              onVote={handleVote}
              onClearVotes={() => currentPoll && clearMyVotes(currentPoll)}
              onDelete={handleDelete}
            />
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 2, md: 3 }, py: 2 }}>
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{
                mb: 2,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontSize: 11,
              }}
            >
              {activeSection === "my" ? "My Polls" : "Discover"}
              {visiblePolls.length > 0 ? ` · ${visiblePolls.length}` : ""}
            </Typography>
            {visiblePolls.length === 0 && !isLoadingMine && !isLoadingRecent ? (
              <EmptyState
                icon={BarChart3}
                title={activeSection === "my" ? "No polls yet" : "Nothing to discover"}
                description={
                  activeSection === "my"
                    ? "Create your first poll and share it on Nostr for live results."
                    : "No recent public polls found. Check back later."
                }
                actionLabel={activeSection === "my" ? "New poll" : undefined}
                onAction={activeSection === "my" ? () => setCreateOpen(true) : undefined}
                aiHint={activeSection === "my" ? "or ask the AI to draft one" : undefined}
              />
            ) : (
              <MuiGrid container spacing={1.5}>
                {visiblePolls.map((p) => (
                  <MuiGrid key={p.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                    <PollCard poll={p} onSelect={() => handleSelect(p)} />
                  </MuiGrid>
                ))}
              </MuiGrid>
            )}
          </Box>
        )}
      </Box>

      <CreatePollDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createPoll}
      />
    </Box>
  );
}
