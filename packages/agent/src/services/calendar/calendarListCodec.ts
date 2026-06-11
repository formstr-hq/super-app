import type { CalendarList } from "./types";

/**
 * Calendar-list (kind 32123) content codec.
 *
 * The standalone `nostr-calendar` stores the decrypted calendar-list content as
 * a NIP-style **tags array**, NOT a JSON object:
 *
 *   [["title", t], ["content", description], ["color", c],
 *    ["a", "{kind}:{pubkey}:{dTag}", relayHint, viewKey], ...]
 *
 * Encoding to this shape keeps super-app calendar lists readable by
 * calendar.formstr.app (and vice-versa). See
 * `upstream/nostr-calendar/src/common/calendarList.ts`.
 */

const DEFAULT_TITLE = "Calendar";
const DEFAULT_COLOR = "#334155";

/** CalendarList → NIP tags array (the decrypted kind-32123 content). */
export function encodeCalendarList(list: CalendarList): string[][] {
  const tags: string[][] = [
    ["title", list.title],
    ["content", list.description ?? ""],
    ["color", list.color],
  ];
  // Upstream persists only the non-default notification preference.
  if (list.notificationPreference === "disabled") tags.push(["notifications", "disabled"]);
  for (const ref of list.eventRefs) tags.push(["a", ...ref]);
  return tags;
}

/**
 * NIP tags array → CalendarList. `dTag` and `eventId` come from the outer
 * Nostr event (the `d` tag and event id respectively).
 */
export function decodeCalendarList(tags: string[][], dTag: string, eventId: string): CalendarList {
  let title = DEFAULT_TITLE;
  let description = "";
  let color = DEFAULT_COLOR;
  let notificationPreference: "enabled" | "disabled" | undefined;
  const eventRefs: string[][] = [];

  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length === 0) continue;
    switch (tag[0]) {
      case "title":
        title = tag[1] ?? title;
        break;
      case "content":
        description = tag[1] ?? "";
        break;
      case "color":
        color = tag[1] || DEFAULT_COLOR;
        break;
      case "notifications":
        notificationPreference = tag[1] === "disabled" ? "disabled" : "enabled";
        break;
      case "a":
        if (tag[1] === "a") {
          // Heal double-"a" written by T9–T16: calendarStore stored ["a", coord, ...]
          // inside eventRefs, so encodeCalendarList emitted ["a","a",coord,...].
          // Detect by tag[1] === "a" and shift fields back to the correct positions.
          // Self-healing: the next updateCalendarList write re-encodes correctly.
          const coord = tag[2] ?? "";
          if (coord && coord !== "a") eventRefs.push([coord, tag[3] ?? "", tag[4] ?? ""]);
        } else {
          // Normal format: ["a", coordinate, relayHint?, viewKey?]
          eventRefs.push([tag[1], tag[2] ?? "", tag[3] ?? ""]);
        }
        break;
    }
  }

  return {
    id: dTag,
    eventId,
    title,
    description,
    color,
    eventRefs,
    createdAt: 0,
    isVisible: true,
    notificationPreference,
  };
}
