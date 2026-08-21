import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeBoard } from "../../kanban/boardFixture";

import { CreateBoardDialog } from "./CreateBoardDialog";

const noop = () => {};

function renderDialog(props: Partial<React.ComponentProps<typeof CreateBoardDialog>> = {}) {
  return render(
    <CreateBoardDialog open saving={false} onClose={noop} onSubmit={noop} {...props} />,
  );
}

const columnNames = () =>
  screen
    .getAllByRole("textbox", { name: /^Column \d+ name$/ })
    .map((i) => (i as HTMLInputElement).value);

afterEach(cleanup);

describe("CreateBoardDialog column reordering", () => {
  const threeColumns = makeBoard({
    columns: [
      { id: "todo", name: "To Do", order: 0 },
      { id: "doing", name: "In Progress", order: 1 },
      { id: "done", name: "Done", order: 2 },
    ],
  });

  it("moves a column down", () => {
    renderDialog({ board: threeColumns });
    fireEvent.click(screen.getByRole("button", { name: "Move To Do down" }));

    expect(columnNames()).toEqual(["In Progress", "To Do", "Done"]);
  });

  it("moves a column up", () => {
    renderDialog({ board: threeColumns });
    fireEvent.click(screen.getByRole("button", { name: "Move Done up" }));

    expect(columnNames()).toEqual(["To Do", "Done", "In Progress"]);
  });

  it("publishes the new order, renumbered from zero", () => {
    const onSubmit = vi.fn();
    renderDialog({ board: threeColumns, onSubmit });
    fireEvent.click(screen.getByRole("button", { name: "Move To Do down" }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: [
          { id: "doing", name: "In Progress", order: 0 },
          { id: "todo", name: "To Do", order: 1 },
          { id: "done", name: "Done", order: 2 },
        ],
      }),
    );
  });

  it("will not move the first column up or the last one down", () => {
    renderDialog({ board: threeColumns });

    expect(screen.getByRole("button", { name: "Move To Do up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Done down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move To Do down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Done up" })).toBeEnabled();
  });

  it("keeps a rename attached to its column across a move", () => {
    const onSubmit = vi.fn();
    renderDialog({ board: threeColumns, onSubmit });

    fireEvent.change(screen.getAllByRole("textbox", { name: /^Column \d+ name$/ })[0], {
      target: { value: "Backlog" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move Backlog down" }));

    expect(columnNames()).toEqual(["In Progress", "Backlog", "Done"]);
  });
});
