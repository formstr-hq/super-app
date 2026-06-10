import type { Poll } from "@formstr/agent/services/polls";
import { Alert, Box } from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { MobileRailDrawer } from "../components/MobileRailDrawer";
import { CreatePollDialog } from "../components/polls/CreatePollDialog";
import { PollDetail } from "../components/polls/PollDetail";
import { PollsSidebar } from "../components/polls/PollsSidebar";
import { useAuthStore, usePollsStore } from "../stores";

export function PollsPage() {
  const {
    myPolls,
    recentPolls,
    currentPoll,
    currentResults,
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

  useEffect(() => {
    if (pubkey) fetchMyPolls();
  }, [pubkey, fetchMyPolls]);

  useEffect(() => {
    fetchRecentPolls();
  }, [fetchRecentPolls]);

  // Discover = recent polls that aren't already in My Polls.
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

  const handleSelect = (poll: Poll) => {
    setSelectedId(poll.id);
    loadPoll(poll.id);
    loadResults(poll);
  };

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
      myPolls={byTopic(myPolls)}
      recentPolls={byTopic(discover)}
      selectedId={selectedId ?? undefined}
      allTopics={allTopics}
      activeTopic={activeTopic}
      onSelect={(p) => {
        handleSelect(p);
        onNavigate();
      }}
      onNew={() => {
        setCreateOpen(true);
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
        {error && (
          <Alert severity="error" sx={{ m: 2, mb: 0, py: 0.5 }}>
            {error}
          </Alert>
        )}
        <PollDetail
          poll={selectedId ? currentPoll : null}
          results={currentResults}
          isLoading={!!selectedId && isLoadingDetail}
          currentUserPubkey={pubkey}
          onVote={handleVote}
          onClearVotes={() => currentPoll && clearMyVotes(currentPoll)}
          onDelete={handleDelete}
        />
      </Box>

      <CreatePollDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createPoll}
      />
    </Box>
  );
}
