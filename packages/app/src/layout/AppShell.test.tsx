import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@formstr/core", () => ({
  relayManager: { fetchUserRelays: vi.fn() },
}));
vi.mock("../stores", () => ({
  useAuthStore: vi.fn((sel?: (s: { pubkey: string | null }) => unknown) =>
    sel ? sel({ pubkey: null }) : { pubkey: null },
  ),
  useSettingsStore: vi.fn(() => ({
    sidebarOpen: false,
    sidebarCollapsed: false,
    aiPanelOpen: false,
    setSidebarOpen: vi.fn(),
  })),
  useInvitationsStore: { getState: () => ({ start: vi.fn(), stop: vi.fn() }) },
}));
vi.mock("./Header", () => ({ Header: () => <div data-testid="header" /> }));
vi.mock("./Sidebar", () => ({
  Sidebar: () => <nav data-testid="sidebar-nav" />,
  SIDEBAR_WIDTH: 240,
  SIDEBAR_COLLAPSED_WIDTH: 56,
}));
vi.mock("../components/ai/AIChatPanel", () => ({ AIChatPanel: () => <div /> }));
vi.mock("../components/CommandPalette", () => ({
  CommandPalette: () => <div />,
  useCommandPaletteHotkey: vi.fn(),
}));
vi.mock("../components/LoginDialog", () => ({ LoginDialog: () => <div /> }));

import { AppShell } from "./AppShell";

afterEach(cleanup);

const renderShell = () =>
  render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );

describe("AppShell", () => {
  it("does not render a desktop module rail (aside)", () => {
    const { container } = renderShell();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("still renders the header (navbar owns module switching)", () => {
    renderShell();
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });
});
