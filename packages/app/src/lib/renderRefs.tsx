import { Fragment, type ReactNode } from "react";

import { EntityPill } from "../components/EntityPill";

// Matches bech32 naddr1…, nevent1…, note1… tokens (common ref formats)
const REF_REGEX = /\b(naddr1[02-9ac-hj-np-z]{10,}|nevent1[02-9ac-hj-np-z]{10,})\b/gi;

/**
 * Scans a text string for nostr references (naddr/nevent) and returns an
 * array of React nodes with inline <EntityPill /> components replacing
 * each match. Plain text fragments are returned as strings.
 */
export function renderRefs(text: string): ReactNode[] {
  if (!text) return [text];

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // RegExp needs to be reset for each call
  const regex = new RegExp(REF_REGEX.source, REF_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    const [naddr] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    nodes.push(<EntityPill key={`${start}-${naddr.slice(0, 12)}`} naddr={naddr} readOnly />);
    lastIndex = start + naddr.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/**
 * Convenience wrapper that returns a single React element safe for embedding
 * inside a larger JSX tree. Use inside prose where cross-references might
 * appear mid-sentence.
 */
export function RenderRefs({ text }: { text: string }) {
  const parts = renderRefs(text);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
