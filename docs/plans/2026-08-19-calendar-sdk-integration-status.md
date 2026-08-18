# Calendar SDK integration — status and resume notes

Written 2026-08-19, at the end of the implementation session. Delete this file
before merge; it is scaffolding, not documentation.

- **Branch:** `calendar-sdk-integration`, based on `dev`, merge-base `8fb8373`.
- **State:** implementation complete and live-verified. Nothing pushed. No PR opened.
- **Design:** [2026-08-18-calendar-sdk-integration.md](2026-08-18-calendar-sdk-integration.md)
- **Plan:** [2026-08-18-calendar-sdk-integration-plan.md](2026-08-18-calendar-sdk-integration-plan.md)
- **SDK follow-ups:** [../sdk/calendar-sdk-followups.md](../sdk/calendar-sdk-followups.md)

## What this branch did

Replaced the super-app's own calendar protocol implementation with the published
`@formstr/calendar-sdk@0.1.0`. Net: **1,651 insertions, 4,323 deletions** across 51
files, of which 3,666 deleted lines were the duplicated protocol in
`packages/agent/src/services/calendar/`.

It is not only deduplication. The super-app was the **stale** side of the wire:
calendar.formstr.app v2.1.0 had already moved to kind-1059 invitation wraps and
kind-5 dismissals while this app still wrote kind 1052 and kind 84. The
integration brings the app onto the current format.

## Commits

| Commit    | What                                             |
| --------- | ------------------------------------------------ |
| `96c67e5` | design doc                                       |
| `60ada42` | SDK follow-ups tracker                           |
| `ddfda33` | implementation plan                              |
| `21d8b1f` | depend on `@formstr/calendar-sdk@^0.1.0`         |
| `a80da6f` | SDK factories in both packages (+ logout reset)  |
| `932e18a` | event-discovery composer                         |
| `00f3171` | booking rebuilt on SDK types and primitives      |
| `083e466` | all 20 agent tools served from the SDK           |
| `1e40356` | app calendar store on the SDK                    |
| `581adb5` | invitation inbox + legacy kind-1052 reader       |
| `169a1a9` | remaining app call sites flipped                 |
| `b609280` | **deleted the duplicated service (3,666 lines)** |
| `5bcb1fe` | docs                                             |
| `49e2aa0` | fix: decode arriving invitation wraps directly   |

## Gates (all green at `49e2aa0`)

```
corepack pnpm --filter @formstr/agent test      # 270 tests / 22 files
corepack pnpm --filter @formstr/app test        # 399 tests / 69 files
corepack pnpm -r typecheck                      # includes mcp
corepack pnpm --filter @formstr/app build       # tsc -b && vite build
```

Baselines on `dev` before the work: agent 357/25, app 381/66. The agent count
_drops_ because the deleted files took ~100 of their own tests with them; that
behaviour is covered by the SDK's suite upstream.

## Where the calendar lives now

| Concern                                                                                    | Location                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Protocol (events, lists, invitations, RSVPs, busy lists, deletions, view keys, recurrence) | `@formstr/calendar-sdk` — not in this repo                                             |
| SDK factory (app)                                                                          | `packages/app/src/lib/calendar/sdk.ts`                                                 |
| SDK factory (agent)                                                                        | `packages/agent/src/services/calendar/sdk.ts`                                          |
| App types                                                                                  | `packages/app/src/lib/calendar/types.ts` — `AppCalendarEvent`, `AppCalendarEventDraft` |
| Event discovery composer                                                                   | `packages/agent/src/services/calendar/discovery.ts`                                    |
| Booking / scheduling pages                                                                 | `packages/agent/src/services/calendar/booking.ts`                                      |
| Legacy kind-1052 invitation reads                                                          | `packages/app/src/lib/calendar/legacyInvitations.ts`                                   |
| ICS timezone recovery                                                                      | `packages/app/src/lib/ics.ts`                                                          |

