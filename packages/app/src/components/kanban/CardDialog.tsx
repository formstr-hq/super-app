import type { CardDraft, KanbanBoard, KanbanCard, KanbanComment } from "@formstr/kanban-sdk";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { npubToHex } from "../../lib/npub";
import { profileName, useProfileName } from "../../lib/profileCache";
import { useKanbanStore } from "../../stores/kanbanStore";

import { AssigneeAvatar } from "./AssigneeAvatar";

interface CardDialogProps {
  open: boolean;
  /** When set, the dialog edits this card instead of creating one. */
  card?: KanbanCard;
  /** Column heading shown in the title, for context when creating. */
  columnName: string;
  /** Labels already in use on this board, offered before anything new is typed. */
  labelOptions?: string[];
  /** The board's roster, as hex pubkeys, offered as assignees. */
  assigneeOptions?: string[];
  /**
   * The board the card lives on. Comments read and write through it — a
   * private board's comments are encrypted under the same view key its cards
   * are — so the comments section only renders when the board is known.
   */
  board?: KanbanBoard;
  /** This device's signer hex pubkey, if signed in; marks own comments. */
  self?: string | null;
  saving: boolean;
  /** Viewers can open a card to read it, but every field and control is off. */
  readOnly?: boolean;
  onClose: () => void;
  onSubmit: (draft: CardDraft) => void;
  /** Offered only to the signer of this version — NIP-09 honours nobody else. */
  onDelete?: () => void;
  /** Offered instead of delete for a card somebody else wrote. */
  onBin?: () => void;
}

