import type { CalendarEvent } from "../services/calendar/types";

// ── ICS generation (RFC-5545) ───────────────────────────
// Port of nostr-calendar/src/common/utils.ts `downloadIcs`, generalized so
// it can be called from the event detail dialog (single event) and the
// calendar header (whole visible calendar).

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toIcsDate(ms: number, tzid?: string): string {
  const d = new Date(ms);
  if (tzid) {
    // TZID-relative local datetime
    return (
      `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
      `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
    );
  }
  // UTC form
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  // RFC-5545 §3.1 line folding at 75 octets.
  if (line.length <= 75) return line;
  const out: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    out.push(remaining.slice(0, 75));
    remaining = remaining.slice(75);
  }
  out.push(remaining);
  return out.join("\r\n ");
}

function serializeEvent(event: CalendarEvent): string[] {
  const uid = `${event.id}@formstr`;
  const now = toIcsDate(Date.now());
  const startParam = event.startTzid
    ? `DTSTART;TZID=${event.startTzid}:${toIcsDate(event.begin, event.startTzid)}`
    : `DTSTART:${toIcsDate(event.begin)}`;
  const endParam = event.endTzid
    ? `DTEND;TZID=${event.endTzid}:${toIcsDate(event.end, event.endTzid)}`
    : event.startTzid
    ? `DTEND;TZID=${event.startTzid}:${toIcsDate(event.end, event.startTzid)}`
    : `DTEND:${toIcsDate(event.end)}`;

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    startParam,
    endParam,
    `SUMMARY:${escapeText(event.title || "Untitled")}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location.length) lines.push(`LOCATION:${escapeText(event.location.join(", "))}`);
  if (event.repeat.rrule) lines.push(`RRULE:${event.repeat.rrule}`);
  for (const p of event.participants) lines.push(`ATTENDEE:${p}`);
  for (const cat of event.categories) lines.push(`CATEGORIES:${escapeText(cat)}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildIcs(events: CalendarEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Formstr//SuperApp//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const event of events) lines.push(...serializeEvent(event));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n");
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "event";
}

export function exportEvent(event: CalendarEvent) {
  triggerDownload(`${safeFilename(event.title)}.ics`, buildIcs([event]));
}

export function exportCalendar(events: CalendarEvent[], name = "calendar") {
  triggerDownload(`${safeFilename(name)}.ics`, buildIcs(events));
}
