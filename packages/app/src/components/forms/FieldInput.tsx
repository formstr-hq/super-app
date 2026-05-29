import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, Eraser, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AnswerType, type FormField } from "../../services/forms/types";
import { signerManager, createBlossomAuthEvent, BlossomClient } from "@formstr/core";
import { DEFAULT_BLOSSOM_SERVERS } from "../../services/drive/types";

/**
 * Single-field renderer. Each branch handles its own data shape so the form
 * filler can stay declarative. Value/change semantics are `string` everywhere
 * except checkboxes (where callers pass a `Set<string>`), which keeps the
 * existing response serialization (JSON array of option ids) unchanged.
 *
 * Multi-answer field types use `metadata` for auxiliary fields:
 *   - signature: metadata carries the PNG dataURL; answer is "signed" when signed.
 *   - file upload: answer is the URL, metadata carries the original filename.
 *   - grid types: answer is a JSON mapping of rowId → colId(s).
 */
export interface FieldInputProps {
  field: FormField;
  value: string;
  checkedValues?: Set<string>;
  metadata?: string;
  onChange: (value: string, metadata?: string) => void;
  onToggleCheck?: (optionId: string) => void;
  disabled?: boolean;
}

export function FieldInput(props: FieldInputProps) {
  const { field } = props;
  const labelEl = (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Label className="text-sm font-medium">{field.label || "Untitled"}</Label>
      {(field.required || field.validation?.required) && (
        <span className="text-destructive text-xs">*</span>
      )}
    </div>
  );

  switch (field.type) {
    case AnswerType.section:
      return null; // handled by the wizard paginator, not the renderer
    case AnswerType.label:
      return (
        <div className="py-1">
          <p className="text-sm text-muted-foreground">{field.label}</p>
        </div>
      );
    case AnswerType.shortText:
      return (
        <div>
          {labelEl}
          <Input
            placeholder={field.placeholder || "Your answer"}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.disabled}
          />
        </div>
      );
    case AnswerType.paragraph:
      return (
        <div>
          {labelEl}
          <textarea
            className={cn(
              "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2",
              "text-sm ring-offset-background placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "resize-none",
            )}
            placeholder={field.placeholder || "Your answer"}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            rows={3}
            disabled={props.disabled}
          />
        </div>
      );
    case AnswerType.radioButton:
      return (
        <div>
          {labelEl}
          <RadioGroup
            value={props.value}
            onValueChange={props.onChange}
            className="space-y-1.5"
            disabled={props.disabled}
          >
            {(field.options ?? []).map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <RadioGroupItem value={opt.id} id={`r-${field.id}-${opt.id}`} />
                <Label
                  htmlFor={`r-${field.id}-${opt.id}`}
                  className="text-sm cursor-pointer font-normal"
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      );
    case AnswerType.checkboxes:
      return (
        <div>
          {labelEl}
          <div className="space-y-1.5">
            {(field.options ?? []).map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Checkbox
                  id={`c-${field.id}-${opt.id}`}
                  checked={props.checkedValues?.has(opt.id) ?? false}
                  onCheckedChange={() => props.onToggleCheck?.(opt.id)}
                  disabled={props.disabled}
                />
                <Label
                  htmlFor={`c-${field.id}-${opt.id}`}
                  className="text-sm cursor-pointer font-normal"
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      );
    case AnswerType.dropdown:
      return (
        <div>
          {labelEl}
          <Select value={props.value} onValueChange={props.onChange} disabled={props.disabled}>
            <SelectTrigger>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case AnswerType.number:
      return (
        <div>
          {labelEl}
          <Input
            type="number"
            placeholder={field.placeholder || "0"}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.disabled}
          />
        </div>
      );
    case AnswerType.date:
      return (
        <div>
          {labelEl}
          <Input
            type="date"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.disabled}
          />
        </div>
      );
    case AnswerType.time:
      return (
        <div>
          {labelEl}
          <Input
            type="time"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.disabled}
          />
        </div>
      );
    case AnswerType.datetime:
      return (
        <div>
          {labelEl}
          <Input
            type="datetime-local"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.disabled}
          />
        </div>
      );
    case AnswerType.signature:
      return (
        <div>
          {labelEl}
          <SignatureCanvas value={props.metadata ?? ""} onChange={props.onChange} />
        </div>
      );
    case AnswerType.fileUpload:
      return (
        <div>
          {labelEl}
          <BlossomFileUpload
            field={field}
            value={props.value}
            metadata={props.metadata ?? ""}
            onChange={props.onChange}
          />
        </div>
      );
    case AnswerType.multiChoiceGrid:
      return (
        <div>
          {labelEl}
          <GridInput
            field={field}
            value={props.value}
            onChange={props.onChange}
            allowMultiple={false}
          />
        </div>
      );
    case AnswerType.checkboxGrid:
      return (
        <div>
          {labelEl}
          <GridInput field={field} value={props.value} onChange={props.onChange} allowMultiple />
        </div>
      );
    default:
      return (
        <div>
          {labelEl}
          <Input
            placeholder="Your answer"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
          />
        </div>
      );
  }
}

// ── Signature Canvas ─────────────────────────────────────

function SignatureCanvas({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string, metadata?: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [hasContent, setHasContent] = useState(Boolean(value));

  // Restore existing dataURL when re-mounting.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      setHasContent(true);
    };
    img.src = value;
  }, [value]);

  const point = useCallback((e: PointerEvent | React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    lastPoint.current = point(e);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPoint.current) return;
    const p = point(e);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL("image/png");
      setHasContent(true);
      onChange("signed", dataUrl);
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
    onChange("", "");
  };

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-input bg-background">
        <canvas
          ref={canvasRef}
          width={600}
          height={140}
          className="w-full h-[140px] cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {hasContent ? "Signed" : "Sign with mouse / finger"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="cursor-pointer text-xs h-7"
          onClick={clear}
        >
          <Eraser className="h-3 w-3 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}

