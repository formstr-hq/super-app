import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_FILTER } from "../../kanban/cardFilter";

import { BoardToolbar } from "./BoardToolbar";

function renderToolbar(props: Partial<React.ComponentProps<typeof BoardToolbar>> = {}) {
  const onChange = vi.fn();
  render(
    <BoardToolbar
      filter={EMPTY_FILTER}
      onChange={onChange}
      labels={["bug", "release"]}
      canFilterMine
      matchCount={3}
      totalCount={9}
      {...props}
    />,
  );
  return onChange;
}

afterEach(cleanup);

describe("BoardToolbar", () => {
  it("reports typed queries", () => {
    const onChange = renderToolbar();
    fireEvent.change(screen.getByLabelText("Search cards"), { target: { value: "sdk" } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, query: "sdk" });
  });

  it("hides the assigned-to-me chip when signed out", () => {
    renderToolbar({ canFilterMine: false });
    expect(screen.queryByText("Assigned to me")).not.toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("toggles a label on and back off", () => {
    const onChange = renderToolbar();
    fireEvent.click(screen.getByText("bug"));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, labels: ["bug"] });

    cleanup();
    const onChangeAgain = renderToolbar({ filter: { ...EMPTY_FILTER, labels: ["bug"] } });
    fireEvent.click(screen.getByText("bug"));
    expect(onChangeAgain).toHaveBeenCalledWith({ ...EMPTY_FILTER, labels: [] });
  });

  it("shows the match count and a reset only while a filter is on", () => {
    renderToolbar();
    expect(screen.queryByText("3 of 9")).not.toBeInTheDocument();

    cleanup();
    const onChange = renderToolbar({ filter: { ...EMPTY_FILTER, unassigned: true } });
    expect(screen.getByText("3 of 9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTER);
  });

  it("caps the label chips it will show", () => {
    renderToolbar({ labels: ["a", "b", "c", "d", "e", "f", "g", "h"] });
    expect(screen.getByText("f")).toBeInTheDocument();
    expect(screen.queryByText("g")).not.toBeInTheDocument();
  });
});
