import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation, useRoutes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// The shell pulls in the whole app (relays, signer, AI panel). Only routing is
// under test here, so stand in a marker that reports the resolved path.
vi.mock("./layout", () => ({
  AppShell: () => (
    <div>
      <PathMarker />
      <Outlet />
    </div>
  ),
}));

vi.mock("./pages/FillPage", () => ({ FillPage: () => <div>fill</div> }));

import { routes } from "./router";

function PathMarker() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function RoutedApp() {
  return useRoutes(routes);
}

afterEach(cleanup);

/**
 * Renders the real route tree at `from` and waits for the resolved path.
 * `<Navigate>` redirects commit on a later tick, so the assertion — not the
 * marker's presence — is what has to be waited on.
 */
async function expectPath(from: string, to: string): Promise<void> {
  render(
    <MemoryRouter initialEntries={[from]}>
      <RoutedApp />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent(to));
}

describe("removed module routes", () => {
  // Both routes shipped, so links to them exist in the wild. A 404 would be a
  // dead end; the redirect lands the user somewhere real.
  it("redirects /pages to /forms", async () => {
    await expectPath("/pages", "/forms");
  });

  it("redirects a deep /pages link to /forms", async () => {
    await expectPath("/pages/naddr1abc", "/forms");
  });

  it("redirects /polls to /forms", async () => {
    await expectPath("/polls", "/forms");
  });

  it("redirects a deep /polls link to /forms", async () => {
    await expectPath("/polls/nevent1abc", "/forms");
  });
});

describe("kanban route", () => {
  it("keeps /kanban itself", async () => {
    await expectPath("/kanban", "/kanban");
  });

  it("keeps an encoded board coordinate in the path", async () => {
    const coordinate = encodeURIComponent("30301:pk:board-1");
    await expectPath(`/kanban/${coordinate}`, `/kanban/${coordinate}`);
  });
});
