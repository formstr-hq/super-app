/**
 * Module inks — the "Asterisk" identity.
 *
 * Each module owns one hue and tints only its own chrome: the active tab, the
 * rail selection, focus rings and column markers. Colour here is wayfinding,
 * never decoration — a hue used for anything except module identity reads as
 * random, so keep every new use behind one of the variables below.
 *
 * The inks sit at near-equal value so no module shouts louder than another, and
 * each is picked to clear 4.5:1 against its own ground (light inks on #FAFAF8,
 * dark inks on #101211).
 */

export const ACCENT_MODULES = ["forms", "calendar", "kanban", "drive"] as const;

export type AccentModule = (typeof ACCENT_MODULES)[number];
export type AccentMode = "light" | "dark";

const INK: Record<AccentModule, Record<AccentMode, string>> = {
  forms: { light: "#A65A08", dark: "#E08A2E" },
  calendar: { light: "#2743C4", dark: "#7B92F0" },
  kanban: { light: "#A31E63", dark: "#E8629F" },
  drive: { light: "#0B6B60", dark: "#3FB5A4" },
};

/** Used off the modules (Settings) so the variables are always defined. */
const NEUTRAL_INK: Record<AccentMode, string> = { light: "#4A524E", dark: "#96A09A" };

/** Route prefix → module. Kept explicit so a new route has to opt in. */
const ROUTES: ReadonlyArray<readonly [string, AccentModule]> = [
  ["/forms", "forms"],
  ["/calendar", "calendar"],
  ["/kanban", "kanban"],
  ["/drive", "drive"],
];

export function moduleForPath(pathname: string): AccentModule | null {
  for (const [prefix, module] of ROUTES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module;
  }
  return null;
}

export function accentInk(module: AccentModule | null, mode: AccentMode): string {
  return module ? INK[module][mode] : NEUTRAL_INK[mode];
}

function alpha(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * CSS custom properties for the active module, applied to the document root so
 * every surface can read them without threading the route through the theme.
 *
 * - `--fs-accent`      full strength: markers, focus rings, active labels
 * - `--fs-accent-line` borders and rules
 * - `--fs-accent-tint` selected surfaces
 * - `--fs-accent-wash` hover surfaces
 */
export function accentVars(module: AccentModule | null, mode: AccentMode): Record<string, string> {
  const ink = accentInk(module, mode);
  return {
    "--fs-accent": ink,
    "--fs-accent-line": alpha(ink, 0.28),
    "--fs-accent-tint": alpha(ink, 0.12),
    "--fs-accent-wash": alpha(ink, 0.06),
  };
}
