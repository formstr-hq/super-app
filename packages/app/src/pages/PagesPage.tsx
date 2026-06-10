import type { PageDocument, PageSummary } from "@formstr/agent/services/pages";
import { Alert, Box, Snackbar } from "@mui/material";
import { FileEdit } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { EmptyState } from "../components/EmptyState";
import { MobileRailDrawer } from "../components/MobileRailDrawer";
import { PageEditorSurface } from "../components/pages/PageEditorSurface";
import { PagesSidebar } from "../components/pages/PagesSidebar";
import { PageTagsPopover } from "../components/pages/PageTagsPopover";
import { SharePageDialog } from "../components/pages/SharePageDialog";
import { useAuthStore, usePagesStore } from "../stores";

export function PagesPage() {
  const {
    pages,
    sharedPages,
    currentPage,
    tagsByAddress,
    activeTag,
    error,
    fetchMyPages,
    fetchSharedPages,
    loadPage,
    savePage,
    deletePage,
    sharePage,
    setTags,
    setActiveTag,
    clearCurrent,
    openSharedLink,
  } = usePagesStore();
  const pubkey = useAuthStore((s) => s.pubkey);
  const { "*": splat } = useParams();
  const { hash } = useLocation();

  const [mode, setMode] = useState<"empty" | "new" | "open">("empty");
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tagsAnchor, setTagsAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (pubkey) {
      fetchMyPages();
      fetchSharedPages();
    }
  }, [pubkey, fetchMyPages, fetchSharedPages]);

  // Share link: /pages/<naddr>#<nkeys> (also accepts upstream's /doc/<naddr> splat).
  useEffect(() => {
    const naddr = splat?.split("/").find((s) => s.startsWith("naddr1"));
    if (naddr) {
      setMode("open");
      void openSharedLink(naddr, hash);
    }
  }, [splat, hash, openSharedLink]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(tagsByAddress)) for (const t of list) set.add(t);
    return [...set].sort();
  }, [tagsByAddress]);

  const visiblePages = useMemo(
    () =>
      activeTag
        ? pages.filter((p) => (p.tags ?? tagsByAddress[p.address])?.includes(activeTag))
        : pages,
    [pages, activeTag, tagsByAddress],
  );

  const openPage = async (page: PageSummary) => {
    setMode("open");
    await loadPage(page.pubkey, page.id, page.viewKey);
  };

  const handleNew = () => {
    clearCurrent();
    setMode("new");
  };

  const handleSave = async (content: string) => {
    setSaving(true);
    try {
      const existing = mode === "open" ? currentPage : null;
      const saved: PageDocument = await savePage({
        content,
        existingId: existing?.id,
        viewKey: existing?.viewKey,
        editKey: existing?.editKey,
      });
      setMode("open");
      setToast("Saved");
      void saved;
    } catch {
      /* surfaced via store error */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentPage) return;
    await deletePage(currentPage.address);
    setMode("empty");
  };

  const editorPage = mode === "new" ? null : currentPage;
  const showEditor = mode !== "empty";
  // A shared doc opened with only a viewKey (someone else's, no editKey) is read-only.
  const readOnly = !!currentPage && currentPage.pubkey !== pubkey && !currentPage.editKey;

  const renderRail = (onNavigate: () => void) => (
    <PagesSidebar
      pages={visiblePages}
      sharedPages={sharedPages}
      selectedAddress={currentPage?.address}
      allTags={allTags}
      activeTag={activeTag}
      onSelect={(p) => {
        openPage(p);
        onNavigate();
      }}
      onNew={() => {
        handleNew();
        onNavigate();
      }}
      onToggleTag={setActiveTag}
    />
  );

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      {renderRail(() => {})}
      <MobileRailDrawer ariaLabel="Open pages list">{renderRail}</MobileRailDrawer>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <AIPendingRow module="pages" />
        {error && (
          <Alert severity="error" sx={{ m: 2, mb: 0, py: 0.5 }}>
            {error}
          </Alert>
        )}

        {showEditor ? (
          <PageEditorSurface
            page={editorPage}
            tags={editorPage ? tagsByAddress[editorPage.address] : undefined}
            readOnly={readOnly}
            saving={saving}
            onSave={handleSave}
            onShare={() => setShareOpen(true)}
            onDelete={handleDelete}
            onOpenTags={setTagsAnchor}
          />
        ) : (
          <EmptyState
            icon={FileEdit}
            title="No page open"
            description="Encrypted Markdown docs with shareable view or edit links and inline comments."
            actionLabel="New page"
            onAction={handleNew}
            aiHint="or ask the AI to write one"
          />
        )}
      </Box>

      <SharePageDialog open={shareOpen} onClose={() => setShareOpen(false)} onShare={sharePage} />
      {currentPage && (
        <PageTagsPopover
          anchorEl={tagsAnchor}
          tags={tagsByAddress[currentPage.address] ?? []}
          onClose={() => setTagsAnchor(null)}
          onChange={(t) => setTags(currentPage.address, t)}
        />
      )}
      <Snackbar
        open={!!toast}
        autoHideDuration={1500}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
