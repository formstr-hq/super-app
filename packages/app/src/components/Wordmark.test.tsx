import { ThemeProvider } from "@mui/material/styles";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, it, expect } from "vitest";

import { accentInk } from "../lib/moduleAccent";
import { getTheme } from "../theme";

import { Wordmark } from "./Wordmark";

afterEach(cleanup);

function renderAt(path: string, mode: "light" | "dark" = "light") {
  return render(
    <ThemeProvider theme={getTheme(mode)}>
      <MemoryRouter initialEntries={[path]}>
        <Wordmark />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/** The asterisk is the last path; the first is the "form" lettering. */
const starFill = (c: HTMLElement) => {
  const paths = c.querySelectorAll("path");
  return paths[paths.length - 1].getAttribute("fill");
};

describe("Wordmark", () => {
  it("paints the asterisk with the active module's ink", () => {
    const { container } = renderAt("/kanban");
    // A light page draws a dark lozenge, so the asterisk takes the dark ink.
    expect(starFill(container)).toBe(accentInk("kanban", "dark"));
  });

  it("changes ink with the module", () => {
    const { container: kanban } = renderAt("/kanban");
    const kanbanInk = starFill(kanban);
    cleanup();
    const { container: drive } = renderAt("/drive");
    expect(starFill(drive)).not.toBe(kanbanInk);
  });

  it("flips to the light ink when the lozenge is light", () => {
    const { container } = renderAt("/forms", "dark");
    expect(starFill(container)).toBe(accentInk("forms", "light"));
  });

  it("falls back to the neutral ink off the modules", () => {
    const { container } = renderAt("/settings");
    expect(starFill(container)).toBe(accentInk(null, "dark"));
  });

  it("keeps the lettering readable against the lozenge", () => {
    const { container } = renderAt("/forms");
    const theme = getTheme("light");
    const paths = container.querySelectorAll("path");
    expect(paths[0].getAttribute("fill")).toBe(theme.palette.background.default);
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe(theme.palette.text.primary);
  });
});
