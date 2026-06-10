import {
  extractInvitationFromWrap,
  type InvitationRumor,
} from "@formstr/agent/services/calendar/rsvp";
import {
  fetchCalendarEventByCoordinate,
  fetchParticipantRemovals,
  getInvitationInboxRelays,
  publishParticipantRemovalEvent,
} from "@formstr/agent/services/calendar/service";
import { CALENDAR_KINDS, type CalendarEvent } from "@formstr/agent/services/calendar/types";
import { signerManager, nostrRuntime, type SubscriptionHandle } from "@formstr/core";
import type { Filter } from "nostr-tools";
import { create } from "zustand";

import { useCalendarStore } from "./calendarStore";

export interface InvitationEntry extends InvitationRumor {
  event?: CalendarEvent;
  rsvp?: "accepted" | "declined" | "tentative";
}

interface InvitationsStore {
  invitations: InvitationEntry[];
  isSubscribing: boolean;
  subscription: SubscriptionHandle | null;
  start(): Promise<void>;
  stop(): void;
  markRsvp(coord: string, status: "accepted" | "declined" | "tentative"): void;
  dismiss(wrapId: string): void;
  hasPending(): boolean;
}

export const useInvitationsStore = create<InvitationsStore>((set, get) => ({
  invitations: [],
  isSubscribing: false,
  subscription: null,

  async start() {
    if (get().subscription || get().isSubscribing) return;
    set({ isSubscribing: true });
    try {
      const signer = await signerManager.getSigner();
      const pubkey = await signer.getPublicKey();
      // Module relays ∪ the user's NIP-65 read relays: upstream delivers each
      // wrap to the recipient's own relay list, not to our module set.
      const relays = await getInvitationInboxRelays(pubkey);
      // The user's own kind-84 opt-outs — dismissed invitations stay gone
      // across sessions (the relays keep serving the wraps).
      const removals = await fetchParticipantRemovals(pubkey, relays);
      const filters: Filter[] = [
        { kinds: [CALENDAR_KINDS.giftWrap, CALENDAR_KINDS.rsvpGiftWrap], "#p": [pubkey] },
      ];
      const handle = nostrRuntime.subscribe(relays, filters, {
        onEvent: (wrap) => {
          void (async () => {
            if (removals.ids.has(wrap.id)) return;
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
          })();
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
    // Persist the opt-out as a kind-84 participant removal e-tagging the wrap,
    // exactly as upstream does on dismiss — otherwise the invitation
    // resurfaces every session and calendar.formstr.app never learns of it.
    void publishParticipantRemovalEvent({
      kinds: [CALENDAR_KINDS.giftWrap],
      eventIds: [wrapId],
    }).catch(() => {
      // Best-effort: the local dismissal still applies this session.
    });
    set((state) => ({ invitations: state.invitations.filter((i) => i.wrapId !== wrapId) }));
  },

  hasPending() {
    return get().invitations.some((i) => !i.rsvp);
  },
}));
