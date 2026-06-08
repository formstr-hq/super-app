import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../stores", () => ({
  useFormsStore: vi.fn(),
  // Stub other named exports used transitively
  useAuthStore: vi.fn(),
  useSettingsStore: vi.fn(),
}));

import { useFormsStore } from "../../stores";

import { FormBuilderSurface } from "./FormBuilderSurface";

const mockCreateForm = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // FormBuilderSurface calls useFormsStore() with no selector, so we return the store object directly
  (useFormsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    createForm: mockCreateForm,
  });
});

afterEach(() => cleanup());

describe("FormBuilderSurface", () => {
  it("renders the builder with build + live-preview panes", () => {
    render(<FormBuilderSurface onClose={vi.fn()} />);
    expect(screen.getByText("New form")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeInTheDocument();
  });

  it("can type a form name and add a field", () => {
    render(<FormBuilderSurface onClose={vi.fn()} />);

    const titleInput = screen.getByLabelText(/form title/i);
    fireEvent.change(titleInput, { target: { value: "My Survey" } });
    expect(titleInput).toHaveValue("My Survey");

    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    expect(screen.getByPlaceholderText(/question…/i)).toBeInTheDocument();
  });

  it("calls createForm and onClose when Create is clicked with valid input", async () => {
    mockCreateForm.mockResolvedValue({
      formId: "f1",
      pubkey: "pub",
      signingKey: "sk",
      viewKey: "vk",
    });
    const onClose = vi.fn();

    render(<FormBuilderSurface onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/form title/i), {
      target: { value: "Test Form" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockCreateForm).toHaveBeenCalledOnce();
      expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({ name: "Test Form" }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("Create button is disabled while submitting", async () => {
    // Make createForm never resolve so we stay in the submitting state
    mockCreateForm.mockReturnValue(new Promise(() => {}));

    render(<FormBuilderSurface onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/form title/i), {
      target: { value: "Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
    });
  });

  it("Create button is disabled when name is empty", () => {
    render(<FormBuilderSurface onClose={vi.fn()} />);
    // Add a field but leave the name empty
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });
});
