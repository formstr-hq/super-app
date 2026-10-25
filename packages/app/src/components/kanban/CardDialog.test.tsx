import type { KanbanBoard, KanbanCard, KanbanComment } from "@formstr/kanban-sdk";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The assignee picker renders names, and a name is a relay lookup. Nothing here
// asserts on a resolved name, so every pubkey stays at its npub fallback.
vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn().mockResolvedValue(null),
}));

// The store reads through the SDK. Only the comment surface is stubbed: the
// comment tests drive the real store and assert what it asked the SDK to do.
vi.mock("../../kanban/sdk", () => ({
  kanbanSdk: {
    relays: ["wss://kanban.test"],
    fetchComments: vi.fn(),
    createComment: vi.fn(),
    deleteComment: vi.fn(),
  },
}));

import { kanbanSdk } from "../../kanban/sdk";
import { formatNpub } from "../../lib/npub";
import { resetProfileCache } from "../../lib/profileCache";
import { useKanbanStore } from "../../stores";

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

const ME = "a".repeat(63) + "1";
const SOMEONE = "b".repeat(63) + "2";

function makeBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    id: "board-1",
    pubkey: ME,
    eventId: "evt",
    title: "Board",
    description: "",
    columns: [{ id: "todo", name: "To Do", order: 0 }],
    maintainers: [],
    members: [],
    noZap: false,
    createdAt: 1,
    isPrivate: false,
    legacy: false,
    rawTags: [],
    ...overrides,
  };
}

function makeComment(overrides: Partial<KanbanComment> = {}): KanbanComment {
  return {
    id: "c1",
    pubkey: SOMEONE,
    authorPubkey: SOMEONE,
    rotated: false,
    eventId: "evt-c1",
    boardCoordinate: `30301:${ME}:board-1`,
    cardId: "card-1",
    content: "First look",
    mentions: [],
    createdAt: Date.now(),
    rawTags: [],
    ...overrides,
  };
}

// The sdk mock types come from the real module, so vi.mocked keeps the
// facade's signatures throughout this suite.
const sdk = vi.mocked(kanbanSdk);

beforeEach(() => {
  // The dialog reads and writes the shared kanban store; a leftover card's
  // comments or load flag would leak between tests. Mock call counts leak the
  // same way — an earlier test's load would inflame this one's refetch count.
  vi.clearAllMocks();
  useKanbanStore.getState().reset();
});

