import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { GripVertical, PlusCircle, Trash2, X } from "lucide-react";

import { AnswerType, type FormField } from "../../services/forms/types";

const CHOICE_TYPES = new Set([AnswerType.radioButton, AnswerType.checkboxes, AnswerType.dropdown]);

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
          <MenuItem value={AnswerType.label}>Label</MenuItem>
          <MenuItem value={AnswerType.fileUpload}>File upload</MenuItem>
          <MenuItem value={AnswerType.signature}>Signature</MenuItem>
        </Select>
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
    </Paper>
  );
}
