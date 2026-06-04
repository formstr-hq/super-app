import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("../stores", () => ({
  useAuthStore: vi.fn(),
  useSettingsStore: vi.fn(),
}));

import { useAuthStore, useSettingsStore } from "../stores";

import { Sidebar } from "./Sidebar";

beforeEach(() => {
  vi.clearAllMocks();
  (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    isLoggedIn: false,
    pubkey: null,
  });
  (useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    toggleSidebarCollapsed: vi.fn(),
  });
});

afterEach(cleanup);

const renderSidebar = () =>
  render(
    <MemoryRouter initialEntries={["/calendar"]}>
      <Sidebar collapsed={false} onLoginClick={() => {}} />
    </MemoryRouter>,
  );

describe("Sidebar (mobile drawer nav)", () => {
  it("lists every module", () => {
    renderSidebar();
    ["Forms", "Calendar", "Pages", "Drive", "Polls"].forEach((label) =>
      expect(screen.getByText(label)).toBeInTheDocument(),
    );
  });

  it("offers Sign In when logged out", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});
