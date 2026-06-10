import type { FormSummary } from "@formstr/agent/services/forms/types";
import { encodeNKeys } from "@formstr/core";
import { Box, Button, Snackbar, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { LayoutGrid, LayoutTemplate, List, Plus, SquarePen, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useState } from "react";

import { AIPendingRow } from "../components/ai/AIPendingRow";
import { EmptyState } from "../components/EmptyState";
import { FillFormDialog } from "../components/forms/FillFormDialog";
import { FormBuilderSurface } from "../components/forms/FormBuilderSurface";
import { FormListView } from "../components/forms/FormListView";
import { FormsSidebar, type FormsCategory } from "../components/forms/FormsSidebar";
import { ResponsesDialog } from "../components/forms/ResponsesDialog";
import { MobileRailDrawer } from "../components/MobileRailDrawer";
import { PageHeader } from "../components/PageHeader";
import { copyText } from "../lib/clipboard";
import { useFormsStore, useSettingsStore } from "../stores";
import type { FormsView } from "../stores/settingsStore";

type ActiveDialog = "none" | "create" | "edit" | "fill" | "responses";

const CATEGORY_TITLES: Record<FormsCategory, string> = {
  my: "My Forms",
  shared: "Shared with me",
  drafts: "Drafts",
  templates: "Templates",
};

const EMPTY_STATES: Record<Exclude<FormsCategory, "my">, { Icon: LucideIcon; text: string }> = {
  shared: { Icon: Users, text: "Forms shared with you will appear here." },
  drafts: { Icon: SquarePen, text: "Drafts you save will appear here." },
  templates: { Icon: LayoutTemplate, text: "Reusable form templates will appear here." },
};

export function FormsPage() {
  const {
    myForms,
    currentForm,
    responses,
    isLoading,
    fetchMyForms,
    loadForm,
    loadResponses,
    deleteForm,
    clearCurrent,
  } = useFormsStore();

  const formsView = useSettingsStore((s) => s.formsView);
  const setFormsView = useSettingsStore((s) => s.setFormsView);

  const [category, setCategory] = useState<FormsCategory>("my");
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>("none");
  const [snackbar, setSnackbar] = useState("");

  useEffect(() => {
    void fetchMyForms();
  }, [fetchMyForms]);

  const handleFill = useCallback(
    (form: FormSummary) => {
      void loadForm(form.pubkey, form.id);
      setActiveDialog("fill");
    },
    [loadForm],
  );

  const handleEdit = useCallback(
    (form: FormSummary) => {
      void loadForm(form.pubkey, form.id);
      setActiveDialog("edit");
    },
    [loadForm],
  );

  const handleViewResponses = useCallback(
    (form: FormSummary) => {
      void loadForm(form.pubkey, form.id);
      void loadResponses(form.pubkey, form.id);
      setActiveDialog("responses");
    },
    [loadForm, loadResponses],
  );

  const handleDelete = useCallback(
    (form: FormSummary) => {
      void deleteForm(form.id, form.pubkey);
    },
    [deleteForm],
  );

  const handleCopyLink = useCallback((form: FormSummary) => {
    const naddr = nip19.naddrEncode({
      kind: 30168,
      pubkey: form.pubkey,
      identifier: form.id,
      relays: [],
    });
    const base = `${window.location.origin}/forms/fill/${naddr}`;
    // viewKey goes in the URL fragment (never sent to servers, not in Referer headers)
    const url = form.viewKey ? `${base}#${encodeNKeys({ viewKey: form.viewKey })}` : base;
    void copyText(url).then((ok) => setSnackbar(ok ? "Link copied" : "Copy failed"));
  }, []);

  const handleClose = useCallback(() => {
    setActiveDialog("none");
    clearCurrent();
  }, [clearCurrent]);

  if (activeDialog === "create") {
    return <FormBuilderSurface onClose={handleClose} />;
  }

  if (activeDialog === "edit") {
    return (
      <FormBuilderSurface
        onClose={handleClose}
        editTemplate={currentForm}
        editLoading={isLoading}
      />
    );
  }

  const renderRail = (onNavigate: () => void) => (
    <FormsSidebar
      active={category}
      myCount={myForms.length}
      onSelect={(c) => {
        setCategory(c);
        onNavigate();
      }}
      onNew={() => {
        setActiveDialog("create");
        onNavigate();
      }}
    />
  );

  return (
    <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      {renderRail(() => {})}
      <MobileRailDrawer ariaLabel="Open forms panel">{renderRail}</MobileRailDrawer>

      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <AIPendingRow module="forms" />

        <PageHeader
          title={CATEGORY_TITLES[category]}
          description="Encrypted surveys on Nostr — share a link, collect answers only you can read."
          action={
            <>
              {category === "my" && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={formsView}
                  onChange={(_, v: FormsView | null) => v && setFormsView(v)}
                >
                  <ToggleButton value="grid" aria-label="Grid view">
                    <Tooltip title="Grid view">
                      <LayoutGrid size={16} />
                    </Tooltip>
                  </ToggleButton>
                  <ToggleButton value="list" aria-label="List view">
                    <Tooltip title="List view">
                      <List size={16} />
                    </Tooltip>
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
              <Button
                size="small"
                variant="contained"
                startIcon={<Plus size={14} />}
                onClick={() => setActiveDialog("create")}
              >
                New form
              </Button>
            </>
          }
        />

        {/* Content */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2 }}>
          {category === "my" ? (
            <FormListView
              forms={myForms}
              isLoading={isLoading}
              view={formsView}
              onFill={handleFill}
              onEdit={handleEdit}
              onViewResponses={handleViewResponses}
              onDelete={handleDelete}
              onCopyLink={handleCopyLink}
              onCreateNew={() => setActiveDialog("create")}
            />
          ) : (
            <CategoryEmpty category={category} />
          )}
        </Box>
      </Box>

      <FillFormDialog
        open={activeDialog === "fill"}
        form={currentForm}
        isLoading={isLoading}
        onClose={handleClose}
      />
      <ResponsesDialog
        open={activeDialog === "responses"}
        form={currentForm}
        responses={responses}
        isLoading={isLoading}
        onClose={handleClose}
      />

      <Snackbar
        open={!!snackbar}
        autoHideDuration={2000}
        onClose={() => setSnackbar("")}
        message={snackbar}
      />
    </Box>
  );
}

function CategoryEmpty({ category }: { category: Exclude<FormsCategory, "my"> }) {
  const { Icon, text } = EMPTY_STATES[category];
  return <EmptyState icon={Icon} title={CATEGORY_TITLES[category]} description={text} />;
}
