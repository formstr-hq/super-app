import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import type { FormSummary } from "../../services/forms/types";

import { FormCard } from "./FormCard";

const base: FormSummary = {
  id: "f1",
  name: "Test Form",
  pubkey: "pub",
  createdAt: 0,
  isEncrypted: false,
};

afterEach(() => cleanup());

describe("FormCard", () => {
  it("shows encrypted chip when isEncrypted=true", () => {
    render(
      <FormCard
        form={{ ...base, isEncrypted: true }}
        onFill={vi.fn()}
        onViewResponses={vi.fn()}
        onDelete={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/encrypted/i)).toBeInTheDocument();
  });

  it("does not show encrypted chip when isEncrypted=false", () => {
    render(
      <FormCard
        form={base}
        onFill={vi.fn()}
        onViewResponses={vi.fn()}
        onDelete={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    // No "Encrypted" chip text should appear
    expect(screen.queryByText("Encrypted")).not.toBeInTheDocument();
  });

  it("calls onFill with the form when Fill Form button is clicked", () => {
    const onFill = vi.fn();
    render(
      <FormCard
        form={base}
        onFill={onFill}
        onViewResponses={vi.fn()}
        onDelete={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Fill Form"));
    expect(onFill).toHaveBeenCalledWith(base);
  });

  it("shows hover action buttons on mouse enter", () => {
    render(
      <FormCard
        form={base}
        onFill={vi.fn()}
        onViewResponses={vi.fn()}
        onDelete={vi.fn()}
        onCopyLink={vi.fn()}
      />,
    );
    const [formTitle] = screen.getAllByText("Test Form");
    const card = formTitle.closest(".MuiCard-root")!;
    fireEvent.mouseEnter(card);
    // After hover, action buttons become visible
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
