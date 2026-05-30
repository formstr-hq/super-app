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
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { GripVertical, PlusCircle, Trash2, X } from "lucide-react";
import { useState } from "react";

import { AnswerType, type FormField } from "../../services/forms/types";
import { useFormsStore } from "../../stores";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

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
        settings: { publicForm: !encrypt, description: description || undefined },
        encrypt,
      });
      setName("");
      setDescription("");
      setFields([]);
      setEncrypt(false);
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
              <Paper key={field.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <GripVertical size={14} color="var(--mui-palette-text-disabled)" />
                  <TextField
                    placeholder="Question…"
                    value={field.label}
                    onChange={(e) => updateField(index, { label: e.target.value })}
                    size="small"
                    sx={{ flex: 1 }}
                  />
                  <Select
                    value={field.type}
                    onChange={(e) => updateField(index, { type: e.target.value as AnswerType })}
                    size="small"
                    sx={{ width: 150 }}
                  >
                    <MenuItem value={AnswerType.shortText}>Short answer</MenuItem>
                    <MenuItem value={AnswerType.paragraph}>Paragraph</MenuItem>
                    <MenuItem value={AnswerType.radioButton}>Multiple choice</MenuItem>
                    <MenuItem value={AnswerType.checkboxes}>Checkboxes</MenuItem>
                    <MenuItem value={AnswerType.dropdown}>Dropdown</MenuItem>
                    <MenuItem value={AnswerType.number}>Number</MenuItem>
                    <MenuItem value={AnswerType.date}>Date</MenuItem>
                    <MenuItem value={AnswerType.time}>Time</MenuItem>
                    <MenuItem value={AnswerType.datetime}>Date &amp; time</MenuItem>
                    <MenuItem value={AnswerType.label}>Label</MenuItem>
                    <MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>
                    <MenuItem value={AnswerType.signature}>Signature</MenuItem>
                  </Select>
                  <Tooltip title={field.required ? "Mark optional" : "Mark required"}>
                    <Box
                      component="button"
                      onClick={() => updateField(index, { required: !field.required })}
                      sx={{
                        fontSize: 11,
                        px: 1,
                        py: 0.25,
                        borderRadius: 1,
                        border: "1px solid",
                        cursor: "pointer",
                        bgcolor: field.required ? "primary.main" : "transparent",
                        color: field.required ? "primary.contrastText" : "text.secondary",
                        borderColor: field.required ? "primary.main" : "divider",
                      }}
                    >
                      Req
                    </Box>
                  </Tooltip>
                  <Tooltip title="Remove field">
                    <IconButton size="small" color="error" onClick={() => removeField(index)}>
                      <Trash2 size={13} />
                    </IconButton>
                  </Tooltip>
                </Box>

                {CHOICE_TYPES.has(field.type) && (
                  <Box sx={{ pl: 3.5, mt: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
                    {(field.options ?? []).map((opt, oi) => (
                      <Box key={opt.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ width: 16, textAlign: "right" }}
                        >
                          {oi + 1}.
                        </Typography>
                        <TextField
                          size="small"
                          value={opt.label}
                          onChange={(e) => updateOption(index, oi, e.target.value)}
                          placeholder={`Option ${oi + 1}`}
                          sx={{ flex: 1, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
                        />
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => removeOption(index, oi)}
                        >
                          <X size={12} />
                        </IconButton>
                      </Box>
                    ))}
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<PlusCircle size={13} />}
                      onClick={() => addOption(index)}
                      sx={{ alignSelf: "flex-start", fontSize: 12, color: "text.secondary" }}
                    >
                      Add option
                    </Button>
                  </Box>
                )}
              </Paper>
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
