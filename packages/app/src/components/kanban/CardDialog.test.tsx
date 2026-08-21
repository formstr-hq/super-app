import type { KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

import { formatNpub } from "../../lib/npub";
import { resetProfileCache } from "../../lib/profileCache";

import { CardDialog } from "./CardDialog";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

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
beforeEach(resetProfileCache);

/** Type into an Autocomplete's input, which is what opens its option list. */
function typeInto(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  return input;
}

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

  it("loads an existing card's values when editing", () => {
    renderDialog({ card: makeCard() });
    expect(screen.getByText("Edit card")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Ship the SDK");
    expect(screen.getByText("release")).toBeInTheDocument();
  });

  describe("labels", () => {
    it("offers the labels already used on the board", () => {
      renderDialog({ labelOptions: ["bug", "urgent"] });
      typeInto("Labels", "bu");
      expect(screen.getByRole("option", { name: "bug" })).toBeInTheDocument();
    });

    it("submits a label picked from the list", () => {
      const onSubmit = vi.fn();
      renderDialog({ onSubmit, labelOptions: ["bug", "urgent"] });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
      typeInto("Labels", "urg");
      fireEvent.click(screen.getByRole("option", { name: "urgent" }));
      fireEvent.click(screen.getByRole("button", { name: /add card/i }));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ labels: ["urgent"] }));
    });

    it("still accepts a label the board has never used", () => {
      const onSubmit = vi.fn();
      renderDialog({ onSubmit, labelOptions: ["bug"] });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
      const input = typeInto("Labels", "flaky");
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: /add card/i }));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ labels: ["flaky"] }));
    });

    it("does not re-offer a label the card already carries", () => {
      renderDialog({ card: makeCard({ labels: ["release"] }), labelOptions: ["release", "bug"] });
      typeInto("Labels", "rel");
      expect(screen.queryByRole("option", { name: "release" })).not.toBeInTheDocument();
    });
  });

  describe("assignees", () => {
    it("offers the board's members", () => {
      renderDialog({ assigneeOptions: [ALICE, BOB] });
      typeInto("Assignees", formatNpub(ALICE).slice(0, 8));
      expect(screen.getByRole("option", { name: formatNpub(ALICE) })).toBeInTheDocument();
    });

    it("submits the pubkey rather than the name shown", () => {
      const onSubmit = vi.fn();
      renderDialog({ onSubmit, assigneeOptions: [ALICE] });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
      typeInto("Assignees", formatNpub(ALICE).slice(0, 8));
      fireEvent.click(screen.getByRole("option", { name: formatNpub(ALICE) }));
      fireEvent.click(screen.getByRole("button", { name: /add card/i }));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [ALICE] }));
    });

    it("accepts an npub typed by hand and stores it as hex", () => {
      const onSubmit = vi.fn();
      renderDialog({ onSubmit, assigneeOptions: [] });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
      const input = typeInto("Assignees", nip19.npubEncode(BOB));
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: /add card/i }));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [BOB] }));
    });

    it("refuses text that is neither an npub nor a hex key", () => {
      const onSubmit = vi.fn();
      renderDialog({ onSubmit, assigneeOptions: [] });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });
      const input = typeInto("Assignees", "not-a-key");
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(screen.getByRole("button", { name: /add card/i }));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [] }));
    });
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
