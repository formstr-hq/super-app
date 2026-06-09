import { AnswerType, type FormField, type FormSettings } from "@formstr/agent/services/forms/types";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ArrowLeft, PlusCircle, Send } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

import { moveItem } from "../../lib/array";
import { useFormsStore } from "../../stores";

import { FieldEditorRow } from "./FieldEditorRow";
import { FieldInput } from "./FieldInput";
import { FormSettingsSection } from "./FormSettingsSection";

interface Props {
  onClose: () => void;
}

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);

function PaneLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="span"
      sx={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "text.secondary",
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * Full-bleed form builder: a "Build" editor pane on the left and a live "Preview"
 * pane on the right that renders the form exactly as a responder would see it.
 * Replaces the old cramped create-form modal.
 */
export function FormBuilderSurface({ onClose }: Props) {
  const { createForm } = useFormsStore();
  const theme = useTheme();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [encrypt, setEncrypt] = useState(false);
  const [settings, setSettings] = useState<FormSettings>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchSettings = (patch: Partial<FormSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const addField = () => {
    setFields([
      ...fields,
      {
        id: crypto.randomUUID().slice(0, 8),
        type: AnswerType.shortText,
        label: "",
        required: false,
        options: [],
      },
    ]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    if (updates.type && CHOICE_TYPES.has(updates.type) && !updated[index].options?.length) {
      updated[index].options = [
        { id: crypto.randomUUID().slice(0, 6), label: "Option 1" },
        { id: crypto.randomUUID().slice(0, 6), label: "Option 2" },
      ];
    }
    setFields(updated);
  };

  const removeField = (index: number) => setFields(fields.filter((_, i) => i !== index));

  const dragIndex = useRef<number | null>(null);
  const handleDragStart = (index: number) => {
    dragIndex.current = index;
  };
  const handleDrop = (index: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === index) return;
    setFields((prev) => moveItem(prev, from, index));
  };

  const addOption = (fieldIndex: number) => {
    const updated = [...fields];
    const opts = [...(updated[fieldIndex].options ?? [])];
    opts.push({ id: crypto.randomUUID().slice(0, 6), label: `Option ${opts.length + 1}` });
    updated[fieldIndex] = { ...updated[fieldIndex], options: opts };
    setFields(updated);
  };

  const updateOption = (fieldIndex: number, optIndex: number, label: string) => {
    const updated = [...fields];
    const opts = [...(updated[fieldIndex].options ?? [])];
    opts[optIndex] = { ...opts[optIndex], label };
    updated[fieldIndex] = { ...updated[fieldIndex], options: opts };
    setFields(updated);
  };

  const removeOption = (fieldIndex: number, optIndex: number) => {
    const updated = [...fields];
    const opts = (updated[fieldIndex].options ?? []).filter((_, i) => i !== optIndex);
    updated[fieldIndex] = { ...updated[fieldIndex], options: opts };
    setFields(updated);
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await createForm({
        name,
        fields,
        settings: {
          publicForm: !encrypt,
          description: description || undefined,
          ...settings,
        },
        encrypt,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create form");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && fields.length > 0 && !isSubmitting;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* Top bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.25,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Tooltip title="Back">
          <IconButton size="small" aria-label="Back" onClick={onClose} disabled={isSubmitting}>
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          New form
        </Typography>
        {error && (
          <Typography variant="caption" color="error" sx={{ mr: 1 }}>
            {error}
          </Typography>
        )}
        <Button size="small" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={handleCreate} disabled={!canSubmit}>
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </Box>

      {/* Two panes */}
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          flex: 1,
          minHeight: 0,
          overflowY: { xs: "auto", md: "hidden" },
        }}
      >
        {/* Build pane */}
        <Box
          sx={{
            flex: 1.05,
            minWidth: 0,
            borderRight: { md: `1px solid ${theme.palette.divider}` },
            borderBottom: { xs: `1px solid ${theme.palette.divider}`, md: "none" },
            overflowY: { md: "auto" },
            p: { xs: 2, md: 3 },
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <PaneLabel>Build</PaneLabel>

          <TextField
            label="Form title"
            placeholder="Untitled form"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Description (optional)"
            placeholder="Describe your form…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={2}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={encrypt}
                onChange={(e) => setEncrypt(e.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">Encrypt form (only you can see responses)</Typography>
            }
          />

          {/* Questions */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <Typography variant="body2" fontWeight={500}>
                Questions
              </Typography>
              <Divider sx={{ flex: 1 }} />
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {fields.map((field, index) => (
                <FieldEditorRow
                  key={field.id}
                  field={field}
                  index={index}
                  onUpdate={updateField}
                  onRemove={removeField}
                  onAddOption={addOption}
                  onUpdateOption={updateOption}
                  onRemoveOption={removeOption}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                />
              ))}
            </Box>

            <Button
              size="small"
              variant="text"
              startIcon={<PlusCircle size={14} />}
              onClick={addField}
              sx={{ mt: 1, color: "text.secondary" }}
            >
              Add question
            </Button>
          </Box>

          <FormSettingsSection settings={settings} onChange={patchSettings} />
        </Box>

        {/* Preview pane */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            overflowY: { md: "auto" },
            p: { xs: 2, md: 3 },
            bgcolor: theme.palette.mode === "dark" ? "background.default" : "grey.50",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <PaneLabel>Live preview</PaneLabel>

          <Box
            sx={{
              bgcolor: "background.paper",
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              p: { xs: 2, md: 3 },
              display: "flex",
              flexDirection: "column",
              gap: 2.5,
            }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {name || "Untitled form"}
              </Typography>
              {description && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {description}
                </Typography>
              )}
            </Box>

            {fields.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Add questions to see a live preview.
              </Typography>
            ) : (
              <>
                {fields.map((field) => (
                  <FieldInput key={field.id} field={field} value="" onChange={() => {}} disabled />
                ))}
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button variant="contained" disabled startIcon={<Send size={14} />}>
                    Submit
                  </Button>
                </Box>
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
