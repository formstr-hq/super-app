import { parseInvitationRumor, unwrapEvent, type Invitation } from "@formstr/calendar-sdk";
import { nostrRuntime, type SubscriptionHandle } from "@formstr/core";
import type { Event } from "nostr-tools";

/** The pre-1059 wrap kind this app used to write. */
const LEGACY_WRAP_KIND = 1052;

/** Structural signer the SDK's `unwrapEvent` accepts. */
type Unwrapper = Parameters<typeof unwrapEvent>[1];

/**
 * Reads invitations the super-app sent before it moved to kind-1059 wraps.
 *
 * `invitationInboxFilters()` in the SDK queries kind 1059 carrying
 * `["k","1052"]` only, so a wrap written by an older build of this app is
 * invisible to it. calendar.formstr.app v2.1.0 reads both kinds; until the SDK
 * does too, this fills the gap. See docs/sdk/calendar-sdk-followups.md item 4.
 */
export function subscribeToLegacyInvitations(
  pubkey: string,
  relays: string[],
  signer: Unwrapper,
  onInvitation: (invitation: Invitation) => void,
): SubscriptionHandle {
  return nostrRuntime.subscribe(relays, [{ kinds: [LEGACY_WRAP_KIND], "#p": [pubkey] }], {
    onEvent: (wrap: Event) => {
      void (async () => {
        try {
          const rumor = await unwrapEvent(wrap, signer);
          const invitation = parseInvitationRumor(rumor, wrap.id);
          if (invitation) onInvitation(invitation);
        } catch {
          // Unverifiable or undecryptable wrap — not ours to render.
        }
      })();
    },
  });
}
