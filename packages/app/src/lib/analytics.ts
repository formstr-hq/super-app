import {
  AnswerType,
  type FormField,
  type FormOption,
  type FormResponseEvent,
  type FormTemplate,
} from "@formstr/agent/services/forms/types";

// ── Summary stats ────────────────────────────────────────

export interface SummaryStats {
  totalResponses: number;
  uniqueResponders: number;
  completionRate: number;
  avgTimeToFirstResponseMs: number | null;
  firstResponseAt: number | null;
  lastResponseAt: number | null;
}

export function computeSummaryStats(
  form: FormTemplate,
  responses: FormResponseEvent[],
): SummaryStats {
  const totalResponses = responses.length;
  const uniqueResponders = new Set(responses.map((r) => r.pubkey)).size;

  const nonLabelFields = form.fields.filter((f) => f.type !== AnswerType.label);
  const requiredFields = nonLabelFields.filter((f) => f.required);
  const totalRequiredAnswers = responses.length * Math.max(requiredFields.length, 1);
  const answeredRequired = responses.reduce((acc, resp) => {
    const answerMap = new Map(resp.responses.map((r) => [r.fieldId, r.answer]));
    const filled = requiredFields.filter((f) => {
      const a = answerMap.get(f.id);
      if (!a) return false;
      if (f.type === AnswerType.checkboxes) {
        try {
          return (JSON.parse(a) as unknown[]).length > 0;
        } catch {
          return false;
        }
      }
      return a.trim().length > 0;
    });
    return acc + filled.length;
  }, 0);
  const completionRate =
    requiredFields.length === 0
      ? 1
      : totalRequiredAnswers > 0
        ? answeredRequired / totalRequiredAnswers
        : 0;

  const timestamps = responses.map((r) => r.createdAt * 1000).sort((a, b) => a - b);
  const firstResponseAt = timestamps[0] ?? null;
  const lastResponseAt = timestamps[timestamps.length - 1] ?? null;
  const formCreatedAtMs = form.createdAt * 1000;
  const avgTimeToFirstResponseMs =
    firstResponseAt != null && firstResponseAt > formCreatedAtMs
      ? firstResponseAt - formCreatedAtMs
      : null;

  return {
    totalResponses,
    uniqueResponders,
    completionRate,
    avgTimeToFirstResponseMs,
    firstResponseAt,
    lastResponseAt,
  };
}

// ── Field breakdown ──────────────────────────────────────

export type FieldBreakdown =
  | { kind: "choice"; field: FormField; rows: Array<{ label: string; count: number }> }
  | {
      kind: "number";
      field: FormField;
      values: number[];
      min: number;
      max: number;
      avg: number;
      histogram: Array<{ bucket: string; count: number }>;
    }
  | {
      kind: "text";
      field: FormField;
      topTokens: Array<{ token: string; count: number }>;
      totalAnswered: number;
    }
  | { kind: "time"; field: FormField; series: Array<{ label: string; count: number }> }
  | { kind: "label"; field: FormField };

const TEXT_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "with",
  "as",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "them",
  "my",
  "your",
  "our",
  "not",
  "no",
  "yes",
  "so",
  "if",
  "then",
  "than",
  "from",
  "about",
  "into",
  "just",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "too",
  "very",
  "also",
  "more",
  "most",
  "some",
  "any",
  "all",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s'-]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TEXT_STOPWORDS.has(t));
}

function bucketize(values: number[], bucketCount = 8): Array<{ bucket: string; count: number }> {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ bucket: formatBucket(min, max), count: values.length }];
  }
  const step = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    lo: min + step * i,
    hi: min + step * (i + 1),
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / step), bucketCount - 1);
    buckets[idx].count++;
  }
  return buckets.map((b) => ({ bucket: formatBucket(b.lo, b.hi), count: b.count }));
}

