# Polls (nostr-polls) Interop & Parity — Design Spec

> **Goal:** bring the super-app **Polls** module to true bidirectional wire-compatibility / sync
> with the standalone **nostr-polls** (`upstream/nostr-polls/`), the same way Forms, Calendar, and
> Pages were done. Exact tags, correct vote tallying, delete-that-sticks, cross-app vote sync, full
> MCP coverage, and an Option-A monochrome two-pane UI.
> **Branch:** `polls-interop-parity` (off `pages-interop-parity`). **Date:** 2026-06-06.
> **Companion:** UI mockups (approved) in `.superpowers/brainstorm/528590-1780769204/content/`
> (`polls-layout.html`, `polls-dialogs.html`).

---

## 1. Scope (locked with the user)

**In scope**

- **Core polls (NIP-88):** create / list / open / vote / results / delete public polls (kind 1068) and
  responses (kind 1018).
- **Vote correctness:** dedup **latest-response-per-pubkey by `created_at`** (single source of truth for
  tallies); honor poll expiry (`endsAt`) in both UI and tally window.
- **Delete that sticks:** apply NIP-09 (kind 5) deletions on load — for deleted **polls** and for
  **cleared votes** — so they don't reappear/recount after refresh (same fix shipped for calendar & pages).
- **Cross-app vote sync:** publish votes to (and read tallies from) the **poll's own `["relay", …]` tags**
  unioned with the module relays, so a vote cast in either app reaches where the other app reads.
- **Manage:** Delete poll (author) and Clear my votes (any voter) via NIP-09. **No edit** (see §6).
- **UI:** Layout-A two-pane workspace — left rail (New Poll · My Polls · Discover · topics), right pane =
  poll detail with selectable options, live result bars, Vote/Update, and a ⋯ manage menu. Create dialog.
- **MCP:** expose every poll function (gated/confirm for writes), mirroring calendar/pages.

**Out of scope** (mirrors calendar/pages "parity + polish, no heavy subsystems")

- The standalone's **social app**: global feed-of-everyone as the primary surface, follows/contacts,
  profiles, reports / web-of-trust moderation, zaps, notifications, movies/articles/ratings, DMs.
- **Proof-of-Work** anti-spam (mined vote nonces + `#W` difficulty filter).
- **Ranked-choice** polls (shipped **disabled** in the standalone — would be super-app-only, no parity).
- **Anonymous voting** via ephemeral keys — the super-app votes on the logged-in identity. (Anonymous
  votes authored elsewhere are still read and counted normally.)

**Testing:** backend only — `services/polls/**` (service) + `stores/pollsStore` + `mcp` tests, TDD.
**No new frontend component tests** (standing directive).

---

## 2. Standalone wire format (source of truth)

Vendored snapshot: `upstream/nostr-polls/`. **Polls are fully public** — there is no viewKey/encryption
model (unlike calendar/pages). Interop is about exact tags, relay overlap, and tally/delete correctness.

### Event kinds (`src/constants/nostr.ts`)

| Kind     | Purpose                                                                                 | Super-app handling |
| -------- | --------------------------------------------------------------------------------------- | ------------------ |
| **1068** | Poll (regular, **non-replaceable** — keyed by event id). Public.                        | create/list/delete |
| **1018** | Poll response / vote. Public.                                                           | submit/tally       |
| **1070** | Legacy response kind — **read** in tallies, never written.                              | read in tally      |
| **5**    | NIP-09 deletion. Deletes a poll (author) or a voter's own responses ("clear my votes"). | fetch + filter     |

### Poll event — kind 1068 (`components/EventCreator/PollTemplateForm.tsx:215-230`)

