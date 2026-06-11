import { AnswerType, type FormField, type FormFieldValidation, type FormOption } from "./types";

/**
 * Kind-30168 `field`-tag codec, wire-compatible with the standalone formstr.app
 * (upstream/nostr-forms/packages/formstr-app):
 *
 *   ["field", id, PRIMITIVE, label, optionsJSON, answerSettingsJSON]
 *
 * Slot 2 is a coarse *primitive* (text/number/option/label/section/file/datetime/
 * grid/rating — `menuConfig.tsx`); the actual widget is `answerSettings.renderElement`
 * (= upstream `AnswerTypes`), which formstr.app's filler uses exclusively to pick the
 * input component (`FormFillerNew/QuestionNode/InputFiller.tsx`).
 *
 * Options slot: choice fields carry `[[choiceId, label], …]`; grid fields carry
 * `GridOptions = { rows: [[id, label, config?], …], columns: [[id, label, config?], …] }`.
 */

const PRIMITIVE_BY_TYPE: Record<AnswerType, string> = {
  [AnswerType.label]: "label",
  [AnswerType.section]: "section",
  [AnswerType.shortText]: "text",
  [AnswerType.paragraph]: "text",
  [AnswerType.date]: "text",
  [AnswerType.time]: "text",
  [AnswerType.signature]: "text",
  [AnswerType.number]: "number",
  [AnswerType.radioButton]: "option",
  [AnswerType.checkboxes]: "option",
  [AnswerType.dropdown]: "option",
  [AnswerType.fileUpload]: "file",
  [AnswerType.datetime]: "datetime",
  [AnswerType.multipleChoiceGrid]: "grid",
  [AnswerType.checkboxGrid]: "grid",
  [AnswerType.rating]: "rating",
};

/** Fallback widget per primitive, for tags whose answerSettings carry no renderElement. */
const DEFAULT_TYPE_BY_PRIMITIVE: Record<string, AnswerType> = {
  text: AnswerType.shortText,
  number: AnswerType.number,
  option: AnswerType.radioButton,
  label: AnswerType.label,
  section: AnswerType.section,
  file: AnswerType.fileUpload,
  datetime: AnswerType.datetime,
  grid: AnswerType.multipleChoiceGrid,
  rating: AnswerType.rating,
};

const GRID_TYPES = new Set([AnswerType.multipleChoiceGrid, AnswerType.checkboxGrid]);

/** Upstream `makeTag`-style random id for grid rows/columns. */
function makeId(): string {
  return Math.random().toString(36).slice(2, 8) || "id";
}

/** Upstream `AnswerSettings` (nostr/types.ts) — only the keys this codec reads/writes. */
interface WireAnswerSettings {
  renderElement?: string;
  required?: boolean;
  placeholder?: string;
  maxStars?: number;
  allowMultiplePerRow?: boolean;
  validationRules?: {
    range?: { min: number; max: number };
    min?: { min: number };
    max?: { max: number };
    regex?: { pattern: string; errorMessage: string };
  };
  blossomServer?: string;
  /** In MB (upstream `FileUploadSettings`). */
  maxFileSize?: number;
  allowedTypes?: string[];
  [key: string]: unknown;
}

type GridLine = [id: string, label: string, config?: string];

interface WireGridOptions {
  rows: GridLine[];
  columns: GridLine[];
}

// ── Build ───────────────────────────────────────────────

export function buildFieldTag(field: FormField): string[] {
  let options = "[]";
  if (GRID_TYPES.has(field.type)) {
    const grid: WireGridOptions = {
      rows: (field.gridRows ?? []).map((label): GridLine => [makeId(), label]),
      columns: (field.gridCols ?? []).map((label): GridLine => [makeId(), label]),
    };
    options = JSON.stringify(grid);
  } else if (field.options) {
    options = JSON.stringify(field.options.map((o) => [o.id, o.label]));
  }

  const config: WireAnswerSettings = { renderElement: field.type };
  if (field.required !== undefined) config.required = field.required;
  if (field.placeholder !== undefined) config.placeholder = field.placeholder;
  if (field.type === AnswerType.rating && field.maxStars !== undefined) {
    config.maxStars = field.maxStars;
  }
  if (GRID_TYPES.has(field.type)) {
    config.allowMultiplePerRow = field.type === AnswerType.checkboxGrid;
  }
  if (field.validation) {
    const v = field.validation;
    const rules: NonNullable<WireAnswerSettings["validationRules"]> = {};
    if (v.min !== undefined) rules.min = { min: v.min };
    if (v.max !== undefined) rules.max = { max: v.max };
    if (v.regex !== undefined) rules.regex = { pattern: v.regex, errorMessage: v.regexError ?? "" };
    if (Object.keys(rules).length > 0) config.validationRules = rules;
  }
  if (field.fileConfig) {
    const f = field.fileConfig;
    if (f.blossomServer !== undefined) config.blossomServer = f.blossomServer;
    if (f.maxBytes !== undefined) config.maxFileSize = f.maxBytes / (1024 * 1024);
    if (f.mimeTypes !== undefined) config.allowedTypes = f.mimeTypes;
  }

  return ["field", field.id, PRIMITIVE_BY_TYPE[field.type], field.label, options, JSON.stringify(config)];
}