// ── Blossom File Upload ─────────────────────────────────

function BlossomFileUpload({
  field,
  value,
  metadata,
  onChange,
}: {
  field: FormField;
  value: string;
  metadata: string;
  onChange: (value: string, metadata?: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);

    const maxBytes = field.fileConfig?.maxBytes;
    if (maxBytes && file.size > maxBytes) {
      setError(
        `File too large (${(file.size / 1e6).toFixed(1)} MB, max ${(maxBytes / 1e6).toFixed(1)} MB)`,
      );
      return;
    }
    const mimeTypes = field.fileConfig?.mimeTypes;
    if (mimeTypes?.length && !mimeTypes.some((m) => file.type.startsWith(m))) {
      setError(`File type ${file.type || "unknown"} not allowed.`);
      return;
    }

    setUploading(true);
    try {
      const signer = await signerManager.getSigner();
      const server = field.fileConfig?.blossomServer ?? DEFAULT_BLOSSOM_SERVERS[0];
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const authEvent = await createBlossomAuthEvent("upload", sha256, signer);
      const client = new BlossomClient(server);
      const result = await client.upload(bytes, authEvent, file.type);
      onChange(result.url, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    onChange("", "");
    setError(null);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.currentTarget.value = "";
        }}
      />
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <Upload className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 truncate text-primary hover:underline"
          >
            {metadata || value}
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 cursor-pointer"
            onClick={clear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePick}
          disabled={uploading}
          className="cursor-pointer"
        >
          {uploading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Choose file
            </>
          )}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Grid input ─────────────────────────────────────────

function GridInput({
  field,
  value,
  onChange,
  allowMultiple,
}: {
  field: FormField;
  value: string;
  onChange: (value: string) => void;
  allowMultiple: boolean;
}) {
  const rows = field.gridRows ?? [];
  const cols = field.gridCols ?? [];

  const state = useMemo<Record<string, string[]>>(() => {
    try {
      const parsed = value ? JSON.parse(value) : {};
      if (parsed && typeof parsed === "object") return parsed as Record<string, string[]>;
    } catch {
      /* ignore */
    }
    return {};
  }, [value]);

  const setCell = (rowIdx: number, colIdx: number) => {
    const rowKey = String(rowIdx);
    const colKey = String(colIdx);
    const prev = state[rowKey] ?? [];
    let next: string[];
    if (allowMultiple) {
      next = prev.includes(colKey) ? prev.filter((c) => c !== colKey) : [...prev, colKey];
    } else {
      next = prev.includes(colKey) ? [] : [colKey];
    }
    onChange(JSON.stringify({ ...state, [rowKey]: next }));
  };

  if (rows.length === 0 || cols.length === 0) {
    return <p className="text-xs text-muted-foreground">Grid rows/columns not configured yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="w-32" />
            {cols.map((c, ci) => (
              <th
                key={ci}
                className="text-xs font-normal text-muted-foreground px-2 py-1 text-center"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-border/40">
              <td className="py-1.5 pr-2 text-xs">{r}</td>
              {cols.map((_, ci) => {
                const selected = (state[String(ri)] ?? []).includes(String(ci));
                return (
                  <td key={ci} className="text-center py-1.5">
                    {allowMultiple ? (
                      <Checkbox checked={selected} onCheckedChange={() => setCell(ri, ci)} />
                    ) : (
                      <input
                        type="radio"
                        name={`grid-${field.id}-${ri}`}
                        checked={selected}
                        onChange={() => setCell(ri, ci)}
                        className="accent-primary"
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Validation helper (exported for builder + filler) ───

export interface ValidationIssue {
  fieldId: string;
  message: string;
}

export function validateFieldAnswer(
  field: FormField,
  answer: string,
  checkedValues?: Set<string>,
  metadata?: string,
): ValidationIssue | null {
  const v = field.validation;
  const isRequired = field.required || v?.required;
  const isEmpty = (() => {
    if (field.type === AnswerType.checkboxes) return !checkedValues?.size;
    if (field.type === AnswerType.signature) return !metadata;
    return !answer.trim();
  })();
  if (isRequired && isEmpty) {
    return { fieldId: field.id, message: `${field.label || "Field"} is required` };
  }
  if (isEmpty) return null;
  if (!v) return null;

  if (field.type === AnswerType.shortText || field.type === AnswerType.paragraph) {
    if (v.min != null && answer.length < v.min) {
      return { fieldId: field.id, message: `Must be at least ${v.min} characters` };
    }
    if (v.max != null && answer.length > v.max) {
      return { fieldId: field.id, message: `Must be at most ${v.max} characters` };
    }
    if (v.regex) {
      try {
        if (!new RegExp(v.regex).test(answer)) {
          return { fieldId: field.id, message: v.regexError || "Invalid format" };
        }
      } catch {
        /* invalid regex = skip */
      }
    }
  }
  if (field.type === AnswerType.number) {
    const n = Number(answer);
    if (!Number.isFinite(n)) {
      return { fieldId: field.id, message: "Must be a number" };
    }
    if (v.min != null && n < v.min) {
      return { fieldId: field.id, message: `Must be ≥ ${v.min}` };
    }
    if (v.max != null && n > v.max) {
      return { fieldId: field.id, message: `Must be ≤ ${v.max}` };
    }
  }
  return null;
}
