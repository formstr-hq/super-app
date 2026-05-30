import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import type { FormSummary } from "../../services/forms/types";

import { FormListView } from "./FormListView";

const noop = vi.fn();
const forms: FormSummary[] = [
  { id: "f1", name: "Alpha", pubkey: "pub1", createdAt: 0, isEncrypted: false },
  { id: "f2", name: "Beta", pubkey: "pub2", createdAt: 0, isEncrypted: true },
];

describe("FormListView", () => {
  it("renders skeletons while loading", () => {
    const { container } = render(
      <FormListView
        forms={[]}
        isLoading
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={noop}
      />,
    );
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("renders empty state when forms array is empty", () => {
    render(
      <FormListView
        forms={[]}
        isLoading={false}
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={noop}
      />,
    );
    expect(screen.getByText(/no forms yet/i)).toBeInTheDocument();
  });

  it("renders a card for each form", () => {
    render(
      <FormListView
        forms={forms}
        isLoading={false}
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={noop}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("calls onCreateNew when empty-state button clicked", () => {
    const onCreateNew = vi.fn();
    const { container } = render(
      <FormListView
        forms={[]}
        isLoading={false}
        onFill={noop}
        onViewResponses={noop}
        onDelete={noop}
        onCopyLink={noop}
        onCreateNew={onCreateNew}
      />,
    );
    // Find the button element that contains "New Form" text within the rendered container
    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      el.textContent?.toLowerCase().includes("new form"),
    )!;
    fireEvent.click(button);
    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});
