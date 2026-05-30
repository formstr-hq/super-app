import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";
import { PlusCircle } from "lucide-react";
import { useRef, useState } from "react";

import { moveItem } from "../../lib/array";
import { AnswerType, type FormField, type FormSettings } from "../../services/forms/types";
import { useFormsStore } from "../../stores";

import { FieldEditorRow } from "./FieldEditorRow";
import { FormSettingsSection } from "./FormSettingsSection";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);

export function CreateFormDialog({ open, onClose }: Props) {
  const { createForm } = useFormsStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [encrypt, setEncrypt] = useState(false);
  const [settings, setSettings] = useState<FormSettings>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

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
    setDialogError(null);
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
      setName("");
      setDescription("");
      setFields([]);
      setEncrypt(false);
      setSettings({});
      setDialogError(null);
      onClose();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : "Failed to create form");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && fields.length > 0 && !isSubmitting;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { maxHeight: "85vh" } }}
    >
      <DialogTitle>New Form</DialogTitle>
      <DialogContent
        dividers
        sx={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}
      >
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
          label={<Typography variant="body2">Encrypt form (only you can see responses)</Typography>}
        />

        {/* Questions section */}
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
      </DialogContent>

      {dialogError && (
        <Box sx={{ px: 3, pt: 1 }}>
          <Typography variant="caption" color="error">
            {dialogError}
          </Typography>
        </Box>
      )}

      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleCreate} disabled={!canSubmit}>
          {isSubmitting ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
