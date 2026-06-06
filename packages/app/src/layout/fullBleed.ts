/**
 * Routes that should render edge-to-edge, filling the main content area instead
 * of sitting inside the centered `maxWidth` container. Calendar and Pages are
 * app-like surfaces (full-height rail + main pane), so they opt out of the
 * wrapper.
 */
export function isFullBleedRoute(pathname: string): boolean {
  return (
    pathname === "/calendar" ||
    pathname.startsWith("/calendar/") ||
    pathname === "/pages" ||
    pathname.startsWith("/pages/")
  );
}
