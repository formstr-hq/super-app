import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("../stores", () => ({
  useAuthStore: vi.fn(),
  useSettingsStore: vi.fn(),
}));

import { useAuthStore, useSettingsStore } from "../stores";

import { Header } from "./Header";

beforeEach(() => {
  vi.clearAllMocks();
  (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    pubkey: null,
    isLoggedIn: false,
    method: null,
    logout: vi.fn(),
  });
  (useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    toggleSidebar: vi.fn(),
    aiPanelOpen: false,
    setAIPanelOpen: vi.fn(),
    themeMode: "light",
    toggleTheme: vi.fn(),
  });
});

afterEach(cleanup);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header onLoginClick={() => {}} isMobile={false} />
    </MemoryRouter>,
  );

describe("Header module tabs", () => {
  it("renders all module tabs as links", () => {
    renderAt("/calendar");
    ["Forms", "Calendar", "Pages", "Drive", "Polls"].forEach((label) =>
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument(),
    );
  });

  it("marks the active route with aria-current", () => {
    renderAt("/calendar");
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
  });
});
