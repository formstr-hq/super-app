/**
 * Routes that should render edge-to-edge, filling the main content area instead
 * of sitting inside the centered `maxWidth` container. Forms, Calendar, and Drive are app-like surfaces (full-height rail + main pane), so they opt
 * out of the wrapper. (The public form-filler `/forms/fill/:naddr` is a
 * separate route outside the app shell and is unaffected.)
 */
const FULL_BLEED_PREFIXES = ["/forms", "/calendar", "/drive"];

export function isFullBleedRoute(pathname: string): boolean {
  return FULL_BLEED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