Both factories build a `CalendarSDK` from the singletons that already exist:
signer from `signerManager`, injected runtime from `nostrRuntime` (so the SDK
shares core's pool instead of opening its own), relays from
`relayManager.getRelaysForModule("calendar")`. The instance is memoized on
`(signer identity, pubkey, relay set)`.

## Traps — read before touching this code

These cost real time to find. All are documented as follow-ups.

1. **`toCalendarSigner` is unusable.** The published adapter declares
   `signEvent(event: never): Promise<never>`; no real signer is assignable (the
   _return_ type is the blocker). Both packages hand-roll a bound object literal
   instead. Do not "fix" it with a cast.
2. **`parseCalendarEvent` is a pure codec.** It never decrypts and never throws.
   Its `viewKey` option is only recorded on the result; decrypted rows must be
   passed as `options.payload`. Decrypt with `decryptWithViewKey` first — or just
   use the `sdk.*` service methods, which do it internally.
3. **`sdk.fetchEvents()` returns only calendar-list-referenced events** and
   filters **no NIP-09 deletions**. That is the entire reason `discovery.ts`
   exists.
4. **`updatePrivateEvent` requires `previousParticipants`.** Omit it and every
   edit gift-wraps a fresh invitation at the whole guest list.
5. **The SDK's `createWrap` hardcodes kind 1059.** Booking must still write 1058,
   so it keeps using core's `wrapEvent`, which takes the kind as a parameter.
6. **An unlinked private event is unreachable by anyone.** Its view key lives
   only in a calendar list's `eventRef`. Do not add a "direct private query" —
   one was specified, written, and deleted for exactly this reason.

## Wire-format changes

| Concern                   | Before                      | After                                     |
| ------------------------- | --------------------------- | ----------------------------------------- |
| Invitation wrap           | kind 1052, rumor 52         | kind 1059 + `["k","1052"]`, rumor kind 14 |
| Dismissal                 | kind 84 participant removal | NIP-09 kind 5 deletion                    |
| `start_tzid` / `end_tzid` | written and parsed          | neither (upstream writes none)            |

Accepted regressions, all in the design doc: a dismissal recorded by an older
build can resurface once; new events export to ICS as UTC (pre-migration events
keep their timezone, read off the raw wire event).

## Live verification (2026-08-19, real relays)

Two throwaway keys, isolated dev servers on `:5174` (organiser) and `:5175`
(invitee) so the account on `:5173` was untouched. Keys were disposable and are
not recorded here; the events are still queryable by pubkey:

- organiser `519aefac5bf1c0dc3a568ecb13b829d6a0720802a6107f985e1a794dc9573ebd`
- invitee `9c09e0cea8f67cf0612591d64e20d913f8cacd94b785f2cd5f1cd85e6f0ab4fe`

All seven checks passed:

1. Private event round-trip — kinds 32678 + 32123 + 31926 published, renders and
   decrypts on reload.
2. **Invitation published as kind 1059 carrying `["k","1052"]`.**
3. **Edit did not re-invite** — same `d`-tag republished with a newer
   `created_at`, wraps to the invitee stayed at exactly 1.
4. Invitee received it showing the _edited_ title.
5. RSVP published as kind 32069 with an `a` tag on the organiser's coordinate
   (the standalone-compatible path); organiser reads it back as accepted.
6. **calendar.formstr.app rendered the event** for the organiser's key, 6/6
   relays.
7. Deletion sweep — delete published kind 5 and unlinked the ref; the relay still
   serves the stale 32678 and the app does not resurrect it.

Not verified live: the ICS carried-tzid path, which needs a pre-migration event.
Covered by unit tests.

## Rulings made during implementation

Each of these was a judgement call taken without asking. Reverse any you disagree
with.

1. **Discovery composer lives in the agent, not the app** (deviating from the
   design doc). The MCP `list_calendar_events` tool needs the identical
   composition, and layering lets the app import from the agent but not the
   reverse — app-side would have been duplicated immediately.
2. **Deleted the specified `fetchOwnPrivateEvents` direct query.** It guarded on
   `if (!viewKey) continue` and view keys come only from list refs, so it could
   only ever return a strict subset of what `fetchEventsFromCalendars` returns,
   at the cost of an extra relay round trip.
3. **Hand-rolled `toCalendarSigner` rather than casting** (trap 1 above).
4. **Booking keeps core's `wrapEvent` for writes, adopts the SDK's `unwrapEvent`
   for reads.** The plan contradicted itself; the spec's "booking wire format
   unchanged" won, and the SDK's stricter NIP-59 verification came along for free
   on the read side.
5. **`approveBookingRequest` keeps its return shape**, because the booking tools
   were meant to stay untouched.
6. **Dropped `startTzid` from the create/update tool schemas** rather than accept
   input the SDK silently discards.
7. **`rsvp_event` keeps `isPrivate` in its schema but ignores it** — the SDK
   picks the path from the coordinate's kind; removing the field would break
   existing callers.
8. **App typecheck gates at the end**, not per-commit; type incoherence between
   the store and not-yet-flipped components was expected mid-sequence. Individual
   commits between `1e40356` and `169a1a9` do not typecheck on their own.
9. **`isVisible` removed from calendar fixtures** — a super-app-only field the
   SDK's `CalendarList` never had; visibility is `CalendarPage` state.
10. **Exported `toCalendarSigner` from the app factory** once the legacy reader
    needed it (reversing half of an earlier ruling).

## What is left

1. **Push and open the PR** — the only remaining plan step:
   ```bash
   git push -u origin calendar-sdk-integration
   gh pr create --base dev --title "Integrate @formstr/calendar-sdk" --body "…"
   ```
   The PR body should state the wire-format change, the accepted regressions, and
   link the design doc and the follow-ups tracker. No AI attribution.
2. **Optional second opinion** — `/code-review` over the branch. Tasks 5-10 were
   reviewed by me rather than a fresh reviewer, after subagent dispatch was
   declined mid-session.
3. **Delete this file** before merge.

## Resuming in a new session

`CLAUDE.md` (gitignored, loads automatically) carries a condensed version of the
traps and the state. Start there, then read this file for detail. The SDD ledger
with the full per-task history, including every review finding and fix round,
is at `.superpowers/sdd/2026-08-18-calendar-sdk-integration-plan/progress.md` —
also gitignored, and it will not survive `git clean -fdx`.
