/**
 * A card's `d` tag shown as a short reference, the slot Jira gives the issue
 * key. Random ids collapse to first·last so two cards never share a rendering;
 * an id short enough to read whole is left alone.
 */
export function shortCardKey(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}·${trimmed.slice(-4)}`;
}
