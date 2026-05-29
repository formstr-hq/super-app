import { create } from "zustand";
import type { Filter } from "nostr-tools";
import {
  signerManager,
  nostrRuntime,
  relayManager,
  type SubscriptionHandle,
} from "@formstr/core";
import {
  extractInvitationFromWrap,
  type InvitationRumor,
} from "../services/calendar/rsvp";
import {
  fetchCalendarEventByCoordinate,
} from "../services/calendar/service";
import { CALENDAR_KINDS, type CalendarEvent } from "../services/calendar/types";
import { useCalendarStore } from "./calendarStore";

export interface InvitationEntry extends InvitationRumor {
  /** Resolved event, when we've been able to fetch it from relays. */
  event?: CalendarEvent;
  /** Locally-persisted RSVP response so the inbox doesn't show stale items. */
  rsvp?: "accepted" | "declined" | "tentative";
}

interface InvitationsStore {
  invitations: InvitationEntry[];
  subscription: SubscriptionHandle | null;
  isSubscribing: boolean;
  start(): Promise<void>;
  stop(): void;
  markRsvp(coord: string, status: "accepted" | "declined" | "tentative"): void;
  dismiss(wrapId: string): void;
  hasPending(): boolean;
}

export const useInvitationsStore = create<InvitationsStore>((set, get) => ({
  invitations: [],
  subscription: null,
  isSubscribing: false,

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
          // Guard upstream PR-105 race: resolve the referenced event *before*
          // exposing it to the UI — otherwise the user could tap Accept on a
          // stale/missing coordinate.
          const event = await fetchCalendarEventByCoordinate(invitation.eventCoordinate);
          if (event) {
            // Feed into the main calendar store so month view renders it too.
            useCalendarStore.getState().ingestEvent({ ...event, isInvitation: true });
          }
          set((state) => {
            if (state.invitations.some((i) => i.wrapId === invitation.wrapId)) return state;
            return {
              invitations: [
                { ...invitation, event: event ?? undefined },
                ...state.invitations,
              ],
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
