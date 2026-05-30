import { encodeNKeys } from "@formstr/core";
import {
  Box,
  Button,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { LayoutGrid, List, Plus } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useCallback, useEffect, useState } from "react";

import { CreateFormDialog } from "../components/forms/CreateFormDialog";
import { FillFormDialog } from "../components/forms/FillFormDialog";
import { FormListView } from "../components/forms/FormListView";
import { ResponsesDialog } from "../components/forms/ResponsesDialog";
import type { FormSummary } from "../services/forms/types";
import { useFormsStore, useSettingsStore } from "../stores";
import type { FormsView } from "../stores/settingsStore";

type ActiveDialog = "none" | "create" | "fill" | "responses";

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
    navigator.clipboard.writeText(url).catch(() => {});
    setSnackbar("Link copied");
  }, []);

  const handleClose = useCallback(() => {
    setActiveDialog("none");
    clearCurrent();
  }, [clearCurrent]);

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>
          Forms
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
          <Button
            variant="contained"
            size="small"
            startIcon={<Plus size={16} />}
            onClick={() => setActiveDialog("create")}
          >
            New Form
          </Button>
        </Box>
      </Box>

      <FormListView
        forms={myForms}
        isLoading={isLoading}
        view={formsView}
        onFill={handleFill}
        onViewResponses={handleViewResponses}
        onDelete={handleDelete}
        onCopyLink={handleCopyLink}
        onCreateNew={() => setActiveDialog("create")}
      />

      <CreateFormDialog open={activeDialog === "create"} onClose={handleClose} />
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
