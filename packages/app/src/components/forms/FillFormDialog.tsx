import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Typography,
} from "@mui/material";
import { Check, Send } from "lucide-react";
import { useEffect, useState } from "react";

import * as formsService from "../../services/forms/service";
import { AnswerType, type FormResponse, type FormTemplate } from "../../services/forms/types";

import { FieldInput } from "./FieldInput";

interface Props {
  open: boolean;
  form: FormTemplate | null;
  isLoading: boolean;
  onClose: () => void;
}

export function FillFormDialog({ open, form, isLoading, onClose }: Props) {
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
    // Reset only when a different form is loaded (by id), not on every `form` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!form) return;
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
      await formsService.submitResponse(form.pubkey, form.id, responses, form.isEncrypted);
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
      <DialogTitle>{form?.name ?? "Loading…"}</DialogTitle>
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
              {form?.settings?.thankYouText || "Thank you for filling out this form."}
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
              <FieldInput
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
