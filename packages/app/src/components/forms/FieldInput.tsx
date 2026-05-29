import { signerManager, createBlossomAuthEvent, BlossomClient } from "@formstr/core";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Upload, X, Eraser, Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { DEFAULT_BLOSSOM_SERVERS } from "../../services/drive/types";
import { AnswerType, type FormField } from "../../services/forms/types";

// ── Validation ────────────────────────────────────────────

export interface ValidationIssue {
  fieldId: string;
  message: string;
}

export function validateFieldAnswer(
  field: FormField,
  value: string,
  checkedValues?: Set<string>,
): ValidationIssue | null {
  if (field.required) {
    if (field.type === AnswerType.checkboxes && (!checkedValues || checkedValues.size === 0)) {
      return { fieldId: field.id, message: `"${field.label}" is required` };
    }
    if (field.type !== AnswerType.checkboxes && !value?.trim()) {
      return { fieldId: field.id, message: `"${field.label}" is required` };
    }
  }
  return null;
}

// ── FieldInput ────────────────────────────────────────────

interface FieldInputProps {
  field: FormField;
  value: string;
  checkedValues?: Set<string>;
  metadata?: Record<string, string>;
  onChange: (value: string) => void;
  onToggleCheck?: (optionId: string) => void;
  disabled?: boolean;
}

export function FieldInput({
  field,
  value,
  checkedValues,
  onChange,
  onToggleCheck,
  disabled,
}: FieldInputProps) {
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
    case AnswerType.section:
      return null;

    case AnswerType.label:
      return (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5, fontStyle: "italic" }}>
          {field.label}
        </Typography>
      );

    case AnswerType.shortText:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            placeholder={field.placeholder || "Your answer"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
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
            disabled={disabled}
          />
        </Box>
      );

    case AnswerType.number:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            type="number"
            placeholder={field.placeholder || "0"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        </Box>
      );

    case AnswerType.date:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
      );

    case AnswerType.time:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            type="time"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
      );

    case AnswerType.datetime:
      return (
        <Box>
          {label}
          <TextField
            size="small"
            fullWidth
            type="datetime-local"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
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
                disabled={disabled}
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
                disabled={disabled}
                control={
                  <Checkbox
                    size="small"
                    checked={checkedValues?.has(opt.id) ?? false}
                    onChange={() => onToggleCheck?.(opt.id)}
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
          <FormControl size="small" fullWidth disabled={disabled}>
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

    case AnswerType.signature:
      return (
        <SignatureCanvas
          label={field.label}
          required={field.required}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case AnswerType.fileUpload:
      return (
        <BlossomFileUpload
          label={field.label}
          required={field.required}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );

    case AnswerType.multiChoiceGrid:
    case AnswerType.checkboxGrid:
      return (
        <Box>
          {label}
          <GridInput
            field={field}
            value={value}
            onChange={onChange}
            isCheckbox={field.type === AnswerType.checkboxGrid}
            disabled={disabled}
          />
        </Box>
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
            disabled={disabled}
          />
        </Box>
      );
  }
}

// ── SignatureCanvas ───────────────────────────────────────

interface SignatureCanvasProps {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function SignatureCanvas({ label, required, value, onChange, disabled }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const getPos = (e: PointerEvent | React.PointerEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    isDrawing.current = true;
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e.nativeEvent, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawing.current || disabled) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e.nativeEvent, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  };

  const onPointerUp = () => {
    isDrawing.current = false;
    onChange(canvasRef.current?.toDataURL("image/png") ?? "");
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
        <Typography variant="body2" fontWeight={500}>
          {label || "Signature"}
        </Typography>
        {required && (
          <Typography variant="caption" color="error">
            *
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
          position: "relative",
          cursor: disabled ? "not-allowed" : "crosshair",
        }}
      >
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          style={{ display: "block", width: "100%", height: 120, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {!disabled && (
          <IconButton size="small" onClick={clear} sx={{ position: "absolute", top: 4, right: 4 }}>
            <Eraser size={14} />
          </IconButton>
        )}
      </Box>
      {value && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          Signature captured
        </Typography>
      )}
    </Box>
  );
}

// ── BlossomFileUpload ─────────────────────────────────────

interface BlossomFileUploadProps {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function BlossomFileUpload({ label, required, value, onChange, disabled }: BlossomFileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_FILE_SIZE) {
        setError("File too large (max 50 MB)");
        return;
      }
      if (!ALLOWED_MIME.has(file.type)) {
        setError("File type not supported");
        return;
      }
      setUploading(true);
      try {
        const signer = await signerManager.getSigner();
        const server = DEFAULT_BLOSSOM_SERVERS[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
        const sha256 = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const authEvent = await createBlossomAuthEvent("upload", sha256, signer);
        const client = new BlossomClient(server);
        const result = await client.upload(bytes, authEvent, file.type);
        onChange(result.url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
        <Typography variant="body2" fontWeight={500}>
          {label || "File Upload"}
        </Typography>
        {required && (
          <Typography variant="caption" color="error">
            *
          </Typography>
        )}
      </Box>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        accept={Array.from(ALLOWED_MIME).join(",")}
      />
      {value ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 1.5,
          }}
        >
          <Typography variant="body2" noWrap sx={{ flex: 1 }}>
            {value}
          </Typography>
          {!disabled && (
            <IconButton size="small" color="error" onClick={() => onChange("")}>
              <X size={14} />
            </IconButton>
          )}
        </Box>
      ) : (
        <Button
          variant="outlined"
          size="small"
          startIcon={
            uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />
          }
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
      )}
      {error && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

// ── GridInput ─────────────────────────────────────────────

interface GridInputProps {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  isCheckbox?: boolean;
  disabled?: boolean;
}

function GridInput({ field, value, onChange, isCheckbox, disabled }: GridInputProps) {
  const rows = field.gridRows ?? [];
  const cols = field.gridCols ?? [];

  const parsed: Record<string, string[]> = useMemo(() => {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }, [value]);

  const update = (rowId: string, colId: string, checked: boolean) => {
    const next = { ...parsed };
    if (isCheckbox) {
      const cur = new Set(next[rowId] ?? []);
      if (checked) cur.add(colId);
      else cur.delete(colId);
      next[rowId] = Array.from(cur);
    } else {
      next[rowId] = checked ? [colId] : [];
    }
    onChange(JSON.stringify(next));
  };

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell />
            {cols.map((c) => (
              <TableCell key={c} align="center">
                <Typography variant="caption">{c}</Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r}>
              <TableCell>
                <Typography variant="body2">{r}</Typography>
              </TableCell>
              {cols.map((c) => {
                const sel = parsed[r] ?? [];
                const checked = sel.includes(c);
                return (
                  <TableCell key={c} align="center">
                    <input
                      type={isCheckbox ? "checkbox" : "radio"}
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => update(r, c, e.target.checked)}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
