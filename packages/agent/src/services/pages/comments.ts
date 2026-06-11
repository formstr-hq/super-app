import { signerManager, nostrRuntime, relayManager } from "@formstr/core";
import type { Event, EventTemplate, Filter } from "nostr-tools";

import { PAGES_KINDS, type PageComment, type PageCommentDraft } from "./types";
import { encryptWithViewKey, decryptWithViewKey } from "./viewKey";

const RELAYS = () => relayManager.getRelaysForModule("pages");

/**
 * Private inline comments (kind 1494) — exact upstream nostr-docs wire
 * (`src/nostr/comments.ts`): non-replaceable events anchored to a document by
 * `["a", docAddress]` + `["e", docEventId]` + `["p", docOwner]`, whose content is
 * the NIP-44 (viewKey self-conversation) ciphertext of a flat inner tag array:
 * `[["content", text], ["type", comment|suggestion], ["quote", text]?,
 * ["context", prefix, suffix]?]`. Signed by the commenter's real key — only
 * viewKey holders can read the body.
 */

export async function publishPageComment(
  draft: PageCommentDraft,
  viewKey: string,
  docAddress: string,
  docEventId: string,
): Promise<Event> {
  const signer = await signerManager.getSigner();

  const innerTags: string[][] = [
    ["content", draft.content],
    ["type", draft.type],
  ];
  if (draft.quote !== undefined) innerTags.push(["quote", draft.quote]);
  if (draft.context !== undefined) {
    innerTags.push(["context", draft.context.prefix, draft.context.suffix]);
  }

  const docOwnerPubkey = docAddress.split(":")[1];
  const event: EventTemplate = {
    kind: PAGES_KINDS.comment,
    created_at: Math.floor(Date.now() / 1000),
    content: await encryptWithViewKey(viewKey, JSON.stringify(innerTags)),
    tags: [
      ["a", docAddress],
      ["e", docEventId],
      ["p", docOwnerPubkey],
    ],
  };

  const signed = await signer.signEvent(event);
  await nostrRuntime.publish(RELAYS(), signed);
  return signed;
}

/** Decrypt + parse one kind-1494 event; undefined when not readable with this viewKey. */
export async function parsePageComment(
  event: Event,
  viewKey: string,
): Promise<PageComment | undefined> {
  try {
    const inner = JSON.parse(await decryptWithViewKey(viewKey, event.content)) as unknown;
    if (!Array.isArray(inner)) return undefined;
    const rows = inner as string[][];
    const find = (name: string) => rows.find((r) => Array.isArray(r) && r[0] === name);
    const content = find("content")?.[1];
    if (typeof content !== "string") return undefined;
    const type = find("type")?.[1] === "suggestion" ? "suggestion" : "comment";
    const quote = find("quote")?.[1];
    const contextRow = find("context");
    return {
      id: event.id,
      author: event.pubkey,
      createdAt: event.created_at,
      content,
      type,
      ...(quote !== undefined ? { quote } : {}),
      ...(contextRow
        ? { context: { prefix: contextRow[1] ?? "", suffix: contextRow[2] ?? "" } }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/** All readable comments on a document, oldest first. */
export async function fetchPageComments(
  docAddress: string,
  viewKey: string,
): Promise<PageComment[]> {
  const events = await nostrRuntime.querySync(RELAYS(), {
    kinds: [PAGES_KINDS.comment],
    "#a": [docAddress],
  } as Filter);

  const out: PageComment[] = [];
  for (const event of events) {
    const comment = await parsePageComment(event, viewKey);
    if (comment) out.push(comment);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
