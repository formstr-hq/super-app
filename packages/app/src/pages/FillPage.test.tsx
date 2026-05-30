import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ── Mocks (must appear before any imports that depend on them) ───────────────

vi.mock("../services/forms/service", () => ({
  fetchForm: vi.fn(),
  submitResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../stores", () => ({
  useAuthStore: vi.fn((selector: (s: { isLoggedIn: boolean; pubkey: string | null }) => unknown) =>
    selector({ isLoggedIn: false, pubkey: null }),
  ),
}));

vi.mock("react-router-dom", () => ({
  useParams: vi.fn(() => ({ naddr: VALID_NADDR })),
}));

// Mock lucide-react icons used in ResponderIdentityBar (jsdom has no SVG support)
vi.mock("lucide-react", () => ({
  PersonStanding: () => <span data-testid="icon-person" />,
  UserX: () => <span data-testid="icon-userx" />,
}));

// Mock @formstr/core — we only need decodeNKeys
vi.mock("@formstr/core", () => ({
  decodeNKeys: vi.fn((hash: string) => {
    if (hash === VALID_HASH_FRAGMENT) {
      return { viewKey: "test-view-key" };
    }
    throw new Error("Invalid nkeys encoding");
  }),
}));

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_NADDR = nip19.naddrEncode({
  kind: 30168,
  pubkey: "a".repeat(64),
  identifier: "form1",
  relays: [],
});

const VALID_HASH_FRAGMENT = "nkeys1testfragment";

// ── Imports that depend on mocked modules ────────────────────────────────────

import * as formsService from "../services/forms/service";
import { AnswerType, type FormTemplate } from "../services/forms/types";
import * as stores from "../stores";

import { FillPage } from "./FillPage";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockFetchForm = formsService.fetchForm as unknown as ReturnType<typeof vi.fn>;
const mockUseAuthStore = stores.useAuthStore as unknown as ReturnType<typeof vi.fn>;

function makeForm(overrides: Partial<FormTemplate> = {}): FormTemplate {
  return {
    id: "form1",
    name: "Test Form",
    pubkey: "a".repeat(64),
    createdAt: 0,
    isEncrypted: false,
    settings: {},
    fields: [{ id: "q1", type: AnswerType.shortText, label: "Your name", required: false }],
    ...overrides,
  };
}

function setAuthStore(isLoggedIn: boolean, pubkey: string | null = null) {
  mockUseAuthStore.mockImplementation(
    (selector: (s: { isLoggedIn: boolean; pubkey: string | null }) => unknown) =>
      selector({ isLoggedIn, pubkey }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: not logged in
  setAuthStore(false, null);
  // Clear any hash fragment from previous test
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("FillPage", () => {
  it("shows CircularProgress while form is loading", () => {
    // fetchForm never resolves during this test
    mockFetchForm.mockReturnValue(new Promise(() => {}));

    render(<FillPage />);

    // MUI CircularProgress renders an SVG with role="progressbar"
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders form fields after fetch completes", async () => {
    mockFetchForm.mockResolvedValue(makeForm());

    render(<FillPage />);

    await waitFor(() => {
      expect(screen.getByText("Your name")).toBeInTheDocument();
    });

    // Form title should also be rendered
    expect(screen.getByText("Test Form")).toBeInTheDocument();
  });

  it("calls fetchForm with viewKey from fragment when window.location.hash is set", async () => {
    window.location.hash = `#${VALID_HASH_FRAGMENT}`;
    mockFetchForm.mockResolvedValue(makeForm());

    render(<FillPage />);

    await waitFor(() => {
      expect(mockFetchForm).toHaveBeenCalledWith("a".repeat(64), "form1", "test-view-key");
    });
  });

  it("shows error message when fetchForm returns null", async () => {
    mockFetchForm.mockResolvedValue(null);

    render(<FillPage />);

    await waitFor(() => {
      expect(screen.getByText(/form not found/i)).toBeInTheDocument();
    });
  });

  it("shows login prompt (not fields) when allowedResponders form and user is not logged in", async () => {
    setAuthStore(false, null);
    mockFetchForm.mockResolvedValue(makeForm({ settings: { allowedResponders: ["somepubkey"] } }));

    render(<FillPage />);

    await waitFor(() => {
      expect(screen.getByText(/this form requires you to log in/i)).toBeInTheDocument();
    });

    // The form field label should NOT be present
    expect(screen.queryAllByText("Your name").length).toBe(0);
  });
});
