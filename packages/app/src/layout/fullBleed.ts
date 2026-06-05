/**
 * Routes that should render edge-to-edge, filling the main content area instead
 * of sitting inside the centered `maxWidth` container. The Calendar is an
 * app-like surface (full-height rail + grid), so it opts out of the wrapper.
 */
export function isFullBleedRoute(pathname: string): boolean {
  return pathname === "/calendar" || pathname.startsWith("/calendar/");
}
