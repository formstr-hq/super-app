import { describe, it, expect } from "vitest";

import { htmlToMarkdown, markdownToHtml } from "./markdownBridge";

describe("markdownToHtml", () => {
  // Regression: an "empty" list-item line (marker + whitespace, no content) used to
  // match the list test regex but fail the `(.+)` capture, so the inner loop broke
  // without advancing the cursor and the outer loop spun forever — freezing the app
  // whenever such a page was opened.
  it("does not hang on an empty bullet item and renders it as an empty list item", () => {
    expect(markdownToHtml("- ")).toBe("<ul><li><p></p></li></ul>");
  });

  it("does not hang on an empty ordered item", () => {
    expect(markdownToHtml("1. ")).toBe("<ol><li><p></p></li></ol>");
  });

  it("does not hang on an empty task item", () => {
    expect(markdownToHtml("- [ ] ")).toBe(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
    );
  });

  it("handles an empty bullet interleaved with real items", () => {
    expect(markdownToHtml("- one\n- \n- two")).toBe(
      "<ul><li><p>one</p></li><li><p></p></li><li><p>two</p></li></ul>",
    );
  });

  it("renders normal bullet and ordered lists", () => {
    expect(markdownToHtml("- a\n- b")).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    expect(markdownToHtml("1. a\n2. b")).toBe("<ol><li><p>a</p></li><li><p>b</p></li></ol>");
  });

  it("renders headings, paragraphs and inline marks", () => {
    expect(markdownToHtml("# Title")).toBe("<h1>Title</h1>");
    expect(markdownToHtml("hello **world**")).toBe("<p>hello <strong>world</strong></p>");
  });
});

describe("markdown round-trip", () => {
  it("survives content containing an empty bullet without hanging", () => {
    const md = "# Notes\n\n- first\n- \n- third";
    // Should complete (not freeze) and keep the real items.
    const back = htmlToMarkdown(markdownToHtml(md));
    expect(back).toContain("# Notes");
    expect(back).toContain("- first");
    expect(back).toContain("- third");
  });
});