describe("CardDialog comments", () => {
  it("shows no comments section without a board to scope them to", () => {
    renderDialog({ card: makeCard() });
    expect(screen.queryByText("Comments")).not.toBeInTheDocument();
  });

  it("loads and renders the card's comments, oldest first", async () => {
    const board = makeBoard();
    sdk.fetchComments.mockResolvedValue([
      makeComment({ content: "First look" }),
      makeComment({ id: "c2", authorPubkey: ME, content: "Ship it" }),
    ]);
    renderDialog({ card: makeCard(), board, self: ME });

    expect(await screen.findByText("First look")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(sdk.fetchComments).toHaveBeenCalledWith(board, "card-1");
    // Somebody else's comment carries their name fallback; the signer's own
    // comment reads as "You".
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("posts through the store with the card scoping and refetches", async () => {
    const board = makeBoard();
    const posted = makeComment({ id: "c3", authorPubkey: ME, content: "Nice progress" });
    // First round is the load on open (nothing yet); the second is the
    // refetch after the write comes back.
    sdk.fetchComments.mockResolvedValueOnce([]).mockResolvedValueOnce([posted]);
    sdk.createComment.mockResolvedValue(posted);
    renderDialog({ card: makeCard(), board, self: ME });

    await screen.findByText("No comments yet");
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "  Nice progress  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(sdk.createComment).toHaveBeenCalledWith(board, "card-1", {
      content: "Nice progress",
    });
    await screen.findByText("Nice progress");
    expect(sdk.fetchComments).toHaveBeenCalledTimes(2);
  });

  it("keeps the send button idle until there is text", async () => {
    sdk.fetchComments.mockResolvedValue([]);
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME });

    await screen.findByText("No comments yet");
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: " hi " } });
    expect(send).toBeEnabled();

    // Whitespace alone is still nothing to say.
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "   " } });
    expect(send).toBeDisabled();
  });

  it("lets a read-only viewer read comments but not write or delete", async () => {
    sdk.fetchComments.mockResolvedValue([makeComment()]);
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME, readOnly: true });

    expect(await screen.findByText("First look")).toBeInTheDocument();
    expect(screen.getByLabelText("Comment")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /delete comment/i })).not.toBeInTheDocument();
  });

  it("offers deletion only on own comments and removes it through the store", async () => {
    const mine = makeComment({ id: "mine", authorPubkey: ME, content: "my note" });
    const theirs = makeComment({ id: "theirs", content: "their note" });
    sdk.fetchComments.mockResolvedValue([mine, theirs]);
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME });

    expect(await screen.findByText("their note")).toBeInTheDocument();
    const deletes = screen.getAllByRole("button", { name: /delete comment/i });
    expect(deletes).toHaveLength(1);

    fireEvent.click(deletes[0]);
    await waitFor(() => expect(sdk.deleteComment).toHaveBeenCalledWith(mine));
    await waitFor(() => expect(screen.queryByText("my note")).not.toBeInTheDocument());
    // The other author's comment is untouched.
    expect(screen.getByText("their note")).toBeInTheDocument();
  });

  it("reports the comment load failure through the store's error", async () => {
    sdk.fetchComments.mockRejectedValue(new Error("relay down"));
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME });

    await waitFor(() => expect(useKanbanStore.getState().error).toBe("relay down"));
  });

  it("suggests board members when typing @ in the comment", async () => {
    sdk.fetchComments.mockResolvedValue([]);
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME, assigneeOptions: [ALICE] });

    await screen.findByText("No comments yet");
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "cc @" } });

    expect(await screen.findByText(formatNpub(ALICE))).toBeInTheDocument();
  });

  it("does not suggest anyone once the @ is followed by whitespace", async () => {
    sdk.fetchComments.mockResolvedValue([]);
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME, assigneeOptions: [ALICE] });

    await screen.findByText("No comments yet");
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "cc @ " } });

    expect(screen.queryByText(formatNpub(ALICE))).not.toBeInTheDocument();
  });

  it("inserts a picked mention inline and sends it along with the comment", async () => {
    const board = makeBoard();
    const posted = makeComment({
      id: "c4",
      authorPubkey: ME,
      content: `cc @${formatNpub(ALICE)}`,
      mentions: [ALICE],
    });
    sdk.fetchComments.mockResolvedValueOnce([]).mockResolvedValueOnce([posted]);
    sdk.createComment.mockResolvedValue(posted);
    renderDialog({ card: makeCard(), board, self: ME, assigneeOptions: [ALICE] });

    await screen.findByText("No comments yet");
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "cc @" } });
    fireEvent.click(await screen.findByText(formatNpub(ALICE)));

    // Picking the suggestion wrote the name into the text itself — no
    // separate "Mention" field left to find.
    expect(screen.getByLabelText("Comment")).toHaveValue(`cc @${formatNpub(ALICE)} `);
    expect(screen.queryByText(formatNpub(ALICE))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(sdk.createComment).toHaveBeenCalledWith(board, "card-1", {
        content: `cc @${formatNpub(ALICE)}`,
        mentions: [ALICE],
      }),
    );
  });

  it("drops a mention from the send if its @name is deleted from the text", async () => {
    const board = makeBoard();
    sdk.fetchComments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeComment({ id: "c5", authorPubkey: ME, content: "cc" })]);
    sdk.createComment.mockResolvedValue(makeComment({ id: "c5", authorPubkey: ME, content: "cc" }));
    renderDialog({ card: makeCard(), board, self: ME, assigneeOptions: [ALICE] });

    await screen.findByText("No comments yet");
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "cc @" } });
    fireEvent.click(await screen.findByText(formatNpub(ALICE)));
    // Backspace the inserted name back out by hand.
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "cc " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(sdk.createComment).toHaveBeenCalledWith(board, "card-1", { content: "cc" }),
    );
  });

  it("renders a comment's mentions as distinct chips", async () => {
    sdk.fetchComments.mockResolvedValue([makeComment({ content: "cc you", mentions: [ALICE] })]);
    renderDialog({ card: makeCard(), board: makeBoard(), self: ME });

    expect(await screen.findByText("cc you")).toBeInTheDocument();
    expect(screen.getByText(/@npub1/)).toBeInTheDocument();
  });
});
