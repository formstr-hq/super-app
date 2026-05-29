// WIP — excluded from tsconfig.json until the underlying service/store
// methods land in weeks 5-6 (calendar) / 9-10 (AI). See
// docs/superpowers/specs/2026-05-27-week-1-2-foundation-design.md.
// @ts-nocheck

// Stub: the full implementation is commented out because it calls
// CalendarStore.ingestEvent and calendarService.fetchCalendarEventByCoordinate
// which land in weeks 5-6. The interface and store shape are preserved so
// existing consumers (InvitationInbox.tsx, stores/index.ts) keep compiling.
import { create } from "zustand";

import type { InvitationRumor } from "../services/calendar/rsvp";
import type { CalendarEvent } from "../services/calendar/types";

export interface InvitationEntry extends InvitationRumor {
  /** Resolved event, when we've been able to fetch it from relays. */
  event?: CalendarEvent;
  /** Locally-persisted RSVP response so the inbox doesn't show stale items. */
  rsvp?: "accepted" | "declined" | "tentative";
}

interface InvitationsStore {
  invitations: InvitationEntry[];
  isSubscribing: boolean;
  start(): Promise<void>;
  stop(): void;
  markRsvp(coord: string, status: "accepted" | "declined" | "tentative"): void;
  dismiss(wrapId: string): void;
  hasPending(): boolean;
}

export const useInvitationsStore = create<InvitationsStore>((set, get) => ({
  invitations: [],
  isSubscribing: false,

  async start() {
    // No-op until CalendarStore.ingestEvent + fetchCalendarEventByCoordinate land (weeks 5-6).
  },

  stop() {
    set({ invitations: [] });
  },

  markRsvp(coord, status) {
    set((state) => ({
      invitations: state.invitations.map((i) =>
        i.eventCoordinate === coord ? { ...i, rsvp: status } : i,
      ),
    }));
  },

  dismiss(wrapId) {
    set((state) => ({
      invitations: state.invitations.filter((i) => i.wrapId !== wrapId),
    }));
  },

  hasPending() {
    return get().invitations.some((i) => !i.rsvp);
  },
}));

/* ── Full WIP implementation (uncomment when CalendarStore.ingestEvent +
   fetchCalendarEventByCoordinate land in weeks 5-6) ───────────────────────

import { signerManager, nostrRuntime, relayManager, type SubscriptionHandle } from "@formstr/core";
import type { Filter } from "nostr-tools";

import { extractInvitationFromWrap } from "../services/calendar/rsvp";
import { fetchCalendarEventByCoordinate } from "../services/calendar/service";
import { CALENDAR_KINDS } from "../services/calendar/types";

import { useCalendarStore } from "./calendarStore";

  subscription: SubscriptionHandle | null;   // add to InvitationsStore interface

  async start() {
    if (get().subscription || get().isSubscribing) return;
    set({ isSubscribing: true });

    try {
      const signer = await signerManager.getSigner();
      const pubkey = await signer.getPublicKey();
      const relays = relayManager.getRelaysForModule("calendar");

      const filters: Filter[] = [
        { kinds: [CALENDAR_KINDS.giftWrap, CALENDAR_KINDS.rsvpGiftWrap], "#p": [pubkey] },
      ];

      const handle = nostrRuntime.subscribe(relays, filters, {
        onEvent: async (wrap) => {
          const invitation = await extractInvitationFromWrap(wrap);
          if (!invitation) return;
          const event = await fetchCalendarEventByCoordinate(invitation.eventCoordinate);
          if (event) {
            useCalendarStore.getState().ingestEvent({ ...event, isInvitation: true });
          }
          set((state) => {
            if (state.invitations.some((i) => i.wrapId === invitation.wrapId)) return state;
            return {
              invitations: [{ ...invitation, event: event ?? undefined }, ...state.invitations],
            };
          });
        },
      });

      set({ subscription: handle, isSubscribing: false });
    } catch {
      set({ isSubscribing: false });
    }
  },

  stop() {
    get().subscription?.unsub();
    set({ subscription: null, invitations: [] });
  },
─────────────────────────────────────────────────────────────────────────── */
