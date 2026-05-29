import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid2 as MuiGrid,
  IconButton,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  BarChart3,
  Check,
  FileText,
  GripVertical,
  Grid,
  List,
  Lock,
  Plus,
  PlusCircle,
  Send,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";

import {
  AnswerType,
  type FormField,
  type FormTemplate,
  type FormResponse,
  type FormResponseEvent,
  type FormSummary,
} from "../services/forms";
import * as formsService from "../services/forms/service";
import { useFormsStore } from "../stores";

// ── Answer type label map ────────────────────────────────

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);

// ── Skeleton rows ────────────────────────────────────────

function FormRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton variant="text" width="60%" />
      </TableCell>
      <TableCell>
        <Skeleton variant="text" width={80} />
      </TableCell>
      <TableCell>
        <Skeleton variant="rounded" width={70} height={22} />
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

function FormCardSkeleton() {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
      <Skeleton variant="text" width="70%" />
      <Skeleton variant="text" width="40%" sx={{ mt: 0.5 }} />
      <Skeleton variant="rounded" width={70} height={22} sx={{ mt: 1 }} />
    </Paper>
  );
}

// ── Main page ────────────────────────────────────────────

type ActiveDialog = "none" | "create" | "fill" | "responses";
type ViewMode = "list" | "grid";

export function FormsPage() {
  const {
    myForms,
    currentForm,
    responses,
    isLoading,
    error,
    fetchMyForms,
    createForm,
    deleteForm,
    loadForm,
    loadResponses,
    clearCurrent,
  } = useFormsStore();

  const [activeDialog, setActiveDialog] = useState<ActiveDialog>("none");
  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const theme = useTheme();

  useEffect(() => {
    fetchMyForms();
  }, [fetchMyForms]);

  const handleOpenFill = useCallback(
    (form: FormSummary) => {
      setSelectedForm(form);
      loadForm(form.pubkey, form.id);
      setActiveDialog("fill");
    },
    [loadForm],
  );

  const handleOpenResponses = useCallback(
    (form: FormSummary) => {
      setSelectedForm(form);
      loadForm(form.pubkey, form.id);
      loadResponses(form.pubkey, form.id);
      setActiveDialog("responses");
    },
    [loadForm, loadResponses],
  );

  const handleClose = useCallback(() => {
    setActiveDialog("none");
    setSelectedForm(null);
    clearCurrent();
  }, [clearCurrent]);

  return (
    <Box>
      {/* Top bar */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Forms
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="list" aria-label="list view">
              <List size={16} />
            </ToggleButton>
            <ToggleButton value="grid" aria-label="grid view">
              <Grid size={16} />
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

      {/* Error */}
      {error && (
        <Typography variant="body2" color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {/* Loading */}
      {isLoading && myForms.length === 0 ? (
        viewMode === "list" ? (
          <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <FormRowSkeleton key={i} />
                ))}
              </TableBody>
            </Table>
          </Paper>
        ) : (
          <MuiGrid container spacing={1.5}>
            {Array.from({ length: 6 }).map((_, i) => (
              <MuiGrid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
                <FormCardSkeleton />
              </MuiGrid>
            ))}
          </MuiGrid>
        )
      ) : myForms.length === 0 ? (
        /* Empty state */
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 10,
            gap: 1.5,
            textAlign: "center",
          }}
        >
          <FileText size={48} color={theme.palette.text.secondary} />
          <Typography variant="body2" fontWeight={500}>
            No forms yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create your first form to get started
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Plus size={16} />}
            onClick={() => setActiveDialog("create")}
            sx={{ mt: 0.5 }}
          >
            New Form
          </Button>
        </Box>
      ) : viewMode === "list" ? (
        /* List view */
        <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 600, fontSize: 12, color: "text.secondary" } }}>
                <TableCell>Name</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {myForms.map((form) => (
                <TableRow
                  key={`${form.pubkey}:${form.id}`}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => handleOpenFill(form)}
                >
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <FileText size={14} color={theme.palette.text.secondary} />
                      <Typography variant="body2" fontWeight={500}>
                        {form.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(form.createdAt * 1000).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {form.isEncrypted ? (
                      <Chip icon={<Lock size={11} />} label="Encrypted" size="small" />
                    ) : (
                      <Chip
                        icon={<Unlock size={11} />}
                        label="Public"
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
                      <Tooltip title="Fill form">
                        <IconButton size="small" onClick={() => handleOpenFill(form)}>
                          <FileText size={14} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Responses">
                        <IconButton size="small" onClick={() => handleOpenResponses(form)}>
                          <BarChart3 size={14} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => deleteForm(form.id, form.pubkey)}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      ) : (
        /* Grid view */
        <MuiGrid container spacing={1.5}>
          {myForms.map((form) => (
            <MuiGrid key={`${form.pubkey}:${form.id}`} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 1.5,
                  cursor: "pointer",
                  transition: "box-shadow 150ms",
                  "&:hover": { boxShadow: 2 },
                }}
                onClick={() => handleOpenFill(form)}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                  <FileText size={14} color={theme.palette.text.secondary} />
                  <Typography variant="body2" fontWeight={500} noWrap>
                    {form.name}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 0.5 }}
                >
                  {new Date(form.createdAt * 1000).toLocaleDateString()}
                </Typography>
                {form.isEncrypted ? (
                  <Chip icon={<Lock size={11} />} label="Encrypted" size="small" sx={{ mt: 1 }} />
                ) : (
                  <Chip
                    icon={<Unlock size={11} />}
                    label="Public"
                    size="small"
                    variant="outlined"
                    sx={{ mt: 1 }}
                  />
                )}
                <Box
                  sx={{
                    mt: 1.5,
                    pt: 1.5,
                    borderTop: `1px solid ${theme.palette.divider}`,
                    display: "flex",
                    gap: 0.5,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip title="Fill form">
                    <IconButton size="small" onClick={() => handleOpenFill(form)}>
                      <FileText size={13} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Responses">
                    <IconButton size="small" onClick={() => handleOpenResponses(form)}>
                      <BarChart3 size={13} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => deleteForm(form.id, form.pubkey)}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Paper>
            </MuiGrid>
          ))}
        </MuiGrid>
      )}

      {/* Dialogs */}
      <CreateFormDialog
        open={activeDialog === "create"}
        onClose={handleClose}
        onCreate={createForm}
      />

      <FormFillerDialog
        open={activeDialog === "fill"}
        form={currentForm}
        formSummary={selectedForm}
        isLoading={isLoading}
        onClose={handleClose}
      />

      <ResponsesDialog
        open={activeDialog === "responses"}
        form={currentForm}
        formSummary={selectedForm}
        responses={responses}
        isLoading={isLoading}
        onClose={handleClose}
      />
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════
// Create Form Dialog
// ═══════════════════════════════════════════════════════════