- `content` = the poll question (free text; may carry `nostr:` mentions / `#hashtags`).
- tags:
  - `["option", <optionId>, <label>]` — one per option (`optionId` is a short random string).
  - `["relay", <url>]` — one per relay the author expects votes on (**where votes are published/read**).
  - `["polltype", "singlechoice" | "multiplechoice"]` (`"rankedchoice"` exists but is disabled upstream).
  - `["endsAt", <unixSeconds>]` — optional expiry.
  - `["t", <hashtag>]` — optional topics; plus optional mention/quote tags (`["p",…]`, `["q",…]`),
    and `["PoW", <n>]` (out of scope here).
  - optional `["label", <question>]` — read as a **fallback** for the question when present
    (`PollResponseForm.tsx:133`); super-app reads it but writes the question in `content`.

### Response event — kind 1018 (`components/PollResponse/PollResponseForm.tsx:293-299`)

- `content` = `""`.
- tags: `["e", <pollId>]`, `["p", <pollAuthorPubkey>]`, then `["response", <optionId>]` per selected option
  (one for single-choice, N for multiple-choice).
- Published to the poll's `["relay"]` tags if present, else the user's relays
  (`PollResponseForm.tsx:311-313`).

### Tally (`hooks/usePollResults.ts`)

- Subscribe `{ "#e": [pollId], kinds: [1070, 1018] }` on (poll relays ∪ user relays); if the poll has
  `endsAt`, add `until: endsAt`.
- **Dedup: keep only the latest response per pubkey by `created_at`** (`uniqueResponses`). Then count
  `["response", optionId]` tags. Per-option **percentage = count / Σ(all option counts)**; `totalVotes` =
  number of unique voters.

### Deletion (`utils/deletion.ts`, `PollResponseForm.tsx:182-226`)

- Delete poll → `publishDeletion([pollId], [1068], relays)` ⇒ kind-5 `["e", pollId]` + `["k","1068"]`.
- Clear my votes → query the voter's own `[1018,1070]` with `#e`=pollId, then `publishDeletion(ids, kinds)`.

### Relays (`src/nostr/index.ts:7`)

