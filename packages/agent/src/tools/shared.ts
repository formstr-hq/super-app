import { nip19 } from "nostr-tools";

import {
  AnswerType,
  type FormField,
  type FormFieldValidation,
  type FormFieldFileConfig,
  type FormOption,
} from "../services";

export function normalizePubkey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      // ignore
    }
  }
  return null;
}

export function normalizePubkeyList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? normalizePubkey(v) : null))
    .filter((p): p is string => !!p);
}

interface AiField {
  label?: string;
  type?: string;
  /** Options for choice fields — either plain labels or `{id,label}` objects. */
  options?: Array<string | { id?: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  validation?: FormFieldValidation;
  gridRows?: string[];
  gridCols?: string[];
  fileConfig?: FormFieldFileConfig;
}

const ANSWER_TYPES = new Set<string>(Object.values(AnswerType));

/** Coerce an arbitrary type string to a known AnswerType, defaulting to short text. */
function coerceType(type: string | undefined): AnswerType {
  return type && ANSWER_TYPES.has(type) ? (type as AnswerType) : AnswerType.shortText;
}

function normalizeOptions(options: AiField["options"]): FormOption[] | undefined {
  if (!options) return undefined;
  return options.map((o, j) =>
    typeof o === "string" ? { id: `o${j}`, label: o } : { id: o.id ?? `o${j}`, label: o.label },
  );
}

/**
 * Map loosely-typed AI/tool field input to the strict `FormField` shape. Supports the full
 * field set the forms service understands (incl. grids, validation, file config) — more than
 * the super-app builder UI currently exposes.
 */
export function aiFieldsToFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return (value as AiField[]).map((f, i) => ({
    id: `f${i}`,
    label: f.label ?? "",
    type: coerceType(f.type),
    required: f.required ?? false,
    placeholder: f.placeholder,
    options: normalizeOptions(f.options),
    validation: f.validation,
    gridRows: f.gridRows,
    gridCols: f.gridCols,
    fileConfig: f.fileConfig,
  }));
}

export type { ToolCtx as RegisterCtx } from "./types";
