import type { AnswerType, FormField } from "@formstr/app/services";
import { nip19 } from "nostr-tools";

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
  options?: string[];
  required?: boolean;
  placeholder?: string;
  gridRows?: string[];
  gridCols?: string[];
}

export function aiFieldsToFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return (value as AiField[]).map((f, i) => ({
    id: `f${i}`,
    label: f.label ?? "",
    type: (f.type as AnswerType) ?? ("shortText" as AnswerType),
    required: f.required ?? false,
    placeholder: f.placeholder,
    options: f.options?.map((o, j) => ({ id: `o${j}`, label: o })),
    gridRows: f.gridRows,
    gridCols: f.gridCols,
  }));
}