function formatBucket(lo: number, hi: number): string {
  const r = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(1));
  return `${r(lo)}–${r(hi)}`;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeFieldBreakdown(
  field: FormField,
  responses: FormResponseEvent[],
): FieldBreakdown {
  if (field.type === AnswerType.label) {
    return { kind: "label", field };
  }

  const answers = responses
    .map((r) => r.responses.find((x) => x.fieldId === field.id)?.answer)
    .filter((a): a is string => typeof a === "string" && a.length > 0);

  // Choice types: radioButton, dropdown
  if (field.type === AnswerType.radioButton || field.type === AnswerType.dropdown) {
    const optionsById = new Map<string, FormOption>((field.options ?? []).map((o) => [o.id, o]));
    const counts = new Map<string, number>();
    for (const opt of field.options ?? []) counts.set(opt.id, 0);
    for (const a of answers) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    const rows = Array.from(counts.entries()).map(([id, count]) => ({
      label: optionsById.get(id)?.label ?? id,
      count,
    }));
    return { kind: "choice", field, rows };
  }

  // Checkboxes: answer is JSON array of option ids
  if (field.type === AnswerType.checkboxes) {
    const optionsById = new Map<string, FormOption>((field.options ?? []).map((o) => [o.id, o]));
    const counts = new Map<string, number>();
    for (const opt of field.options ?? []) counts.set(opt.id, 0);
    for (const a of answers) {
      try {
        const ids = JSON.parse(a) as string[];
        if (Array.isArray(ids)) {
          for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      } catch {
        // skip malformed
      }
    }
    const rows = Array.from(counts.entries()).map(([id, count]) => ({
      label: optionsById.get(id)?.label ?? id,
      count,
    }));
    return { kind: "choice", field, rows };
  }

  // Numeric
  if (field.type === AnswerType.number) {
    const values = answers.map((a) => Number(a)).filter((n) => Number.isFinite(n));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { kind: "number", field, values, min, max, avg, histogram: bucketize(values) };
  }

  // Date / time / datetime — group by day
  if (
    field.type === AnswerType.date ||
    field.type === AnswerType.time ||
    field.type === AnswerType.datetime
  ) {
    const series = new Map<string, number>();
    for (const a of answers) {
      const parsed = Date.parse(a);
      const key = Number.isFinite(parsed) ? dayKey(parsed) : a;
      series.set(key, (series.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(series.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));
    return { kind: "time", field, series: sorted };
  }

  // Free text
  const tokenCounts = new Map<string, number>();
  for (const a of answers) {
    for (const t of tokenize(a)) {
      tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
    }
  }
  const topTokens = Array.from(tokenCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([token, count]) => ({ token, count }));

  return { kind: "text", field, topTokens, totalAnswered: answers.length };
}

// ── CSV export ───────────────────────────────────────────

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(form: FormTemplate, responses: FormResponseEvent[]): string {
  const columns = form.fields.filter((f) => f.type !== AnswerType.label);
  const header = [
    "response_id",
    "responder_pubkey",
    "submitted_at",
    ...columns.map((f) => f.label || f.id),
  ];
  const rows: string[][] = [header];

  for (const resp of responses) {
    const answerMap = new Map(resp.responses.map((r) => [r.fieldId, r.answer]));
    const row = [
      resp.id,
      resp.pubkey,
      new Date(resp.createdAt * 1000).toISOString(),
      ...columns.map((f) => {
        const raw = answerMap.get(f.id) ?? "";
        if (f.type === AnswerType.checkboxes && raw) {
          try {
            const ids = JSON.parse(raw) as string[];
            const optMap = new Map((f.options ?? []).map((o) => [o.id, o.label]));
            return ids.map((id) => optMap.get(id) ?? id).join("; ");
          } catch {
            return raw;
          }
        }
        if ((f.type === AnswerType.radioButton || f.type === AnswerType.dropdown) && raw) {
          const opt = (f.options ?? []).find((o) => o.id === raw);
          return opt?.label ?? raw;
        }
        return raw;
      }),
    ];
    rows.push(row);
  }

  return rows.map((r) => r.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Formatting helpers ───────────────────────────────────

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const days = Math.floor(hr / 24);
  return `${days}d ${hr % 24}h`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
