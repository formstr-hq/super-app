import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeBoard } from "../../kanban/boardFixture";

import { CreateBoardDialog } from "./CreateBoardDialog";

const noop = () => {};

const THREE_COLUMNS = [
  { id: "todo", name: "To Do", order: 0 },
  { id: "doing", name: "In Progress", order: 1 },
  { id: "done", name: "Done", order: 2 },
];

function renderDialog(props: Partial<React.ComponentProps<typeof CreateBoardDialog>> = {}) {
  return render(
    <CreateBoardDialog open saving={false} onClose={noop} onSubmit={noop} {...props} />,
  );
}

/** The column name inputs, top to bottom. */
function columnNames(): string[] {
  return screen
    .getAllByRole("textbox", { name: /^Column \d+ name$/ })
    .map((input) => (input as HTMLInputElement).value);
}

afterEach(cleanup);

describe("CreateBoardDialog column order", () => {
  it("moves a column down and keeps the rest in order", () => {
    renderDialog({ board: makeBoard({ columns: THREE_COLUMNS }) });
    expect(columnNames()).toEqual(["To Do", "In Progress", "Done"]);

    fireEvent.click(screen.getByRole("button", { name: "Move To Do down" }));
    expect(columnNames()).toEqual(["In Progress", "To Do", "Done"]);
  });

  it("moves a column up", () => {
    renderDialog({ board: makeBoard({ columns: THREE_COLUMNS }) });
    fireEvent.click(screen.getByRole("button", { name: "Move Done up" }));
    expect(columnNames()).toEqual(["To Do", "Done", "In Progress"]);
  });

  it("cannot move the first column up or the last one down", () => {
    renderDialog({ board: makeBoard({ columns: THREE_COLUMNS }) });
    expect(screen.getByRole("button", { name: "Move To Do up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Done down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move To Do down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Done up" })).toBeEnabled();
  });

  it("submits the new order with renumbered order values", () => {
    const onSubmit = vi.fn();
    renderDialog({ board: makeBoard({ columns: THREE_COLUMNS }), onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "Move Done up" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].columns).toEqual([
      { id: "todo", name: "To Do", order: 0 },
      { id: "done", name: "Done", order: 1 },
      { id: "doing", name: "In Progress", order: 2 },
    ]);
  });

  it("keeps a rename that has not been submitted yet when the column moves", () => {
    renderDialog({ board: makeBoard({ columns: THREE_COLUMNS }) });

    fireEvent.change(screen.getByRole("textbox", { name: "Column 1 name" }), {
      target: { value: "Backlog" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move Backlog down" }));

    expect(columnNames()).toEqual(["In Progress", "Backlog", "Done"]);
  });

  it("offers reordering while creating a board too", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Move To Do down" })).toBeEnabled();
  });

  it("has nothing to reorder on a one-column board", () => {
    renderDialog({ board: makeBoard({ columns: [{ id: "only", name: "Only", order: 0 }] }) });
    expect(screen.getByRole("button", { name: "Move Only up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Only down" })).toBeDisabled();
  });
});
