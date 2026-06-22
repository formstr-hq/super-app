import {
  AnswerType,
  type FormField,
  type FormFieldValidation,
  type FormFieldFileConfig,
  type FormOption,
} from "../services";

// Re-exported for existing callers; defined in a services-free module so tools
// (e.g. calendar) can import the pubkey helpers without dragging in `../services`.
export { normalizePubkey, normalizePubkeyList } from "./pubkey";

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
  maxStars?: number;
}

const ANSWER_TYPES = new Set<string>(Object.values(AnswerType));

/** Pre-rename enum strings still produced by old callers/AI prompts. */
const LEGACY_TYPE_ALIASES: Record<string, AnswerType> = {
  multiChoiceGrid: AnswerType.multipleChoiceGrid,
};

/** Coerce an arbitrary type string to a known AnswerType, defaulting to short text. */
function coerceType(type: string | undefined): AnswerType {
  if (!type) return AnswerType.shortText;
  if (LEGACY_TYPE_ALIASES[type]) return LEGACY_TYPE_ALIASES[type];
  return ANSWER_TYPES.has(type) ? (type as AnswerType) : AnswerType.shortText;
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
    maxStars: f.maxStars,
  }));
}

export type { ToolCtx as RegisterCtx } from "./types";
