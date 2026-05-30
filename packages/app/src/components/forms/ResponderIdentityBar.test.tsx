import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../stores", () => ({
  useAuthStore: vi.fn((selector: (s: { isLoggedIn: boolean; pubkey: string | null }) => unknown) =>
    selector({ isLoggedIn: true, pubkey: "deadbeefdeadbeef" }),
  ),
}));

// Mock lucide-react icons (jsdom has no SVG layout)
vi.mock("lucide-react", () => ({
  PersonStanding: () => <span data-testid="icon-person" />,
  UserX: () => <span data-testid="icon-userx" />,
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import * as stores from "../../stores";

import { ResponderIdentityBar, type IdentityMode } from "./ResponderIdentityBar";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockUseAuthStore = stores.useAuthStore as unknown as ReturnType<typeof vi.fn>;

function setAuthStore(isLoggedIn: boolean, pubkey: string | null = null) {
  mockUseAuthStore.mockImplementation(
    (selector: (s: { isLoggedIn: boolean; pubkey: string | null }) => unknown) =>
      selector({ isLoggedIn, pubkey }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: logged in
  setAuthStore(true, "deadbeefdeadbeef");
});

describe("ResponderIdentityBar", () => {
  it("renders null when user is not logged in", () => {
    setAuthStore(false, null);

    const { container } = render(<ResponderIdentityBar mode="anonymous" onChange={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it("shows both Anonymous and Me options when logged in", () => {
    render(<ResponderIdentityBar mode="anonymous" onChange={vi.fn()} />);

    expect(screen.getByText(/anonymous/i)).toBeInTheDocument();
    // Pubkey is sliced: "deadbeef…"
    expect(screen.getByText(/deadbeef/i)).toBeInTheDocument();
  });

  it("calls onChange with 'me' when Me toggle is clicked", () => {
    const onChange = vi.fn();
    const { container } = render(<ResponderIdentityBar mode="anonymous" onChange={onChange} />);

    // Target the ToggleButton with value="me" directly (avoids aria-hidden duplicates)
    const meButton = container.querySelector<HTMLButtonElement>('button[value="me"]')!;
    expect(meButton).toBeTruthy();
    fireEvent.click(meButton);

    expect(onChange).toHaveBeenCalledWith("me" as IdentityMode);
  });

  it("renders null when requiresLogin=true even if user is logged in", () => {
    setAuthStore(true, "deadbeefdeadbeef");

    const { container } = render(
      <ResponderIdentityBar mode="anonymous" onChange={vi.fn()} requiresLogin />,
    );

    expect(container.firstChild).toBeNull();
  });
});
