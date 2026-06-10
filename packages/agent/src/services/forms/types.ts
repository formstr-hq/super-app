import type { Event } from "nostr-tools";

// ── Event Kinds ─────────────────────────────────────────
export const FORM_KINDS = {
  template: 30168,
  response: 1069,
  myFormsList: 14083,
  giftWrap: 1059,
} as const;

// ── Form Field Types ────────────────────────────────────
export enum AnswerType {
  shortText = "shortText",
  paragraph = "paragraph",
  radioButton = "radioButton",
  checkboxes = "checkboxes",
  dropdown = "dropdown",
  number = "number",
  date = "date",
  label = "label",
  time = "time",
  datetime = "datetime",
  fileUpload = "fileUpload",
  signature = "signature",
  multipleChoiceGrid = "multipleChoiceGrid",
  checkboxGrid = "checkboxGrid",
  rating = "rating",
  /** Page-break marker — not an answerable field, lets the filler paginate. */
  section = "section",
}

// ── Data Structures ─────────────────────────────────────

/** Per-field validation rules. All optional; required stays on the field for backwards compat. */
export interface FormFieldValidation {
  required?: boolean;
  /** Min characters (text) / min value (number). */
  min?: number;
  /** Max characters (text) / max value (number). */
  max?: number;
  /** RegExp string; when set, answer must match. */
  regex?: string;
  /** Human-readable message shown when the regex fails. */
  regexError?: string;
}

export interface FormFieldFileConfig {
  blossomServer?: string;
  /** Max bytes accepted by the uploader. */
  maxBytes?: number;
  /** Whitelist of MIME type prefixes, e.g. ["image/"]. */
  mimeTypes?: string[];
}

export interface FormField {
  id: string;
  type: AnswerType;
  label: string;
  options?: FormOption[];
  required?: boolean;
  placeholder?: string;
  validation?: FormFieldValidation;
  /** Rows for grid field types. */
  gridRows?: string[];
  /** Columns for grid field types. */
  gridCols?: string[];
  fileConfig?: FormFieldFileConfig;
  /** Star count for rating fields (upstream `answerSettings.maxStars`). */
  maxStars?: number;
}

export interface FormOption {
  id: string;
  label: string;
}

export interface FormSettings {
  titleImageUrl?: string;
  coverImageUrl?: string;
  description?: string;
  thankYouPage?: boolean;
  thankYouText?: string;
  notifyNpubs?: string[];
  publicForm?: boolean;
  disallowAnonymous?: boolean;
  /** Hex pubkeys that are allowed to submit responses (empty = anyone). */
  allowedResponders?: string[];
  /** Hex pubkeys that receive the view-key gift-wrap so they can decrypt the fields. */
  collaborators?: string[];
}

export type FormDecryptError = "not-author" | "decrypt-failed" | "no-signer" | "no-view-key";

export interface FormTemplate {
  id: string;
  name: string;
  fields: FormField[];
  settings: FormSettings;
  pubkey: string;
  createdAt: number;
  isEncrypted: boolean;
  /** "self" (author-only), "view-key" (gift-wrap distributed), or undefined when plaintext. */
  encryptionMode?: "self" | "view-key";
  decryptError?: FormDecryptError;
  /** The form's `["relay", url]` hints — responses go to these ∪ module relays. */
  relays?: string[];
  event?: Event;
}

export interface FormResponse {
  fieldId: string;
  answer: string;
  metadata?: string;
}

export interface FormResponseEvent {
  id: string;
  pubkey: string;
  responses: FormResponse[];
  createdAt: number;
  event: Event;
  /** True when the payload came from encrypted `content`, false when from plaintext `response` tags. */
  wasEncrypted?: boolean;
}

export interface FormSummary {
  id: string;
  name: string;
  pubkey: string;
  createdAt: number;
  responseCount?: number;
  isEncrypted: boolean;
  /** Hex-encoded ephemeral signing key. Present only for forms you created. */
  signingKey?: string;
  /** Hex-encoded view key. Present only for encrypted forms you created. */
  viewKey?: string;
  /** Relay hint from the kind-14083 entry (3rd slot) — formstr.app's retry path uses it. */
  relay?: string;
}
