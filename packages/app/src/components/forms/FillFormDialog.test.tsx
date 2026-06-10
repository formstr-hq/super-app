import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@formstr/agent/services/forms/service", () => ({
  submitResponse: vi.fn().mockResolvedValue(undefined),
}));

import * as formsService from "@formstr/agent/services/forms/service";
import { AnswerType, type FormTemplate } from "@formstr/agent/services/forms/types";

import { FillFormDialog } from "./FillFormDialog";

const mockForm: FormTemplate = {
  id: "form1",
  name: "Survey",
  pubkey: "pub1",
  createdAt: 0,
  isEncrypted: false,
  settings: {},
  fields: [
    { id: "q1", type: AnswerType.shortText, label: "Your name", required: false },
    { id: "q2", type: AnswerType.shortText, label: "Your email", required: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("FillFormDialog", () => {
  it("shows skeleton/loading state when form=null", () => {
    render(<FillFormDialog open form={null} isLoading={false} onClose={vi.fn()} />);
    // When form is null, skeletons are shown instead of field labels.
    // MUI Dialog renders in a portal so we query document.body.
    expect(document.body.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
    expect(screen.queryByText("Your name")).not.toBeInTheDocument();
  });

  it("shows skeleton when isLoading=true even with form provided", () => {
    render(<FillFormDialog open form={mockForm} isLoading onClose={vi.fn()} />);
    expect(document.body.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("renders field labels when form is provided and not loading", () => {
    render(<FillFormDialog open form={mockForm} isLoading={false} onClose={vi.fn()} />);
    expect(screen.getByText("Your name")).toBeInTheDocument();
    expect(screen.getByText("Your email")).toBeInTheDocument();
  });

  it("calls submitResponse with correct args on submit", async () => {
    render(<FillFormDialog open form={mockForm} isLoading={false} onClose={vi.fn()} />);

    // Click Submit button
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(formsService.submitResponse).toHaveBeenCalledOnce();
      expect(formsService.submitResponse).toHaveBeenCalledWith(
        "pub1",
        "form1",
        expect.arrayContaining([
          expect.objectContaining({ fieldId: "q1" }),
          expect.objectContaining({ fieldId: "q2" }),
        ]),
        false,
        undefined,
        undefined, // form.relays — none on this template
      );
    });
  });

  it("shows success message after successful submit", async () => {
    render(<FillFormDialog open form={mockForm} isLoading={false} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText(/response submitted/i)).toBeInTheDocument();
    });
  });
});
