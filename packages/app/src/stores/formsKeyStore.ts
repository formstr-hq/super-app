import {
  signerManager,
  nostrRuntime,
  relayManager,
  unwrapEvent,
  type SubscriptionHandle,
} from "@formstr/core";
import type { Event, Filter } from "nostr-tools";
import { create } from "zustand";

import { FORM_VIEW_KEY_RUMOR_KIND, FORM_VIEW_KEY_TAG, hexToBytes } from "../services/forms/keys";
import { FORM_KINDS } from "../services/forms/types";

interface FormsKeyStore {
  /** coord → view secret bytes */
  viewKeys: Record<string, Uint8Array>;
  subscription: SubscriptionHandle | null;
  isSubscribing: boolean;
  start(): Promise<void>;
  stop(): void;
  /**
   * Stash a view key locally — used right after the author creates a form so
   * they can decrypt their own content without waiting for the gift-wrap to
   * bounce back from relays.
   */
  remember(coord: string, secret: Uint8Array): void;
}

/**
 * Subscribes to NIP-59 gift-wraps (kind 1059) addressed to the current
 * identity, unwraps them, and caches any view secret rumor we find so
 * `fetchForm()` can decrypt view-key-encrypted form fields.
 *
 * Mirrors `invitationsStore` so the two live alongside each other and reuse
 * the same subscribe-once lifecycle.
 */
export const useFormsKeyStore = create<FormsKeyStore>((set, get) => ({
  viewKeys: {},
  subscription: null,
  isSubscribing: false,

  async start() {
    if (get().subscription || get().isSubscribing) return;
    set({ isSubscribing: true });

    try {
      const signer = await signerManager.getSigner();
      const pubkey = await signer.getPublicKey();
      const relays = relayManager.getRelaysForModule("forms");

      const filters: Filter[] = [{ kinds: [FORM_KINDS.giftWrap], "#p": [pubkey] }];

      const handle = nostrRuntime.subscribe(relays, filters, {
        onEvent: async (wrap: Event) => {
          try {
            const unwrapped = await unwrapEvent(wrap, signer);
            if (!unwrapped || unwrapped.kind !== FORM_VIEW_KEY_RUMOR_KIND) return;
            const coord = unwrapped.tags.find((t: string[]) => t[0] === "a")?.[1];
            const hex = unwrapped.tags.find((t: string[]) => t[0] === FORM_VIEW_KEY_TAG)?.[1];
            if (!coord || !hex) return;
            const secret = hexToBytes(hex);
            set((state) => ({
              viewKeys: { ...state.viewKeys, [coord]: secret },
            }));
          } catch {
            // Wrap wasn't ours or not a forms rumor; silently ignore.
          }
        },
      });

      set({ subscription: handle, isSubscribing: false });
    } catch {
      set({ isSubscribing: false });
    }
  },

  stop() {
    get().subscription?.unsub();
    set({ subscription: null });
  },

  remember(coord, secret) {
    set((state) => ({
      viewKeys: { ...state.viewKeys, [coord]: secret },
    }));
  },
}));
