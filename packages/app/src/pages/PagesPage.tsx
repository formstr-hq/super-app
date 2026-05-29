import { createRef } from "@formstr/core";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Plus, FileEdit, Trash2, Share2, Edit, Link2, Lock, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { RichEditor } from "../components/pages/RichEditor";
import { PAGES_KINDS, type PageSummary } from "../services/pages/types";
import { usePagesStore } from "../stores";

export function PagesPage() {
  const {
    pages,
    currentPage,
    isLoading,
    error,
    fetchMyPages,
    loadPage,
    savePage,
    deletePage,
    sharePage,
    clearCurrent,
  } = usePagesStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    fetchMyPages();
  }, [fetchMyPages]);

  const handleNewPage = () => {
    clearCurrent();
    setEditorOpen(true);
  };

  const handleCopyLink = async (page: PageSummary) => {
    try {
      const naddr = createRef("pages", PAGES_KINDS.document, page.pubkey, page.id);
      await navigator.clipboard.writeText(naddr);
      setCopiedId(page.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === page.id ? null : cur)), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleEdit = async (page: { pubkey: string; id: string }) => {
    await loadPage(page.pubkey, page.id);
    setEditorOpen(true);
  };

  const handleShare = (address: string) => {
    setShareError(null);
    const result = sharePage(address);
    if (result) {
      setShareUrl(result.url);
      navigator.clipboard.writeText(result.url);
    } else setShareError("Open the page first to enable sharing (viewKey required).");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" fontWeight={600}>
          Pages
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<Plus size={16} />}
          onClick={handleNewPage}
        >
          New Page
        </Button>
      </Box>

      <AIPendingRow module="pages" />

      {error && (
        <Alert severity="error" sx={{ py: 0.5 }}>
          {error}
        </Alert>
      )}
      {shareError && (
        <Alert severity="warning" sx={{ py: 0.5 }}>
          {shareError}
        </Alert>
      )}
      {shareUrl && (
        <Alert severity="success" sx={{ py: 0.5 }} onClose={() => setShareUrl(null)}>
          Link copied to clipboard!
        </Alert>
      )}

      {isLoading ? (
        <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Box
              key={i}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 2,
                py: 1.5,
                borderBottom: i < 4 ? `1px solid ${theme.palette.divider}` : "none",
              }}
            >
              <Skeleton variant="rounded" width={16} height={16} />
              <Skeleton variant="text" sx={{ flex: 1 }} />
              <Skeleton variant="text" width={80} />
            </Box>
          ))}
        </Paper>
      ) : pages.length === 0 ? (
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
            <FileEdit size={28} color={theme.palette.text.secondary} />
          </Box>
          <Typography variant="body2" fontWeight={500}>
            No pages yet
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Create your first page to get started
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Plus size={14} />}
            onClick={handleNewPage}
            sx={{ mt: 0.5 }}
          >
            New Page
          </Button>
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: "hidden" }}>
          {pages.map((page, idx) => (
            <Box
              key={page.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 2,
                py: 1.5,
                borderBottom:
                  idx < pages.length - 1 ? `1px solid ${theme.palette.divider}` : "none",
                "&:hover": { bgcolor: "action.hover" },
                "&:hover .page-actions": { opacity: 1 },
              }}
            >
              <FileEdit size={16} color={theme.palette.text.secondary} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500} noWrap>
                  {page.title}
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    mt: 0.25,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {new Date(page.createdAt * 1000).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Typography>
                  {page.isEncrypted && (
                    <Chip
                      icon={<Lock size={10} />}
                      label="Encrypted"
                      size="small"
                      sx={{ height: 16, fontSize: 10 }}
                    />
                  )}
                  {page.tags?.map((tag) => (
                    <Chip
                      key={tag}
                      icon={<Tag size={10} />}
                      label={tag}
                      size="small"
                      variant="outlined"
                      sx={{ height: 16, fontSize: 10 }}
                    />
                  ))}
                </Box>
              </Box>

              <Box
                className="page-actions"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.25,
                  opacity: 0,
                  transition: "opacity 150ms",
                }}
              >
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => handleEdit(page)}>
                    <Edit size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Share">
                  <IconButton size="small" onClick={() => handleShare(page.address)}>
                    <Share2 size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={copiedId === page.id ? "Copied!" : "Copy cross-app link"}>
                  <IconButton size="small" onClick={() => handleCopyLink(page)}>
                    <Link2 size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton size="small" color="error" onClick={() => deletePage(page.address)}>
                    <Trash2 size={14} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Paper>
      )}

      <PageEditorDialog
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          clearCurrent();
        }}
        onSave={savePage}
        initialContent={currentPage?.content}
        initialTitle={currentPage?.title}
        existingId={currentPage?.id}
        viewKey={currentPage?.viewKey}
      />
    </Box>
  );
}

