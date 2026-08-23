import { DndContext } from "@dnd-kit/core";
import type { KanbanCard } from "@formstr/kanban-sdk";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { avatarInitials } from "../../lib/pubkeyAvatar";

import { KanbanCardItem } from "./KanbanCardItem";

const PUBKEY = "a".repeat(63) + "b";

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: "9b17d4c8e2f04a6b",
    pubkey: "pk",
    authorPubkey: "pk",
    rotated: false,
    eventId: "evt",
    boardCoordinate: "30301:pk:board",
    title: "Publish the SDK",
    description: "",
    status: "todo",
    rank: 0,
    attachments: [],
    assignees: [],
    labels: [],
    links: [],
    binned: false,
    isPrivate: false,
    createdAt: 1,
    rawTags: [],
    ...overrides,
  };
}

function renderCard(card: KanbanCard) {
  render(
    <DndContext>
      <KanbanCardItem card={card} disabled={false} onOpen={() => {}} />
    </DndContext>,
  );
}

afterEach(cleanup);

describe("KanbanCardItem", () => {
  it("shows the shortened card key", () => {
    renderCard(makeCard());
    expect(screen.getByText("9b17·4a6b")).toBeInTheDocument();
  });

  it("shows two labels and collapses the rest", () => {
    renderCard(makeCard({ labels: ["bug", "app", "sdk", "release"] }));
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.queryByText("sdk")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders an assignee as initials derived from the pubkey", () => {
    renderCard(makeCard({ assignees: [PUBKEY] }));
    expect(screen.getByText(avatarInitials(PUBKEY))).toBeInTheDocument();
  });

  it("counts links and attachments only when there are some", () => {
    renderCard(makeCard({ links: [], attachments: [] }));
    expect(screen.queryByText("2")).not.toBeInTheDocument();

    cleanup();
    renderCard(
      makeCard({
        attachments: ["blob-1", "blob-2"],
        links: [
          {
            boardPubkey: "pk",
            boardDTag: "board",
            cardDTag: "other",
            forwardLabel: "blocks",
            reverseLabel: "blocked by",
          },
        ],
      }),
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("falls back to a placeholder title", () => {
    renderCard(makeCard({ title: "" }));
    expect(screen.getByText("Untitled card")).toBeInTheDocument();
  });
});
