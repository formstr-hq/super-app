import {
  AnswerType,
  type FormField,
  type FormFieldValidation,
} from "@formstr/agent/services/forms/types";
import {
  Box,
  Button,
  Collapse,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { GripVertical, PlusCircle, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);
const GRID_TYPES = new Set([AnswerType.multipleChoiceGrid, AnswerType.checkboxGrid]);
const TEXT_TYPES = new Set([AnswerType.shortText, AnswerType.paragraph]);
const VALIDATABLE_TYPES = new Set([...TEXT_TYPES, AnswerType.number]);

interface Props {
  field: FormField;
  index: number;
  onUpdate: (index: number, updates: Partial<FormField>) => void;
  onRemove: (index: number) => void;
  onAddOption: (index: number) => void;
  onUpdateOption: (index: number, optIndex: number, label: string) => void;
  onRemoveOption: (index: number, optIndex: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
}

export function FieldEditorRow({
  field,
  index,
  onUpdate,
  onRemove,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
  onDragStart,
  onDrop,
}: Props) {
  const rules = field.validation ?? {};
  const hasRules = rules.min !== undefined || rules.max !== undefined || (rules.regex ?? "") !== "";
  const [showRules, setShowRules] = useState(hasRules);

  const patchRules = (patch: Partial<FormFieldValidation>) =>
    onUpdate(index, { validation: { ...rules, ...patch } });

  const numOrUndef = (raw: string) => (raw === "" ? undefined : Number(raw));

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 1.5 }}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(index);
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <GripVertical size={14} color="var(--mui-palette-text-disabled)" />
        <TextField
          placeholder="Question…"
          value={field.label}
          onChange={(e) => onUpdate(index, { label: e.target.value })}
          size="small"
          sx={{ flex: 1 }}
        />
        <Select
          value={field.type}
          onChange={(e) => onUpdate(index, { type: e.target.value as AnswerType })}
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
          <MenuItem value={AnswerType.rating}>Rating</MenuItem>
          <MenuItem value={AnswerType.multipleChoiceGrid}>Choice grid</MenuItem>
          <MenuItem value={AnswerType.checkboxGrid}>Checkbox grid</MenuItem>
          <MenuItem value={AnswerType.label}>Label</MenuItem>
          <MenuItem value={AnswerType.section}>Section break</MenuItem>
          <MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>
          <MenuItem value={AnswerType.signature}>Signature</MenuItem>
        </Select>
        {VALIDATABLE_TYPES.has(field.type) && (
          <Tooltip title="Validation rules">
            <IconButton
              size="small"
              aria-label="Validation rules"
              onClick={() => setShowRules((v) => !v)}
              sx={{ color: showRules || hasRules ? "primary.main" : "text.secondary" }}
            >
              <SlidersHorizontal size={13} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={field.required ? "Mark optional" : "Mark required"}>
          <Box
            component="button"
            onClick={() => onUpdate(index, { required: !field.required })}
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
          <IconButton size="small" color="error" onClick={() => onRemove(index)}>
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
                onChange={(e) => onUpdateOption(index, oi, e.target.value)}
                placeholder={`Option ${oi + 1}`}
                sx={{ flex: 1, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
              />
              <IconButton size="small" color="error" onClick={() => onRemoveOption(index, oi)}>
                <X size={12} />
              </IconButton>
            </Box>
          ))}
          <Button
            size="small"
            variant="text"
            startIcon={<PlusCircle size={13} />}
            onClick={() => onAddOption(index)}
            sx={{ alignSelf: "flex-start", fontSize: 12, color: "text.secondary" }}
          >
            Add option
          </Button>
        </Box>
      )}

      {field.type === AnswerType.rating && (
        <Box sx={{ pl: 3.5, mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Stars
          </Typography>
          <TextField
            size="small"
            type="number"
            value={field.maxStars ?? 5}
            onChange={(e) => {
              const n = Number(e.target.value);
              onUpdate(index, { maxStars: Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : 5 });
            }}
            inputProps={{ min: 1, max: 10 }}
            sx={{ width: 80, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
          />
        </Box>
      )}

      {GRID_TYPES.has(field.type) && (
        <Box sx={{ pl: 3.5, mt: 1, display: "flex", gap: 1.5 }}>
          <TextField
            size="small"
            label="Rows (one per line)"
            multiline
            minRows={2}
            value={(field.gridRows ?? []).join("\n")}
            onChange={(e) => onUpdate(index, { gridRows: e.target.value.split("\n") })}
            sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: 13 } }}
          />
          <TextField
            size="small"
            label="Columns (one per line)"
            multiline
            minRows={2}
            value={(field.gridCols ?? []).join("\n")}
            onChange={(e) => onUpdate(index, { gridCols: e.target.value.split("\n") })}
            sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: 13 } }}
          />
        </Box>
      )}

      {VALIDATABLE_TYPES.has(field.type) && (
        <Collapse in={showRules}>
          <Box sx={{ pl: 3.5, mt: 1, display: "flex", flexWrap: "wrap", gap: 1 }}>
            <TextField
              size="small"
              type="number"
              label={field.type === AnswerType.number ? "Min value" : "Min length"}
              value={rules.min ?? ""}
              onChange={(e) => patchRules({ min: numOrUndef(e.target.value) })}
              sx={{ width: 110, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
            />
            <TextField
              size="small"
              type="number"
              label={field.type === AnswerType.number ? "Max value" : "Max length"}
              value={rules.max ?? ""}
              onChange={(e) => patchRules({ max: numOrUndef(e.target.value) })}
              sx={{ width: 110, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
            />
            {TEXT_TYPES.has(field.type) && (
              <>
                <TextField
                  size="small"
                  label="Regex pattern"
                  placeholder="^\d{6}$"
                  value={rules.regex ?? ""}
                  onChange={(e) => patchRules({ regex: e.target.value || undefined })}
                  sx={{
                    minWidth: 160,
                    flex: 1,
                    "& .MuiInputBase-input": { py: 0.5, fontSize: 13 },
                  }}
                />
                <TextField
                  size="small"
                  label="Error message"
                  placeholder="Must be a 6-digit code"
                  value={rules.regexError ?? ""}
                  onChange={(e) => patchRules({ regexError: e.target.value || undefined })}
                  disabled={!rules.regex}
                  sx={{
                    minWidth: 160,
                    flex: 1,
                    "& .MuiInputBase-input": { py: 0.5, fontSize: 13 },
                  }}
                />
              </>
            )}
          </Box>
        </Collapse>
      )}
    </Paper>
  );
}
