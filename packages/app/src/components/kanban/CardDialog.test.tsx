import type { KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The assignee picker renders names, and a name is a relay lookup. Nothing here
// asserts on a resolved name, so every pubkey stays at its npub fallback.
vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

import { resetProfileCache } from "../../lib/profileCache";

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
beforeEach(resetProfileCache);

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
    expect(screen.getByRole("button", { name: "release" })).toBeInTheDocument();
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

/** Type into a picker and commit the entry, the way a keyboard user would. */
function typeAndCommit(field: string, value: string) {
  const input = screen.getByRole("combobox", { name: field });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/** Open a picker's list and click one of its options. */
function pickOption(field: string, option: string | RegExp) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: field }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

const ALICE = "a".repeat(63) + "1";
const BOB = "b".repeat(63) + "2";

describe("CardDialog label picker", () => {
  it("offers the labels already used on the board", () => {
    renderDialog({ labelOptions: ["release", "bug"] });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Labels" }), { key: "ArrowDown" });

    expect(screen.getByRole("option", { name: "release" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bug" })).toBeInTheDocument();
  });

  it("puts a picked label on the card", () => {
    const onSubmit = vi.fn();
    renderDialog({ labelOptions: ["release", "bug"], onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    pickOption("Labels", "bug");
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ labels: ["bug"] }));
  });

  // The point of the picker is consistency, not a closed vocabulary: the first
  // card to carry a label has to be able to invent it.
  it("accepts a label the board has never used", () => {
    const onSubmit = vi.fn();
    renderDialog({ labelOptions: ["release"], onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    typeAndCommit("Labels", "urgent");
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ labels: ["urgent"] }));
  });

  it("trims a label and refuses to add it twice", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    typeAndCommit("Labels", "  bug  ");
    typeAndCommit("Labels", "bug");
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ labels: ["bug"] }));
  });

  it("drops a label that is only whitespace", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    typeAndCommit("Labels", "   ");
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ labels: [] }));
  });
});

describe("CardDialog assignee picker", () => {
  it("offers everyone the board lists", () => {
    renderDialog({ assigneeOptions: [ALICE, BOB] });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Assignees" }), { key: "ArrowDown" });

    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("stores a picked member as a hex pubkey", () => {
    const onSubmit = vi.fn();
    renderDialog({ assigneeOptions: [ALICE], onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    pickOption("Assignees", /npub1/);
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [ALICE] }));
  });

  // Assigning someone who has not been invited yet is legitimate; the board's
  // roster is a shortlist, not a whitelist.
  it("accepts a pasted npub and stores its hex", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    typeAndCommit("Assignees", nip19.npubEncode(BOB));
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [BOB] }));
  });

  it("accepts a raw hex pubkey", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    typeAndCommit("Assignees", ALICE);
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [ALICE] }));
  });

  // A `p` tag has to be a pubkey. Storing "steve" would publish a tag no relay
  // or client can resolve, and the card would carry it forever.
  it("drops an entry that is neither an npub nor a hex pubkey", () => {
    const onSubmit = vi.fn();
    renderDialog({ onSubmit });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Write docs" } });

    typeAndCommit("Assignees", "steve");
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assignees: [] }));
  });

  it("loads an existing card's assignees", () => {
    renderDialog({ card: makeCard({ assignees: [ALICE] }), assigneeOptions: [ALICE] });
    expect(screen.getByRole("button", { name: /npub1/ })).toBeInTheDocument();
  });

  it("offers no pickers to a read-only viewer", () => {
    renderDialog({ card: makeCard(), readOnly: true, labelOptions: ["release"] });
    expect(screen.getByRole("combobox", { name: "Labels" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Assignees" })).toBeDisabled();
  });
});
