import { useEffect, useState } from "react";
import { Plus, BarChart3, Eye, Link2, Vote, X } from "lucide-react";
import { createRef } from "@formstr/core";
import { POLLS_KINDS } from "../services/polls/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { usePollsStore } from "../stores";
import type { PollType, PollDraft, PollOption } from "../services/polls";
import { AIPendingRow } from "../components/ai/AIPendingRow";

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

  useEffect(() => {
    fetchMyPolls();
    fetchRecentPolls();
  }, [fetchMyPolls, fetchRecentPolls]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Polls</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 h-8">
          <Plus className="h-3.5 w-3.5" />
          New Poll
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <AIPendingRow module="polls" />

      <Tabs defaultValue="mine">
        <TabsList className="h-8">
          <TabsTrigger value="mine" className="text-xs h-7">
            My Polls
            {myPolls.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 h-4 px-1.5">
                {myPolls.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recent" className="text-xs h-7">
            Recent
            {recentPolls.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 h-4 px-1.5">
                {recentPolls.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {isLoadingMine ? (
            <PollSkeletons />
          ) : myPolls.length === 0 ? (
            <PollEmptyState onNew={() => setCreateOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {myPolls.map((poll) => (
                <PollCard
                  key={poll.id}
                  question={poll.content}
                  pollType={poll.pollType}
                  optionCount={poll.options.length}
                  createdAt={poll.createdAt}
                  onView={() => setViewPollId(poll.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recent" className="mt-4">
          {isLoadingRecent ? (
            <PollSkeletons />
          ) : recentPolls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No recent polls found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recentPolls.map((poll) => (
                <PollCard
                  key={poll.id}
                  question={poll.content}
                  pollType={poll.pollType}
                  optionCount={poll.options.length}
                  createdAt={poll.createdAt}
                  onView={() => setViewPollId(poll.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreatePollDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createPoll}
      />

      {viewPollId && <PollDetailDialog pollId={viewPollId} onClose={() => setViewPollId(null)} />}
    </div>
  );
}

// ── Skeletons ─────────────────────────────────────────────────

function PollSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="border-border">
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
            <div className="flex gap-1.5">
              <Skeleton className="h-4 w-16 rounded-full" />
              <Skeleton className="h-4 w-20 rounded-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────

function PollEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
        <BarChart3 className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No polls yet</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Create your first poll to gather responses
        </p>
      </div>
      <Button size="sm" onClick={onNew} className="gap-1.5 mt-1 h-8">
        <Plus className="h-3.5 w-3.5" />
        New Poll
      </Button>
    </div>
  );
}

// ── Poll Card ─────────────────────────────────────────────────

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
    <Card className="group border-border hover:border-border/80 hover:shadow-sm transition-all duration-150">
      <CardContent className="p-4">
        <p className="text-sm font-medium text-foreground leading-snug mb-2">{question}</p>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-xs py-0 h-4">
            {pollType === "singlechoice" ? "Single choice" : "Multiple choice"}
          </Badge>
          <Badge variant="outline" className="text-xs py-0 h-4">
            {optionCount} options
          </Badge>
        </div>

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-muted-foreground">
            {new Date(createdAt * 1000).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={onView}
          >
            <Eye className="h-3 w-3" />
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Create Poll Dialog ────────────────────────────────────────

interface CreatePollDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: PollDraft) => Promise<unknown>;
}

function CreatePollDialog({ open, onClose, onCreate }: CreatePollDialogProps) {
  const [question, setQuestion] = useState("");
  const [pollType, setPollType] = useState<PollType>("singlechoice");
  const [options, setOptions] = useState<PollOption[]>([
    { id: "1", label: "" },
    { id: "2", label: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addOption = () => {
    setOptions([...options, { id: String(options.length + 1), label: "" }]);
  };

  const updateOption = (index: number, label: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], label };
    setOptions(updated);
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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Poll</DialogTitle>
          <DialogDescription>Ask a question and collect responses.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="poll-question" className="text-xs">
              Question
            </Label>
            <Input
              id="poll-question"
              placeholder="What would you like to ask?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Poll type */}
          <div className="space-y-1.5">
            <Label className="text-xs">Response type</Label>
            <RadioGroup
              value={pollType}
              onValueChange={(v) => setPollType(v as PollType)}
              className="flex gap-4"
            >
              <label className="flex items-center gap-1.5 cursor-pointer">
                <RadioGroupItem value="singlechoice" id="single" />
                <span className="text-xs text-foreground">Single choice</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <RadioGroupItem value="multiplechoice" id="multi" />
                <span className="text-xs text-foreground">Multiple choice</span>
              </label>
            </RadioGroup>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <Label className="text-xs">Options</Label>
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5 pr-2">
                {options.map((opt, index) => (
                  <div key={opt.id} className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                      {index + 1}.
                    </span>
                    <Input
                      placeholder={`Option ${index + 1}`}
                      value={opt.label}
                      onChange={(e) => updateOption(index, e.target.value)}
                      className="h-8 text-sm flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      disabled={options.length <= 2}
                      onClick={() => removeOption(index)}
                      aria-label="Remove option"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={addOption}
            >
              <Plus className="h-3 w-3" />
              Add option
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={!isValid}>
            {isSubmitting ? "Creating…" : "Create Poll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Poll Detail Dialog ────────────────────────────────────────

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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug text-base">
            {isLoadingDetail ? "Loading…" : (currentPoll?.content ?? "Poll")}
          </DialogTitle>
          {currentResults && (
            <DialogDescription>
              {totalVotes} response{totalVotes !== 1 ? "s" : ""}
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoadingDetail ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : currentPoll ? (
          <div className="space-y-4">
            {/* Voting options (pre-vote) */}
            {!voted && (
              <div className="space-y-1.5">
                {currentPoll.pollType === "singlechoice" ? (
                  <RadioGroup
                    value={selected[0] ?? ""}
                    onValueChange={(v) => setSelected([v])}
                    className="space-y-1.5"
                  >
                    {currentPoll.options.map((opt) => (
                      <label
                        key={opt.id}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5 cursor-pointer text-sm transition-colors duration-150",
                          selected[0] === opt.id
                            ? "border-primary bg-primary/5 text-foreground"
                            : "hover:bg-muted/50 text-foreground",
                        )}
                      >
                        <RadioGroupItem value={opt.id} id={`opt-${opt.id}`} className="shrink-0" />
                        {opt.label}
                      </label>
                    ))}
                  </RadioGroup>
                ) : (
                  <div className="space-y-1.5">
                    {currentPoll.options.map((opt) => (
                      <label
                        key={opt.id}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5 cursor-pointer text-sm transition-colors duration-150",
                          selected.includes(opt.id)
                            ? "border-primary bg-primary/5 text-foreground"
                            : "hover:bg-muted/50 text-foreground",
                        )}
                      >
                        <Checkbox
                          checked={selected.includes(opt.id)}
                          onCheckedChange={(checked) => {
                            setSelected(
                              checked
                                ? [...selected, opt.id]
                                : selected.filter((id) => id !== opt.id),
                            );
                          }}
                          className="shrink-0"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Results */}
            {currentResults && (
              <div className="space-y-2">
                {voted && (
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                    Your vote was recorded.
                  </p>
                )}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Results
                </p>
                {resultEntries.map(([optionId, result]) => {
                  const option = currentPoll.options.find((o) => o.id === optionId);
                  return (
                    <div key={optionId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground">{option?.label ?? optionId}</span>
                        <span className="text-xs text-muted-foreground font-medium">
                          {result.percentage.toFixed(0)}%
                        </span>
                      </div>
                      <Progress value={result.percentage} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-destructive">Poll not found</p>
        )}

        <DialogFooter>
          {currentPoll && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopyLink}>
              <Link2 className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy link"}
            </Button>
          )}
          {!voted && currentPoll && (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleVote}
              disabled={selected.length === 0 || isLoadingDetail}
            >
              <Vote className="h-3.5 w-3.5" />
              Submit Vote
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
