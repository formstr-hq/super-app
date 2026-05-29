import type { Weekday } from "rrule";
import { RRule, RRuleSet, rrulestr } from "rrule";

import type { CalendarEvent } from "../services/calendar/types";

function asRRule(x: unknown): RRule | null {
  if (x instanceof RRule) return x;
  if (x instanceof RRuleSet) return x.rrules()[0] ?? null;
  return null;
}

/**
 * Expand a master event's RRULE into concrete occurrences that fall within
 * the visible window. Events without an RRULE are returned as a single-item
 * list (the master event itself).
 *
 * We clone the master event for every occurrence, rewriting `begin`/`end`
 * and making the occurrence id locally unique (`<baseId>::<iso>`). The
 * `event.user`, `event.id`, and `event.kind` stay pointed at the master so
 * downstream actions (delete, RSVP) target the correct addressable event.
 */
export function expandEvent(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrences = 365,
): CalendarEvent[] {
  const rruleStr = event.repeat?.rrule;
  if (!rruleStr) return [event];

  const duration = Math.max(0, event.end - event.begin);
  const dtstart = new Date(event.begin);

  let rule: RRule | null = null;
  try {
    // Allow either "FREQ=...", "RRULE:FREQ=..." or full "DTSTART...;RRULE:..."
    const normalized =
      rruleStr.startsWith("RRULE:") || rruleStr.startsWith("DTSTART")
        ? rruleStr
        : `RRULE:${rruleStr}`;
    rule = asRRule(rrulestr(normalized, { dtstart }));
    if (!rule) return [event];
  } catch {
    return [event];
  }

  // rrule's `.between` is inclusive on start
  const occurrences = rule.between(rangeStart, rangeEnd, true).slice(0, maxOccurrences);

  if (occurrences.length === 0) return [];

  return occurrences.map((occStart) => ({
    ...event,
    begin: occStart.getTime(),
    end: occStart.getTime() + duration,
    // Keep id/eventId pointing at master so RSVP/delete still work.
  }));
}

export function expandEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  return events.flatMap((e) => expandEvent(e, rangeStart, rangeEnd));
}

// ── Builder helpers ─────────────────────────────────────

export type RRuleFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RRuleParts {
  freq: RRuleFreq;
  interval: number;
  byDay?: Array<"MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU">;
  until?: string; // YYYY-MM-DD
  count?: number;
}

const FREQ_TO_RRULE: Record<RRuleFreq, number> = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
};

const DAY_MAP = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
} as const;

export function buildRRuleString(parts: RRuleParts | null): string | undefined {
  if (!parts) return undefined;

  const options: ConstructorParameters<typeof RRule>[0] = {
    freq: FREQ_TO_RRULE[parts.freq],
    interval: Math.max(1, parts.interval || 1),
  };

  if (parts.byDay?.length) {
    options.byweekday = parts.byDay.map((d) => DAY_MAP[d]);
  }

  if (parts.until) {
    const [y, m, d] = parts.until.split("-").map(Number);
    if (y && m && d) options.until = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  } else if (parts.count) {
    options.count = parts.count;
  }

  const rule = new RRule(options);
  // We only want the RRULE portion — the event's start is carried as `start`
  // tag already, so stripping DTSTART keeps the tag payload clean.
  return rule
    .toString()
    .replace(/^DTSTART[^\n]*\n?/i, "")
    .replace(/^RRULE:/i, "")
    .trim();
}

export function parseRRuleString(rruleStr: string | null | undefined): RRuleParts | null {
  if (!rruleStr) return null;
  try {
    const normalized = rruleStr.startsWith("RRULE:") ? rruleStr : `RRULE:${rruleStr}`;
    const rule = asRRule(rrulestr(normalized));
    if (!rule) return null;
    const opts = rule.options;

    const freq =
      opts.freq === RRule.DAILY
        ? "DAILY"
        : opts.freq === RRule.WEEKLY
          ? "WEEKLY"
          : opts.freq === RRule.MONTHLY
            ? "MONTHLY"
            : opts.freq === RRule.YEARLY
              ? "YEARLY"
              : null;
    if (!freq) return null;

    const byDayShort: RRuleParts["byDay"] = opts.byweekday
      ? (opts.byweekday as unknown as Array<number | Weekday>).map((wd) => {
          const num = typeof wd === "number" ? wd : ((wd as Weekday).weekday ?? 0);
          return (["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const)[num];
        })
      : undefined;

    return {
      freq,
      interval: opts.interval ?? 1,
      byDay: byDayShort,
      until: opts.until ? opts.until.toISOString().slice(0, 10) : undefined,
      count: opts.count ?? undefined,
    };
  } catch {
    return null;
  }
}

export function describeRRule(rruleStr: string | null | undefined): string {
  if (!rruleStr) return "";
  try {
    const normalized = rruleStr.startsWith("RRULE:") ? rruleStr : `RRULE:${rruleStr}`;
    const rule = asRRule(rrulestr(normalized));
    return rule ? rule.toText() : rruleStr;
  } catch {
    return rruleStr;
  }
}