/** Trimmed, de-duplicated, blanks dropped. */
function cleanLabels(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** `2m ago` stamps; minute granularity is plenty for board chatter. */
function relativeTime(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Assignees as hex pubkeys, whatever they were typed as.
 *
 * An assignee becomes a `p` tag, and a `p` tag has to be a pubkey — anything
 * that is neither an npub nor 64 hex characters is dropped here rather than
 * published as a tag no client can resolve.
 */
function cleanAssignees(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const hex = npubToHex(value);
    if (hex) seen.add(hex);
  }
  return [...seen];
}

/** A pubkey's display name, live once the kind-0 lands. */
function AssigneeName({ pubkey }: { pubkey: string }) {
  return <>{useProfileName(pubkey)}</>;
}

export function CardDialog({
  open,
  card,
  columnName,
  labelOptions = [],
  assigneeOptions = [],
  board,
  self,
  saving,
  readOnly = false,
  onClose,
  onSubmit,
  onDelete,
  onBin,
}: CardDialogProps) {
  const editing = card !== undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);

  const cardId = card?.id ?? "";
  const comments = useKanbanStore((s) => s.commentsByCard[cardId]);
  const isLoadingComments = useKanbanStore((s) => s.isLoadingComments[cardId]);
  const loadComments = useKanbanStore((s) => s.loadComments);
  const addComment = useKanbanStore((s) => s.addComment);
  const deleteComment = useKanbanStore((s) => s.deleteComment);
  const [commentText, setCommentText] = useState("");
  // Pubkeys inserted via the inline "@" picker below, keyed by the display
  // name typed into the text — so a mention the user then deletes by hand
  // doesn't silently ride along at send time.
  const [insertedMentions, setInsertedMentions] = useState<{ pubkey: string; name: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(card?.title ?? "");
    setDescription(card?.description ?? "");
    setLabels(card?.labels ?? []);
    setAssignees(card?.assignees ?? []);
    // The composer starts clean for every open, even when the same card stays
    // selected — nothing half-typed survives a close.
    setCommentText("");
    setInsertedMentions([]);
    setMentionQuery(null);
    setPosting(false);
  }, [open, card]);

  // Same guard shape as the field reset above: comments belong to the card
  // this dialog is showing, so the read runs on open (and re-runs per card).
  useEffect(() => {
    if (!open || !board || !card) return;
    void loadComments(board, card);
  }, [open, board, card, loadComments]);

  const canSubmit = title.trim().length > 0 && !saving && !readOnly;

  const postComment = async () => {
    const text = commentText.trim();
    if (!text || !board || !card || posting) return;
    // Recomputed from the live text rather than trusted from insertion time:
    // a mention the user backspaced out of the sentence should not ship.
    const mentionedPubkeys = cleanAssignees(
      insertedMentions.filter((m) => commentText.includes(`@${m.name}`)).map((m) => m.pubkey),
    );
    setPosting(true);
    try {
      await addComment(board, card, text, mentionedPubkeys.length ? mentionedPubkeys : undefined);
      setCommentText("");
      setInsertedMentions([]);
      setMentionQuery(null);
      // Refetch after the write, so the list matches what the relays hold.
      await loadComments(board, card);
    } catch {
      // The store surfaced the failure through its error banner; keeping the
      // text means nothing the user typed is lost to a relay hiccup.
    } finally {
      setPosting(false);
    }
  };

  // "@" not preceded by another non-space character, followed by anything
  // that isn't whitespace or another "@", up to the caret — the same shape
  // social apps use so a mid-sentence email address doesn't trigger it.
  const handleCommentChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setCommentText(value);
    const caret = e.target.selectionStart ?? value.length;
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setMentionQuery(match ? { query: match[1], start: caret - match[1].length - 1 } : null);
  };

  const mentionSuggestions = mentionQuery
    ? assigneeOptions
        .filter((pubkey) =>
          profileName(pubkey).toLowerCase().includes(mentionQuery.query.toLowerCase()),
        )
        .slice(0, 5)
    : [];

  const selectMention = (pubkey: string) => {
    if (!mentionQuery) return;
    const name = profileName(pubkey);
    const before = commentText.slice(0, mentionQuery.start);
    const after = commentText.slice(mentionQuery.start + 1 + mentionQuery.query.length);
    const insertion = `@${name} `;
    setCommentText(`${before}${insertion}${after}`);
    setInsertedMentions((prev) => [...prev.filter((m) => m.pubkey !== pubkey), { pubkey, name }]);
    setMentionQuery(null);
    // Picking a suggestion blurs the field (it's a click elsewhere); hand
    // focus back so typing can continue right after the inserted name.
    const caretPos = before.length + insertion.length;
    requestAnimationFrame(() => {
      const el = commentInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  const removeComment = async (comment: KanbanComment) => {
    try {
      await deleteComment(comment);
    } catch {
      // Store surfaced it.
    }
  };

  // Whitespace alone is not a comment.
  const canPost = commentText.trim().length > 0 && !posting && !readOnly;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      labels: cleanLabels(labels),
      assignees: cleanAssignees(assignees),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
        {readOnly ? "Card" : editing ? "Edit card" : `New card in ${columnName}`}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Title"
            size="small"
            fullWidth
            autoFocus={!readOnly}
            disabled={readOnly}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            label="Description"
            size="small"
            fullWidth
            multiline
            minRows={3}
            disabled={readOnly}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {/* freeSolo on both. The board's labels and roster are a shortlist,
              not a whitelist: the first card to carry a label has to be able to
              invent it, and assigning someone not yet invited is legitimate. */}
          <Autocomplete
            multiple
            freeSolo
            disabled={readOnly}
            options={labelOptions}
            value={labels}
            onChange={(_, next) => setLabels(cleanLabels(next))}
            renderTags={(value, getTagProps) =>
              value.map((label, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return <Chip key={key} size="small" label={label} {...tagProps} />;
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Labels"
                size="small"
                placeholder={labels.length === 0 ? "bug, urgent" : ""}
                helperText={readOnly ? " " : "Pick one already used here, or type a new one"}
              />
            )}
          />
          <Autocomplete
            multiple
            freeSolo
            disabled={readOnly}
            options={assigneeOptions}
            value={assignees}
            onChange={(_, next) => setAssignees(cleanAssignees(next))}
            // Options are hex pubkeys; only their rendering is human.
            getOptionLabel={(option) => profileName(option)}
            renderOption={({ key, ...props }, option) => (
              <Box component="li" key={key} {...props} sx={{ gap: 1 }}>
                <AssigneeAvatar pubkey={option} size={20} />
                <AssigneeName pubkey={option} />
              </Box>
            )}
            renderTags={(value, getTagProps) =>
              value.map((pubkey, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    size="small"
                    // Inside the label rather than Chip's `avatar` slot, which
                    // clones the child and restyles it as a round MUI Avatar.
                    label={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.625 }}>
                        <AssigneeAvatar pubkey={pubkey} size={16} />
                        <AssigneeName pubkey={pubkey} />
                      </Box>
                    }
                    {...tagProps}
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Assignees"
                size="small"
                placeholder={assignees.length === 0 ? "Board members" : ""}
                helperText={readOnly ? " " : "Someone on this board, or paste an npub"}
              />
            )}
          />
          {board && card && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Comments
              </Typography>
              {isLoadingComments && comments === undefined ? (
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              ) : (comments ?? []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No comments yet
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {(comments ?? []).map((comment) => {
                    const own = comment.authorPubkey === self;
                    return (
                      <Box
                        key={comment.id}
                        sx={{
                          // Own comments sit on the right with a filled
                          // background; everyone else's read like replies do.
                          alignSelf: own ? "flex-end" : "flex-start",
                          maxWidth: "92%",
                          bgcolor: own ? "action.selected" : "background.paper",
                          border: 1,
                          borderColor: "divider",
                          borderRadius: 1,
                          px: 1.25,
                          py: 0.75,
                        }}
                      >
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25 }}>
                          <AssigneeAvatar pubkey={comment.authorPubkey} size={16} />
                          <Typography variant="caption" sx={{ fontWeight: own ? 600 : 500 }}>
                            {own ? "You" : <AssigneeName pubkey={comment.authorPubkey} />}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {relativeTime(comment.createdAt)}
                          </Typography>
                          {/* A comment's author is the only identity kind-32304
                              deletion honours, so the affordance is own-only. */}
                          {own && !readOnly && (
                            <Tooltip describeChild title="Delete comment">
                              <IconButton
                                size="small"
                                sx={{ ml: "auto", p: 0.25 }}
                                onClick={() => void removeComment(comment)}
                              >
                                <Trash2 size={12} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          {comment.content}
                        </Typography>
                        {comment.mentions.length > 0 && (
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                            {comment.mentions.map((pubkey) => (
                              <Chip
                                key={pubkey}
                                size="small"
                                color="primary"
                                variant="outlined"
                                sx={{ height: 20 }}
                                label={
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                    <AssigneeAvatar pubkey={pubkey} size={12} />
                                    <Typography variant="caption">
                                      @<AssigneeName pubkey={pubkey} />
                                    </Typography>
                                  </Box>
                                }
                              />
                            ))}
                          </Stack>
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              )}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                <TextField
                  label="Comment"
                  size="small"
                  fullWidth
                  multiline
                  maxRows={4}
                  disabled={readOnly || posting}
                  value={commentText}
                  onChange={handleCommentChange}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && mentionQuery) setMentionQuery(null);
                  }}
                  inputRef={commentInputRef}
                  helperText={
                    readOnly
                      ? " "
                      : 'Encrypted for this board\'s members. Type "@" to mention someone.'
                  }
                />
                <Button
                  size="small"
                  variant="contained"
                  endIcon={<Send size={14} />}
                  disabled={!canPost}
                  onClick={() => void postComment()}
                >
                  {posting ? "Sending…" : "Send"}
                </Button>
              </Stack>
              {!readOnly && mentionQuery && mentionSuggestions.length > 0 && (
                <Paper variant="outlined" sx={{ mt: 0.5, maxHeight: 160, overflowY: "auto" }}>
                  <List dense disablePadding>
                    {mentionSuggestions.map((pubkey) => (
                      <ListItemButton
                        key={pubkey}
                        // Prevented on mousedown rather than left to click: a
                        // default mousedown blurs the textfield first, which
                        // would otherwise clear mentionQuery before the click
                        // that should act on it ever fires.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectMention(pubkey)}
                        sx={{ gap: 1 }}
                      >
                        <AssigneeAvatar pubkey={pubkey} size={20} />
                        <AssigneeName pubkey={pubkey} />
                      </ListItemButton>
                    ))}
                  </List>
                </Paper>
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {/* describeChild on both: the buttons already say what they do, so each
            tooltip is a description. Without it MUI turns the title into the
            button's accessible name. */}
        {editing && onDelete && (
          <Tooltip describeChild title="Publishes a NIP-09 deletion for the version you signed">
            <Button size="small" color="error" onClick={onDelete} sx={{ mr: "auto" }}>
              Delete
            </Button>
          </Tooltip>
        )}
        {editing && !onDelete && onBin && (
          <Tooltip
            describeChild
            title="Hides the card for everyone. Only its author can delete it outright."
          >
            <Button size="small" color="error" onClick={onBin} sx={{ mr: "auto" }}>
              Bin
            </Button>
          </Tooltip>
        )}
        <Button size="small" onClick={onClose}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button size="small" variant="contained" disabled={!canSubmit} onClick={submit}>
            {saving ? "Saving…" : editing ? "Save" : "Add card"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
