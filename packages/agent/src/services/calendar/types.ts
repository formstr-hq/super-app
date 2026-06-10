import type { Event } from "nostr-tools";

// ── Event Kinds ─────────────────────────────────────────
export const CALENDAR_KINDS = {
  publicEvent: 31923,
  privateEvent: 32678,
  privateRecurring: 32679,
  calendarList: 32123,
  giftWrap: 1052,
  rumor: 52,
  publicRsvp: 31925,
  privateRsvp: 32069,
  rsvpGiftWrap: 1055,
  rsvpRumor: 55,
  participantRemoval: 84,
  // Appointment scheduling (Calendly-style booking links).
  schedulingPage: 31927,
  schedulingPagesList: 32680,
  bookingRequestGiftWrap: 1057,
  bookingRequestRumor: 57,
  bookingResponseGiftWrap: 1058,
  bookingResponseRumor: 58,
} as const;

// ── Data Structures ─────────────────────────────────────

export enum RSVPStatus {
  accepted = "accepted",
  declined = "declined",
  tentative = "tentative",
  pending = "pending",
}

export enum RepeatingFrequency {
  None = "None",
  Daily = "Daily",
  Weekly = "Weekly",
  Weekday = "Weekday",
  Monthly = "Monthly",
  Quarterly = "Quarterly",
  Yearly = "Yearly",
}

export interface CalendarEvent {
  id: string;
  eventId: string;
  title: string;
  description: string;
  kind: number;
  begin: number; // ms timestamp
  end: number; // ms timestamp
  createdAt: number;
  image?: string;
  categories: string[];
  participants: string[];
  location: string[];
  website: string;
  user: string; // author pubkey
  isPrivate: boolean;
  viewKey?: string;
  repeat: { rrule: string | null };
  startTzid?: string; // IANA timezone identifier (matches upstream "start_tzid")
  endTzid?: string;
  registrationFormRef?: string; // naddr of a Formstr form used as registration
  /**
   * Read-only viewKey for an encrypted registration form, carried as the 3rd
   * element of the upstream ["form", naddr, viewKey] row. Never the form's
   * signing/response key — that would grant invitees write access to the form.
   */
  registrationFormViewKey?: string;
  /** Upstream ["notification", pref] row (device-local reminder preference). */
  notificationPreference?: string;
  calendarId?: string;
  isInvitation?: boolean;
  relayHint?: string;
  event?: Event;
}

export interface CalendarList {
  id: string;
  eventId: string;
  title: string;
  description: string;
  color: string;
  eventRefs: string[][];
  createdAt: number;
  isVisible: boolean;
  /**
   * Upstream ["notifications","disabled"] row. Only the non-default
   * ("disabled") value is persisted on the wire; round-tripping it keeps the
   * preference set in calendar.formstr.app intact across super-app edits.
   */
  notificationPreference?: "enabled" | "disabled";
}

export interface RSVPResponse {
  pubkey: string;
  status: RSVPStatus;
  eventCoordinate: string;
  createdAt: number;
  /** Unix seconds — responder's "suggest a new time" proposal. */
  suggestedStart?: number;
  suggestedEnd?: number;
  /** Free-text note the responder attached to their RSVP. */
  comment?: string;
}

export interface CalendarEventDraft {
  title: string;
  description: string;
  begin: Date;
  end: Date;
  location?: string;
  categories?: string[];
  participants?: string[];
  isPrivate?: boolean;
  calendarId?: string;
  repeat?: RepeatingFrequency;
  rrule?: string; // RFC-5545 RRULE string (takes precedence over repeat)
  startTzid?: string;
  endTzid?: string;
  registrationFormRef?: string;
  /** Read-only viewKey for an encrypted registration form (see CalendarEvent). */
  registrationFormViewKey?: string;
  /** Reminder preference written as the upstream ["notification", pref] row. */
  notificationPreference?: string;
  image?: string;
  website?: string;
  /** When updating, re-use the same addressable `d` identifier. */
  existingId?: string;
  /**
   * When editing a private event, re-use its existing viewKey (nsec) so prior
   * invitees keep decryption access. Omitted on create → a fresh key is minted.
   */
  viewKey?: string;
}