// ── Page Editor Dialog ────────────────────────────────────

function PageEditorDialog({
  open,
  onClose,
  onSave,
  initialContent,
  initialTitle,
  existingId,
  viewKey,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (params: {
    content: string;
    title?: string;
    existingId?: string;
    viewKey?: string;
  }) => Promise<unknown>;
  initialContent?: string;
  initialTitle?: string;
  existingId?: string;
  viewKey?: string;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [content, setContent] = useState(initialContent ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    setTitle(initialTitle ?? "");
    setContent(initialContent ?? "");
  }, [initialContent, initialTitle]);

  const bodyMarkdown = useMemo(() => stripLeadingTitle(content, title), [content, title]);

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const cleanBody = stripLeadingTitle(content, title);
      await onSave({
        content: title ? `# ${title}\n\n${cleanBody}` : cleanBody,
        title,
        existingId,
        viewKey,
      });
      onClose();
    } catch {
      /* handled by store */
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { height: "85vh", display: "flex", flexDirection: "column" } }}
    >
      <DialogTitle sx={{ borderBottom: `1px solid ${theme.palette.divider}`, py: 1.5 }}>
        <Typography variant="body1" fontWeight={600}>
          {existingId ? "Edit Page" : "New Page"}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Type{" "}
          <Box
            component="kbd"
            sx={{ bgcolor: "action.hover", px: 0.5, borderRadius: 0.5, fontFamily: "monospace" }}
          >
            /
          </Box>{" "}
          for blocks,{" "}
          <Box
            component="kbd"
            sx={{ bgcolor: "action.hover", px: 0.5, borderRadius: 0.5, fontFamily: "monospace" }}
          >
            @
          </Box>{" "}
          to link another entity.
        </Typography>
      </DialogTitle>
      <DialogContent
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          overflowY: "hidden",
          px: 3,
          py: 2,
        }}
      >
        <TextField
          placeholder="Page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          size="small"
          fullWidth
          InputProps={{ sx: { fontSize: 16, fontWeight: 500 } }}
        />
        <Divider />
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            px: 1.5,
            py: 1,
            "&:focus-within": { outline: `2px solid ${theme.palette.primary.main}` },
          }}
        >
          <RichEditor
            key={existingId ?? "new-page"}
            initialMarkdown={bodyMarkdown}
            onChangeMarkdown={setContent}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ borderTop: `1px solid ${theme.palette.divider}`, px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={!title.trim() || isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function stripLeadingTitle(markdown: string, title: string): string {
  const trimmed = markdown.replace(/^\s+/, "");
  const firstLineEnd = trimmed.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? trimmed : trimmed.slice(0, firstLineEnd);
  const h1Match = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (!h1Match) return markdown;
  if (!title || h1Match[1].trim() === title.trim()) {
    return firstLineEnd === -1 ? "" : trimmed.slice(firstLineEnd + 1).replace(/^\s*/, "");
  }
  return markdown;
}