interface CreateFormDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (params: {
    name: string;
    fields: FormField[];
    settings?: { publicForm?: boolean; description?: string };
    encrypt?: boolean;
  }) => Promise<unknown>;
}

function CreateFormDialog({ open, onClose, onCreate }: CreateFormDialogProps) {
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
      await onCreate({
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
                    <MenuItem value={AnswerType.datetime}>Date & time</MenuItem>
                    <MenuItem value={AnswerType.label}>Label</MenuItem>
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

// ═══════════════════════════════════════════════════════════
// Form Filler Dialog
// ═══════════════════════════════════════════════════════════

function FormFillerDialog({
  open,
  form,
  formSummary,
  isLoading,
  onClose,
}: {
  open: boolean;
  form: FormTemplate | null;
  formSummary: FormSummary | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checkAnswers, setCheckAnswers] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (form) {
      setAnswers({});
      setCheckAnswers({});
      setSubmitted(false);
      setSubmitError(null);
    }
  }, [form?.id]);

  const setAnswer = (fieldId: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));

  const toggleCheck = (fieldId: string, optionId: string) => {
    setCheckAnswers((prev) => {
      const set = new Set(prev[fieldId] ?? []);
      if (set.has(optionId)) set.delete(optionId);
      else set.add(optionId);
      return { ...prev, [fieldId]: set };
    });
  };

  const handleSubmit = async () => {
    if (!form || !formSummary) return;
    const missing = form.fields.filter((f) => {
      if (!f.required) return false;
      if (f.type === AnswerType.checkboxes) return !checkAnswers[f.id]?.size;
      return !answers[f.id]?.trim();
    });
    if (missing.length > 0) {
      setSubmitError(`Please fill required fields: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const responses: FormResponse[] = form.fields
        .filter((f) => f.type !== AnswerType.label)
        .map((f) => {
          let answer = answers[f.id] ?? "";
          if (f.type === AnswerType.checkboxes) {
            answer = JSON.stringify(Array.from(checkAnswers[f.id] ?? []));
          }
          return { fieldId: f.id, answer };
        });
      await formsService.submitResponse(
        formSummary.pubkey,
        formSummary.id,
        responses,
        formSummary.isEncrypted,
      );
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { maxHeight: "85vh" } }}
    >
      <DialogTitle>{form?.name ?? formSummary?.name ?? "Loading…"}</DialogTitle>
      {form?.settings.description && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {form.settings.description}
          </Typography>
        </Box>
      )}
      <DialogContent dividers sx={{ overflowY: "auto" }}>
        {isLoading || !form ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Skeleton variant="text" />
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="65%" />
          </Box>
        ) : submitted ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              py: 6,
              gap: 1.5,
              textAlign: "center",
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                bgcolor: "primary.main",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Check size={24} color="var(--mui-palette-primary-contrastText)" />
            </Box>
            <Typography fontWeight={500}>Response submitted!</Typography>
            <Typography variant="body2" color="text.secondary">
              Thank you for filling out this form.
            </Typography>
            <Button variant="outlined" size="small" onClick={onClose} sx={{ mt: 1 }}>
              Close
            </Button>
          </Box>
        ) : form.fields.length === 0 ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {form.isEncrypted
                ? "This form is encrypted and cannot be decrypted with your key."
                : "This form has no fields."}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
            {form.fields.map((field) => (
              <FieldRenderer
                key={field.id}
                field={field}
                value={answers[field.id] ?? ""}
                checkedValues={checkAnswers[field.id]}
                onChange={(v) => setAnswer(field.id, v)}
                onToggleCheck={(optId) => toggleCheck(field.id, optId)}
              />
            ))}
          </Box>
        )}
      </DialogContent>

      {submitError && (
        <Box sx={{ px: 3, pt: 1 }}>
          <Typography variant="caption" color="error">
            {submitError}
          </Typography>
        </Box>
      )}

      {!submitted && form && form.fields.length > 0 && (
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
            startIcon={
              submitting ? <CircularProgress size={14} color="inherit" /> : <Send size={14} />
            }
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

// ── Field renderer ───────────────────────────────────────

function FieldRenderer({
  field,
  value,
  checkedValues,
  onChange,
  onToggleCheck,
}: {
  field: FormField;
  value: string;
  checkedValues?: Set<string>;
  onChange: (value: string) => void;
  onToggleCheck: (optionId: string) => void;
}) {
  const label = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
      <Typography variant="body2" fontWeight={500}>
        {field.label || "Untitled"}
      </Typography>
      {field.required && (
        <Typography variant="caption" color="error">
          *
        </Typography>
      )}
    </Box>
  );

  switch (field.type) {
    case AnswerType.shortText:
    case AnswerType.number:
    case AnswerType.date:
    case AnswerType.time:
    case AnswerType.datetime:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            type={
              field.type === AnswerType.number
                ? "number"
                : field.type === AnswerType.date
                  ? "date"
                  : field.type === AnswerType.time
                    ? "time"
                    : field.type === AnswerType.datetime
                      ? "datetime-local"
                      : "text"
            }
            placeholder={field.placeholder || "Your answer"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      );

    case AnswerType.paragraph:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            multiline
            rows={3}
            placeholder={field.placeholder || "Your answer"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      );

    case AnswerType.radioButton:
      return (
        <Box>
          {label}
          <RadioGroup value={value} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((opt) => (
              <FormControlLabel
                key={opt.id}
                value={opt.id}
                control={<Radio size="small" />}
                label={<Typography variant="body2">{opt.label}</Typography>}
              />
            ))}
          </RadioGroup>
        </Box>
      );

    case AnswerType.checkboxes:
      return (
        <Box>
          {label}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {(field.options ?? []).map((opt) => (
              <FormControlLabel
                key={opt.id}
                control={
                  <Checkbox
                    size="small"
                    checked={checkedValues?.has(opt.id) ?? false}
                    onChange={() => onToggleCheck(opt.id)}
                  />
                }
                label={<Typography variant="body2">{opt.label}</Typography>}
              />
            ))}
          </Box>
        </Box>
      );

    case AnswerType.dropdown:
      return (
        <Box>
          {label}
          <FormControl size="small" fullWidth>
            <Select value={value} onChange={(e) => onChange(e.target.value)} displayEmpty>
              <MenuItem value="">
                <em>Select an option</em>
              </MenuItem>
              {(field.options ?? []).map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      );

    case AnswerType.label:
      return (
        <Typography variant="body2" sx={{ py: 0.5, color: "text.secondary", fontStyle: "italic" }}>
          {field.label}
        </Typography>
      );

    default:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      );
  }
}

// ═══════════════════════════════════════════════════════════
// Responses Dialog
// ═══════════════════════════════════════════════════════════

function ResponsesDialog({
  open,
  form,
  formSummary,
  responses,
  isLoading,
  onClose,
}: {
  open: boolean;
  form: FormTemplate | null;
  formSummary: FormSummary | null;
  responses: FormResponseEvent[];
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { maxHeight: "85vh" } }}
    >
      <DialogTitle>
        Responses — {form?.name ?? formSummary?.name ?? "Loading…"}
        {!isLoading && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            ({responses.length})
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ overflowX: "auto", overflowY: "auto" }}>
        {isLoading || !form ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="text" />
            ))}
          </Box>
        ) : responses.length === 0 ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No responses yet.
            </Typography>
          </Box>
        ) : (
          <Table size="small" sx={{ minWidth: 600 }}>
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 600, fontSize: 12, color: "text.secondary" } }}>
                <TableCell>#</TableCell>
                <TableCell>Date</TableCell>
                {form.fields
                  .filter((f) => f.type !== AnswerType.label)
                  .map((f) => (
                    <TableCell key={f.id}>{f.label || "—"}</TableCell>
                  ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {responses.map((r, ri) => {
                const byId: Record<string, string> = {};
                r.responses.forEach((rr) => {
                  byId[rr.fieldId] = rr.answer;
                });
                return (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Typography variant="caption">{ri + 1}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(r.createdAt * 1000).toLocaleString()}
                      </Typography>
                    </TableCell>
                    {form.fields
                      .filter((f) => f.type !== AnswerType.label)
                      .map((f) => (
                        <TableCell key={f.id}>
                          <Typography variant="caption">{byId[f.id] ?? "—"}</Typography>
                        </TableCell>
                      ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
