import type { KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardDialog } from "./CardDialog";

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: "card-1",
    pubkey: "pk",
    authorPubkey: "pk",
    rotated: false,
    eventId: "evt",
    boardCoordinate: "30301:pk:board-1",
    title: "Ship the SDK",
    description: "cut 0.1.0",
    status: "To Do",
    rank: 10,
    attachments: [],
    assignees: [],
    labels: ["release"],
    links: [],
    binned: false,
    isPrivate: false,
    createdAt: 1,
    rawTags: [],
    ...overrides,
  };
}

const noop = () => {};

function renderDialog(props: Partial<React.ComponentProps<typeof CardDialog>> = {}) {
  return render(
    <CardDialog open columnName="To Do" saving={false} onClose={noop} onSubmit={noop} {...props} />,
  );
}

afterEach(cleanup);

describe("CardDialog", () => {
  it("names the destination column when creating", () => {
    renderDialog();
    expect(screen.getByText("New card in To Do")).toBeInTheDocument();
  });

  it("blocks submission until the card has a title", () => {
    renderDialog();
    const submit = screen.getByRole("button", { name: /add card/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
    expect(submit).toBeEnabled();
  });

  it("treats a whitespace-only title as empty", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /add card/i })).toBeDisabled();
  });

  it("splits comma-separated labels and assignees, trimming and de-duplicating", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
    fireEvent.change(screen.getByLabelText("Labels"), {
      target: { value: " bug , urgent ,bug, " },
    });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Write docs", labels: ["bug", "urgent"] }),
    );
  });

  it("loads an existing card's values when editing", () => {
    renderDialog({ card: makeCard() });
    expect(screen.getByText("Edit card")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Ship the SDK");
    expect(screen.getByLabelText("Labels")).toHaveValue("release");
  });

  it("offers delete only when editing", () => {
    const { rerender } = renderDialog();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();

    rerender(
      <CardDialog
        open
        card={makeCard()}
        columnName="To Do"
        saving={false}
        onClose={noop}
        onSubmit={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("offers bin instead of delete for a card the signer did not write", () => {
    renderDialog({ card: makeCard(), onBin: noop });
    expect(screen.getByRole("button", { name: /bin/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("offers delete, not bin, once the signer owns the version", () => {
    renderDialog({ card: makeCard(), onDelete: noop, onBin: noop });
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bin/i })).not.toBeInTheDocument();
  });

  describe("read-only", () => {
    it("disables every field and offers no way to save", () => {
      renderDialog({ card: makeCard(), readOnly: true });

      expect(screen.getByLabelText("Title")).toBeDisabled();
      expect(screen.getByLabelText("Description")).toBeDisabled();
      expect(screen.getByLabelText("Labels")).toBeDisabled();
      expect(screen.getByLabelText("Assignees")).toBeDisabled();
      expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    });

    it("still shows the card's contents", () => {
      renderDialog({ card: makeCard(), readOnly: true });
      expect(screen.getByLabelText("Title")).toHaveValue("Ship the SDK");
      expect(screen.getByText("Card")).toBeInTheDocument();
    });
  });

  it("blocks a second submit while the first is in flight", () => {
    renderDialog({ card: makeCard(), saving: true });
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });
});