// ── Parse ───────────────────────────────────────────────

function isAnswerType(value: string): value is AnswerType {
  return Object.values(AnswerType).includes(value as AnswerType);
}

/**
 * Type precedence: primitive `section` (upstream section rows carry an accidental
 * `renderElement: "shortText"` from a default parameter, so the primitive wins) →
 * `renderElement` → legacy super-app AnswerType in slot 2 (incl. the renamed
 * `multiChoiceGrid`) → default per primitive.
 */
function resolveType(primitive: string, renderElement: string | undefined): AnswerType {
  if (primitive === "section") return AnswerType.section;
  if (renderElement) {
    if (renderElement === "multiChoiceGrid") return AnswerType.multipleChoiceGrid;
    if (isAnswerType(renderElement)) return renderElement;
  }
  if (primitive === "multiChoiceGrid") return AnswerType.multipleChoiceGrid;
  if (isAnswerType(primitive)) return primitive;
  return DEFAULT_TYPE_BY_PRIMITIVE[primitive] ?? AnswerType.shortText;
}

export function parseFieldTag(tag: string[]): FormField {
  const [, id = "", primitive = "text", label = "", optionsJson, configJson] = tag;

  let config: WireAnswerSettings = {};
  if (configJson) {
    try {
      const parsed = JSON.parse(configJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
    } catch {
      // malformed config — keep field usable with defaults
    }
  }

  const field: FormField = {
    id,
    type: resolveType(primitive, config.renderElement),
    label,
  };

  let parsedOptions: unknown;
  if (optionsJson) {
    try {
      parsedOptions = JSON.parse(optionsJson);
    } catch {
      // malformed options — treat as none
    }
  }
  if (Array.isArray(parsedOptions) && parsedOptions.length > 0) {
    field.options = (parsedOptions as [string, string][]).map(
      (o): FormOption => ({ id: o[0], label: o[1] }),
    );
  } else if (parsedOptions && typeof parsedOptions === "object") {
    const grid = parsedOptions as Partial<WireGridOptions>;
    if (Array.isArray(grid.rows)) field.gridRows = grid.rows.map((r) => r[1]);
    if (Array.isArray(grid.columns)) field.gridCols = grid.columns.map((c) => c[1]);
  }

  if (typeof config.required === "boolean") field.required = config.required;
  if (typeof config.placeholder === "string") field.placeholder = config.placeholder;
  if (typeof config.maxStars === "number") field.maxStars = config.maxStars;

  const rules = config.validationRules;
  if (rules && typeof rules === "object") {
    const validation: FormFieldValidation = {};
    if (typeof rules.range?.min === "number") validation.min = rules.range.min;
    if (typeof rules.range?.max === "number") validation.max = rules.range.max;
    if (typeof rules.min?.min === "number") validation.min = rules.min.min;
    if (typeof rules.max?.max === "number") validation.max = rules.max.max;
    if (typeof rules.regex?.pattern === "string") {
      validation.regex = rules.regex.pattern;
      if (rules.regex.errorMessage) validation.regexError = rules.regex.errorMessage;
    }
    if (Object.keys(validation).length > 0) field.validation = validation;
  }

  if (
    config.blossomServer !== undefined ||
    config.maxFileSize !== undefined ||
    config.allowedTypes !== undefined
  ) {
    field.fileConfig = {
      ...(typeof config.blossomServer === "string" && { blossomServer: config.blossomServer }),
      ...(typeof config.maxFileSize === "number" && {
        maxBytes: config.maxFileSize * 1024 * 1024,
      }),
      ...(Array.isArray(config.allowedTypes) && { mimeTypes: config.allowedTypes }),
    };
  }

  return field;
}
