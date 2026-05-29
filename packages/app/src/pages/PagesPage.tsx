import { createRef } from "@formstr/core";
import { Plus, FileEdit, Trash2, Share2, Edit, Link2, Lock, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { RichEditor } from "../components/pages/RichEditor";
import { PAGES_KINDS, type PageSummary } from "../services/pages/types";
import { usePagesStore } from "../stores";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";



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
    } else {
      setShareError("Open the page first to enable sharing (viewKey required).");
    }
  };

  const handleEditorClose = () => {
    setEditorOpen(false);
    clearCurrent();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Pages</h1>
          <Button size="sm" onClick={handleNewPage} className="gap-1.5 h-8">
            <Plus className="h-3.5 w-3.5" />
            New Page
          </Button>
        </div>

        <AIPendingRow module="pages" />

        {error && <p className="text-sm text-destructive">{error}</p>}
        {shareError && <p className="text-sm text-amber-500">{shareError}</p>}
        {shareUrl && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 px-3 py-2">
            <span className="text-xs text-green-700 dark:text-green-400 flex-1">
              Link copied to clipboard!
            </span>
            <button
              onClick={() => setShareUrl(null)}
              className="text-green-600 dark:text-green-400 hover:opacity-70 transition-opacity"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3 border-b border-border">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <FileEdit className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No pages yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create your first page to get started
              </p>
            </div>
            <Button size="sm" onClick={handleNewPage} className="gap-1.5 mt-1 h-8">
              <Plus className="h-3.5 w-3.5" />
              New Page
            </Button>
          </div>
        ) : (
          /* List view — Notion-style rows */
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {pages.map((page) => (
              <div
                key={page.id}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors duration-150"
              >
                <FileEdit className="h-4 w-4 text-muted-foreground shrink-0" />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{page.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {new Date(page.createdAt * 1000).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    {page.isEncrypted && (
                      <Badge variant="secondary" className="text-xs gap-1 py-0 h-4">
                        <Lock className="h-2.5 w-2.5" />
                        Encrypted
                      </Badge>
                    )}
                    {page.tags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs gap-1 py-0 h-4">
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Actions — shown on hover */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleEdit(page)}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleShare(page.address)}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Share</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleCopyLink(page)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {copiedId === page.id ? "Copied!" : "Copy cross-app link"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deletePage(page.address)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}

        <PageEditorDialog
          open={editorOpen}
          onClose={handleEditorClose}
          onSave={savePage}
          initialContent={currentPage?.content}
          initialTitle={currentPage?.title}
          existingId={currentPage?.id}
          viewKey={currentPage?.viewKey}
        />
      </div>
    </TooltipProvider>
  );
}

// ── Page Editor Dialog ────────────────────────────────────────

interface PageEditorDialogProps {
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
}

function PageEditorDialog({
  open,
  onClose,
  onSave,
  initialContent,
  initialTitle,
  existingId,
  viewKey,
}: PageEditorDialogProps) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [content, setContent] = useState(initialContent ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setTitle(initialTitle ?? "");
    setContent(initialContent ?? "");
  }, [initialContent, initialTitle]);

  // Strip any leading "# title" block that was prepended by a previous save so
  // the rich editor body shows only the body content.
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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
          <DialogTitle className="text-base">{existingId ? "Edit Page" : "New Page"}</DialogTitle>
          <DialogDescription className="text-xs">
            Rich editor with slash commands. Type <kbd className="rounded bg-muted px-1">/</kbd> for
            blocks, <kbd className="rounded bg-muted px-1">@</kbd> to link another entity.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-3 px-6 py-4 min-h-0">
          <div className="space-y-1.5 shrink-0">
            <Label htmlFor="page-title" className="text-xs">
              Title
            </Label>
            <Input
              id="page-title"
              placeholder="Page title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9 text-base font-medium"
            />
          </div>

          <Separator />

          <div className="flex-1 flex flex-col space-y-1.5 min-h-0">
            <Label className="text-xs shrink-0">Content</Label>
            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <RichEditor
                key={existingId ?? "new-page"}
                initialMarkdown={bodyMarkdown}
                onChangeMarkdown={setContent}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!title.trim() || isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Remove a leading `# Title` line from markdown so the editor body doesn't duplicate it. */
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