`defaultRelays` = damus.io · primal.net · nos.lol · relay.nostr.wirednet.jp · nostr-01.yakihonne.com ·
nostr21.com (plus each user's NIP-65 outbox relays). The super-app's `polls` module defaults
(`core/relay/module-defaults.ts:33`) **already equal this set** — no relay-union change needed for module
defaults; the remaining sync fix is per-poll relay targeting (§5.1).

---

## 3. Current super-app polls module — gap analysis

Files: `packages/app/src/{services/polls/{service,types}.ts,stores/pollsStore.ts,pages/PollsPage.tsx}`,
`packages/mcp/src/tools/polls.ts`. The wire format is **already largely correct** (kinds 1068/1018/1070;
`option`/`relay`/`polltype`/`endsAt`/`t` tags; response `e`/`p`/`response` tags; content=question), and the
module relay defaults already match upstream. Gaps:

1. **Vote dedup keeps the _first_ response, not the latest** (`service.ts:155-161` `if (!existing) …`); the
   live `subscribeToPollResults` overwrites by **arrival order** (`service.ts:131-133`). A voter who changes
   their vote is mis-counted, and a re-vote never supersedes. **Fix: latest-by-`created_at` per pubkey** in
   both paths.
2. **No NIP-09 deletion handling on load.** Deleted polls still list; "cleared" votes still count. **Fix:
   port `fetchDeletions`/`isDeleted` from calendar/pages; filter polls (deleted by author) and responses
   (deleted by their voter) on load.**
3. **Votes published to the wrong relays.** `submitPollResponse` and the results queries use only
   `getRelaysForModule("polls")`, ignoring the poll's own `["relay"]` tags. **Fix: target poll.relays ∪
   module relays** so votes land where the author/standalone reads, and tallies read the poll's relays.
4. **No expiry handling.** `endsAt` is parsed but voting isn't disabled after expiry and tallies don't bound
   `until`. **Fix: disable vote past `endsAt`; set `until: endsAt` on the results query.**
5. **Percentage semantics differ for multiple-choice.** Super-app uses count/voters; upstream uses
   count/Σcounts. **Align to upstream** for display parity (identical for single-choice).
6. **Missing parity actions:** delete poll (author), clear my votes (voter), `label`-tag question fallback.
7. **MCP** (`tools/polls.ts`) has list/get/results/create/submit but is **missing** `delete_poll`,
   `clear_my_vote`, and a recent/discover listing (`fetchRecentPolls` exists in the service, unexposed).
8. **UI** (`PollsPage.tsx`, 663 LOC) is a generic tabbed monolith with no extracted components — replace
   with the approved **Layout-A two-pane workspace**.

---

## 4. Design

### 4.1 Service layer — `services/polls/service.ts`

Keep the existing module shape; make these focused changes (all pure/well-bounded, mirroring calendar/pages):

- **`fetchDeletions(relays, authors?)` + `isPollDeleted(event, index)`** — ported from calendar/pages.
  Indexes deleted **event ids** (`["e", id]`) by author with the newest-`created_at` + same-author guard.
  (Polls/votes are keyed by id, so id-based deletion is sufficient — no addressable-coordinate logic needed.)
- **`fetchMyPolls()` / `fetchRecentPolls()`** — after querying kind-1068, fetch kind-5 deletions and drop any
  poll whose id is deleted by its own author. Newest-wins is irrelevant (regular events, unique ids).
- **`submitPollResponse(pollId, pollAuthor, optionIds, pollRelays?)`** — publish the 1018 to
  `pollRelays ∪ getRelaysForModule("polls")` (so cross-app the author sees the vote). Caller passes
  `poll.relays`.
- **Tally rebuild — `subscribeToPollResults(poll, …)` / `fetchPollResults(poll, …)`** take the **poll**
  (or its id + relays + endsAt), read from `poll.relays ∪ module relays`, set `until: endsAt` when present,
  fetch the voters' kind-5 deletions and **exclude deleted/cleared responses**, then **dedup
  latest-per-pubkey by `created_at`**. `computeResults` percentage = `count / Σcounts` (voters = map size).
- **`deletePoll(pollId)`** — kind-5 `["e", pollId]` + `["k","1068"]`, published to `poll.relays ∪ module`.
- **`clearMyVotes(pollId)`** — query the signer's own `[1018,1070]` with `#e`=pollId across `poll.relays ∪
module`, kind-5 those ids; results recompute without them.
- **`parsePollEvent`** — read the question from `content`, falling back to a `["label"]` tag when content is
  empty (upstream parity). Continue parsing `option`/`polltype`/`endsAt`/`relay`/`t`.

### 4.2 Store — `stores/pollsStore.ts`

Add actions: `deletePoll(pollId)` (optimistic remove + survives refresh via deletion filter),
`clearMyVotes(pollId)` (then reload results), and have `submitResponse`/`loadResults` pass the loaded poll
(for its relays + endsAt). `createPoll` already appends to `myPolls`. State unchanged otherwise (`myPolls`,
`recentPolls`, `currentPoll`, `currentResults`, loading/error flags).

### 4.3 UI — Layout A (two-pane workspace), monochrome aesthetic

- `pages/PollsPage.tsx` (orchestrator, **< 200 LOC**): `<PollsSidebar>` + main pane
  (`<PollDetail>` or empty state). Full-bleed route (add `/polls` to `layout/fullBleed.ts`, like
  calendar/pages). Module already lives in the navbar.
- `components/polls/PollsSidebar.tsx` — `+ New Poll`; **My Polls** rows (question · vote-count, active
  highlight); **Discover** section (recent public polls, lightweight); **Topics** filter chips.
- `components/polls/PollDetail.tsx` — question + meta (type · N votes · ends-in / ended · "by you");
  pre-vote selectable options (**radio** for single, **checkbox** for multiple), **Vote / Update vote**;
  **Results** toggle → live count + % bars; ⋯ **manage menu**: Copy poll link · See voters ·
  **Clear my votes** · **Delete poll** (owner only). Voting disabled past `endsAt`.
- `components/polls/CreatePollDialog.tsx` — Question · Options (add/remove) · Poll type segmented
  (single↔multiple) · optional Ends (date-time) · optional Topics (hashtag chips) · Create. **Create-only.**
- `components/polls/VotersModal.tsx` (optional, parity) — per-option voter npubs from the tally.

### 4.4 MCP — `mcp/src/tools/polls.ts` (parity)

Keep `list_polls`, `get_poll`, `fetch_poll_results`, `create_poll`, `submit_poll_response`. Add:

- `list_recent_polls` (read) — wraps `fetchRecentPolls`.
- `delete_poll` (gated `--allow-writes` + `requireConfirm`) — wraps `deletePoll`.
- `clear_my_vote` (gated + confirm) — wraps `clearMyVotes`.

`submit_poll_response` continues to fetch the poll first (for author + relays) before publishing. Mock the
new service fns in the MCP test; add `delete_poll`/`clear_my_vote` to `GATED_TOOLS` in `safety.ts`.

---

## 5. Data flow

**Create** — Create dialog → `createPoll(draft)` → sign kind-1068 (`option`/`relay`/`polltype`/`endsAt`/`t`)
→ publish to module relays → prepend to My Polls.
**Open** — sidebar row → `loadPoll(id)` → parse → detail pane; `loadResults(poll)` lazily for the bars.
**Vote** — select option(s) → `submitResponse(pollId, author, optionIds, poll.relays)` → kind-1018 to
poll.relays ∪ module → re-tally; a re-vote supersedes via latest-by-`created_at`.
**Results** — subscribe `[1018,1070]` `#e`=pollId (until `endsAt`) on poll.relays ∪ module → drop
deleted/cleared → dedup latest-per-pubkey → count.
**Clear my votes** — `clearMyVotes(pollId)` → kind-5 of the voter's own responses → recount.
**Delete poll** — `deletePoll(pollId)` → kind-5 `["e",id]` → optimistic remove → **stays gone** because
`fetchMyPolls`/`fetchRecentPolls` apply `fetchDeletions` on load.

---

## 6. Interop notes / risks

- **No edit (by design).** Kind 1068 is a **regular, non-replaceable** event keyed by its id, and every vote
  references that id via `["e", pollId]`. Re-publishing an edited poll would mint a new id and orphan all
  existing votes — so the standalone offers only Create + Delete, and so do we. (Changing a poll = delete +
  create a new one.)
- **Cross-app vote sync** works once votes are published to the poll's own `["relay"]` tags (§5.1) and the
  module relays already overlap upstream's defaults. A poll authored in the standalone with custom relays is
  fully votable from the super-app (we target its relays), and vice-versa.
- **PoW polls (out of scope):** a poll carrying `["PoW", n]` expects mined votes; the super-app submits an
  un-mined 1018, which strict relays / PoW-filtered tallies may ignore. Acceptable for parity+polish; revisit
  only if needed.
- **Percentage display:** aligned to upstream (count / Σcounts) so multiple-choice bars match across apps;
  the wire data (raw `response` tags) is identical regardless.
- **Upstream context doc:** if standalone-side hardening gaps surface during implementation, record them in
  `docs/superpowers/specs/2026-06-06-polls-interop-issues.md` as we did for calendar — the super-app fixes
  its own side regardless.

---

## 7. Files

**Modified:** `services/polls/{service.ts,types.ts}` (deletions, latest-wins tally, relay targeting, expiry,
clear/delete, label fallback), `stores/pollsStore.ts` (delete/clear actions), `pages/PollsPage.tsx`
(Layout-A orchestrator), `layout/fullBleed.ts` (+`/polls`), `mcp/src/tools/polls.ts` + `mcp/src/safety.ts`.
**New:** `components/polls/{PollsSidebar,PollDetail,CreatePollDialog,VotersModal}.tsx`, service/store/MCP
tests.
**Unchanged:** `core/relay/module-defaults.ts` (polls set already matches upstream).
