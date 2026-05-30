import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../stores", () => ({
  useFormsStore: vi.fn(),
  // Stub other named exports used transitively
  useAuthStore: vi.fn(),
  useSettingsStore: vi.fn(),
}));

import { useFormsStore } from "../../stores";

import { CreateFormDialog } from "./CreateFormDialog";

const mockCreateForm = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // CreateFormDialog calls useFormsStore() with no selector, so we return the store object directly
  (useFormsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    createForm: mockCreateForm,
  });
});

afterEach(() => cleanup());

describe("CreateFormDialog", () => {
  it("does not render dialog content when open=false", () => {
    render(<CreateFormDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog when open=true", () => {
    render(<CreateFormDialog open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New Form")).toBeInTheDocument();
  });

  it("can type a form name and add a field", () => {
    render(<CreateFormDialog open onClose={vi.fn()} />);

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

    render(<CreateFormDialog open onClose={onClose} />);

    // Fill in title
    fireEvent.change(screen.getByLabelText(/form title/i), {
      target: { value: "Test Form" },
    });

    // Add a question
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));

    // Click Create
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(mockCreateForm).toHaveBeenCalledOnce();
      expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({ name: "Test Form" }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("Create button is disabled while submitting", async () => {
    // Make createForm never resolve so we stay in submitting state
    mockCreateForm.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    render(<CreateFormDialog open onClose={onClose} />);

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
    render(<CreateFormDialog open onClose={vi.fn()} />);
    // Add a field but leave name empty
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });
});
