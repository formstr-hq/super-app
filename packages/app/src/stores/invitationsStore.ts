import { parseInvitationRumor, unwrapEvent, type Invitation } from "@formstr/calendar-sdk";
import { signerManager, type SubscriptionHandle } from "@formstr/core";
import type { Event } from "nostr-tools";
import { create } from "zustand";

import { subscribeToLegacyInvitations } from "../lib/calendar/legacyInvitations";
import { getCalendarSdk, toCalendarSigner } from "../lib/calendar/sdk";
import type { AppCalendarEvent } from "../lib/calendar/types";

import { useCalendarStore } from "./calendarStore";

export interface InvitationEntry extends Invitation {
  event?: AppCalendarEvent;
  rsvp?: "accepted" | "declined" | "tentative";
}

interface InvitationsStore {
  invitations: InvitationEntry[];
  isSubscribing: boolean;
  subscription: SubscriptionHandle | null;
  legacySubscription: SubscriptionHandle | null;
  start(): Promise<void>;
  stop(): void;
  markRsvp(coord: string, status: "accepted" | "declined" | "tentative"): void;
  dismiss(giftWrapId: string): void;
  hasPending(): boolean;
}

export const useInvitationsStore = create<InvitationsStore>((set, get) => ({
  invitations: [],
  isSubscribing: false,
  subscription: null,
  legacySubscription: null,

  async start() {
    if (get().subscription || get().isSubscribing) return;
    set({ isSubscribing: true });
    try {
      const sdk = await getCalendarSdk();
      const rawSigner = await signerManager.getSigner();
      const calendarSigner = toCalendarSigner(rawSigner);
      const pubkey = await rawSigner.getPublicKey();

      /** Resolve an invitation's event and fold it into state, once per wrap. */
      const ingest = async (invitation: Invitation) => {
        if (get().invitations.some((i) => i.giftWrapId === invitation.giftWrapId)) return;
        const event = await sdk.fetchEventByCoordinate(invitation.coordinate, {
          viewKey: invitation.viewKey,
          relays: invitation.relayHint ? [invitation.relayHint] : undefined,
        });
        if (event) {
          useCalendarStore.getState().ingestEvent({ ...event, isInvitation: true });
        }
        set((state) => {
          if (state.invitations.some((i) => i.giftWrapId === invitation.giftWrapId)) return state;
          return {
            invitations: [{ ...invitation, event: event ?? undefined }, ...state.invitations],
          };
        });
      };

      // Seed from a one-shot query first: it honours the user's kind-5
      // dismissals, which the live subscription below cannot see.
      for (const invitation of await sdk.fetchInvitationsWithEvents()) {
        const { event, ...rest } = invitation;
        if (event) useCalendarStore.getState().ingestEvent({ ...event, isInvitation: true });
        set((state) =>
          state.invitations.some((i) => i.giftWrapId === rest.giftWrapId)
            ? state
            : { invitations: [{ ...rest, event: event ?? undefined }, ...state.invitations] },
        );
      }

      // Decode the arriving wrap directly. Re-querying the inbox to find it
      // again would be a round trip that can miss: a relay's `limit` is applied
      // to its own ordering, not to "the one that just arrived".
      const decode = async (wrap: Event) => {
        try {
          const rumor = await unwrapEvent(wrap, calendarSigner);
          const invitation = parseInvitationRumor(rumor, wrap.id);
          if (invitation) await ingest(invitation);
        } catch {
          // Unverifiable or undecryptable wrap — not ours to render.
        }
      };

      const subscription = sdk.subscribeToInvitations(pubkey, (wrap: Event) => void decode(wrap));

      // Wraps written by older super-app builds are bare kind 1052 and the
      // SDK's inbox filter never sees them. calendar.formstr.app reads both.
      const legacySubscription = subscribeToLegacyInvitations(
        pubkey,
        [...sdk.relays],
        calendarSigner,
        (invitation) => void ingest(invitation),
      );

      set({ subscription, legacySubscription, isSubscribing: false });
    } catch {
      set({ isSubscribing: false });
    }
  },

  stop() {
    get().subscription?.unsub();
    get().legacySubscription?.unsub();
    set({ subscription: null, legacySubscription: null, invitations: [] });
  },

  markRsvp(coord, status) {
    set((state) => ({
      invitations: state.invitations.map((i) =>
        i.coordinate === coord ? { ...i, rsvp: status } : i,
      ),
    }));
  },

  dismiss(giftWrapId) {
    // Persist the opt-out as a NIP-09 deletion of the wrap, which is what the
    // SDK's inbox honours and what calendar.formstr.app writes — otherwise the
    // invitation resurfaces on every load.
    const invitation = get().invitations.find((i) => i.giftWrapId === giftWrapId);
    if (invitation) {
      void (async () => (await getCalendarSdk()).dismissInvitation(invitation))().catch(() => {
        // Best-effort: the local dismissal still applies this session.
      });
    }
    set((state) => ({
      invitations: state.invitations.filter((i) => i.giftWrapId !== giftWrapId),
    }));
  },

  hasPending() {
    return get().invitations.some((i) => !i.rsvp);
  },
}));
