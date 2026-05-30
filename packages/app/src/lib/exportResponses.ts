import {
  AnswerType,
  type FormField,
  type FormResponseEvent,
  type FormTemplate,
} from "../services/forms/types";

import { formatNpub } from "./npub";

function optionLabel(field: FormField, optionId: string): string {
  return field.options?.find((o) => o.id === optionId)?.label ?? optionId;
}

/** Render a stored answer for display/export, mapping choice option ids to their labels. */
export function renderAnswer(field: FormField, answer: string): string {
  if (!answer) return "";
  if (field.type === AnswerType.checkboxes) {
    try {
      const ids = JSON.parse(answer) as string[];
      return ids.map((id) => optionLabel(field, id)).join("; ");
    } catch {
      return answer;
    }
  }
  if (field.type === AnswerType.radioButton || field.type === AnswerType.dropdown) {
    return optionLabel(field, answer);
  }
  return answer;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function answerableFields(form: FormTemplate): FormField[] {
  return form.fields.filter((f) => f.type !== AnswerType.label && f.type !== AnswerType.section);
}

export function responsesToCsv(form: FormTemplate, responses: FormResponseEvent[]): string {
  const fields = answerableFields(form);
  const header = ["#", "Date", "Responder", ...fields.map((f) => f.label || "—")];
  const rows = responses.map((r, i) => {
    const byId: Record<string, string> = {};
    r.responses.forEach((rr) => {
      byId[rr.fieldId] = rr.answer;
    });
    return [
      String(i + 1),
      new Date(r.createdAt * 1000).toISOString(),
      formatNpub(r.pubkey),
      ...fields.map((f) => renderAnswer(f, byId[f.id] ?? "")),
    ];
  });
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function responsesToJson(responses: FormResponseEvent[]): string {
  return JSON.stringify(responses, null, 2);
}

/** Trigger a client-side file download for the given text content. */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
