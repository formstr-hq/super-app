import type { PageCommentType } from "@formstr/agent/services/pages";
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { MessageSquare, Send, X } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useEffect, useState } from "react";

import { usePagesStore } from "../../stores/pagesStore";
import { EmptyState } from "../EmptyState";

function shortAuthor(pubkey: string): string {
  try {
    return `${nip19.npubEncode(pubkey).slice(0, 12)}…`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

function formatWhen(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PageCommentsPanelProps {
  onClose: () => void;
}

/**
 * Kind-1494 comment thread for the open document. Comments ride the doc's
 * viewKey (self-conversation NIP-44), so they exist only for shared docs —
 * personal unshared docs get an explanatory empty state instead.
 */
export function PageCommentsPanel({ onClose }: PageCommentsPanelProps) {
  const currentPage = usePagesStore((s) => s.currentPage);
  const comments = usePagesStore((s) => s.comments);
  const isLoading = usePagesStore((s) => s.isLoadingComments);
  const loadComments = usePagesStore((s) => s.loadComments);
  const addComment = usePagesStore((s) => s.addComment);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const canComment = !!currentPage?.viewKey && !!currentPage?.event?.id;

  useEffect(() => {
    void loadComments();
  }, [currentPage?.address, loadComments]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    const ok = await addComment({ content, type: "comment" as PageCommentType });
    if (ok) setDraft("");
    setSending(false);
  };

  return (
    <Box
      sx={{
        width: { xs: "100%", sm: 320 },
        flexShrink: 0,
        borderLeft: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.75,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <MessageSquare size={15} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </Typography>
        {isLoading && <CircularProgress size={13} />}
        <IconButton size="small" onClick={onClose} aria-label="Close comments">
          <X size={15} />
        </IconButton>
      </Box>

      {/* Thread */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1.75, py: 1.5 }}>
        {!canComment ? (
          <Typography variant="body2" color="text.secondary">
            Comments live on shared documents — share this doc first, then anyone with the link can
            discuss it here and on pages.formstr.app.
          </Typography>
        ) : comments.length === 0 && !isLoading ? (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            description="Anyone with the share link can comment."
            compact
          />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {comments.map((c) => (
              <Box key={c.id}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
                  <Typography variant="caption" fontWeight={600}>
                    {shortAuthor(c.author)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatWhen(c.createdAt)}
                  </Typography>
                  {c.type === "suggestion" && (
                    <Chip label="suggestion" size="small" sx={{ height: 16, fontSize: 10 }} />
                  )}
                </Box>
                {c.quote && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      pl: 1,
                      mb: 0.25,
                      borderLeft: 2,
                      borderColor: "divider",
                      color: "text.secondary",
                      fontStyle: "italic",
                    }}
                  >
                    {c.quote}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {c.content}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Composer */}
      {canComment && (
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: 0.75,
            px: 1.5,
            py: 1.25,
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          <TextField
            size="small"
            fullWidth
            multiline
            maxRows={4}
            placeholder="Add a comment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Tooltip title="Send">
            <span>
              <IconButton
                size="small"
                color="primary"
                disabled={sending || !draft.trim()}
                onClick={() => void handleSend()}
              >
                {sending ? <CircularProgress size={15} /> : <Send size={16} />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}
