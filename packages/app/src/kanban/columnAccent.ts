/**
 * The hue a column header wears. Derived from the column **name**, never from
 * its order — a board owner reordering columns must not repaint the board, and
 * a two-column board ("To do", "Done") should still read Done as green.
 */
export type ColumnAccent = "neutral" | "progress" | "review" | "blocked" | "done";

const PATTERNS: [ColumnAccent, RegExp][] = [
  ["blocked", /\b(blocked|blocker|stuck|on hold|waiting)\b/i],
  ["done", /\b(done|complete|completed|closed|shipped|released|finished)\b/i],
  ["review", /\b(review|reviewing|qa|testing|verify|verification)\b/i],
  ["progress", /\b(in progress|progress|doing|active|current|wip|building)\b/i],
];

/** Match the first pattern that fits; unmatched columns stay neutral. */
export function columnAccent(columnName: string): ColumnAccent {
  for (const [accent, pattern] of PATTERNS) {
    if (pattern.test(columnName)) return accent;
  }
  return "neutral";
}
