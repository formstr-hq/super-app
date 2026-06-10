import { describe, expect, it } from "vitest";

import { buildFieldTag, parseFieldTag } from "./fieldCodec";
import { AnswerType, type FormField } from "./types";

/**
 * Wire format pinned against the standalone formstr.app
 * (upstream/nostr-forms/packages/formstr-app):
 *
 *   ["field", id, PRIMITIVE, label, optionsJSON, answerSettingsJSON]
 *
 * Slot 3 is a *primitive* (text/option/grid/...); the widget type is
 * `answerSettings.renderElement` — formstr.app's filler picks the input
 * component exclusively from `renderElement` (FormFillerNew/InputFiller.tsx).
 */
const field = (overrides: Partial<FormField>): FormField => ({
  id: "f1",
  type: AnswerType.shortText,
  label: "Q",
  ...overrides,
});

const config = (tag: string[]) => JSON.parse(tag[5]);

describe("buildFieldTag — primitive + renderElement (upstream parity)", () => {
  const cases: Array<[AnswerType, string]> = [
    [AnswerType.label, "label"],
    [AnswerType.section, "section"],
    [AnswerType.shortText, "text"],
    [AnswerType.paragraph, "text"],
    [AnswerType.date, "text"],
    [AnswerType.time, "text"],
    [AnswerType.signature, "text"],
    [AnswerType.number, "number"],
    [AnswerType.radioButton, "option"],
    [AnswerType.checkboxes, "option"],
    [AnswerType.dropdown, "option"],
    [AnswerType.fileUpload, "file"],
    [AnswerType.datetime, "datetime"],
    [AnswerType.multipleChoiceGrid, "grid"],
    [AnswerType.checkboxGrid, "grid"],
    [AnswerType.rating, "rating"],
  ];

  it.each(cases)("%s → primitive '%s' with matching renderElement", (type, primitive) => {
    const tag = buildFieldTag(field({ type }));
    expect(tag[0]).toBe("field");
    expect(tag[1]).toBe("f1");
    expect(tag[2]).toBe(primitive);
    expect(tag[3]).toBe("Q");
    expect(config(tag).renderElement).toBe(type);
  });

  it("serializes choice options as [id, label] tuples", () => {
    const tag = buildFieldTag(
      field({
        type: AnswerType.radioButton,
        options: [
          { id: "o1", label: "Yes" },
          { id: "o2", label: "No" },
        ],
      }),
    );
    expect(JSON.parse(tag[4])).toEqual([
      ["o1", "Yes"],
      ["o2", "No"],
    ]);
  });

  it("serializes grid fields as GridOptions {rows, columns} in the options slot", () => {
    const tag = buildFieldTag(
      field({
        type: AnswerType.checkboxGrid,
        gridRows: ["Row A", "Row B"],
        gridCols: ["Col 1", "Col 2", "Col 3"],
      }),
    );
    const options = JSON.parse(tag[4]);
    expect(options.rows.map((r: string[]) => r[1])).toEqual(["Row A", "Row B"]);
    expect(options.columns.map((c: string[]) => c[1])).toEqual(["Col 1", "Col 2", "Col 3"]);
    // every row/column carries an id in slot 0
    expect(options.rows.every((r: string[]) => typeof r[0] === "string" && r[0].length > 0)).toBe(
      true,
    );
    expect(config(tag).allowMultiplePerRow).toBe(true); // checkboxGrid
  });

  it("multipleChoiceGrid sets allowMultiplePerRow=false", () => {
    const tag = buildFieldTag(
      field({ type: AnswerType.multipleChoiceGrid, gridRows: ["R"], gridCols: ["C"] }),
    );
    expect(config(tag).allowMultiplePerRow).toBe(false);
  });

  it("serializes rating maxStars", () => {
    const tag = buildFieldTag(field({ type: AnswerType.rating, maxStars: 7 }));
    expect(config(tag).maxStars).toBe(7);
  });

  it("maps validation to upstream validationRules", () => {
    const tag = buildFieldTag(
      field({
        validation: { min: 2, max: 10, regex: "^a+$", regexError: "Only a's" },
      }),
    );
    expect(config(tag).validationRules).toEqual({
      min: { min: 2 },
      max: { max: 10 },
      regex: { pattern: "^a+$", errorMessage: "Only a's" },
    });
  });

  it("maps fileConfig to blossomServer/maxFileSize(MB)/allowedTypes", () => {
    const tag = buildFieldTag(
      field({
        type: AnswerType.fileUpload,
        fileConfig: {
          blossomServer: "https://blossom.example",
          maxBytes: 5 * 1024 * 1024,
          mimeTypes: ["image/"],
        },
      }),
    );
    const c = config(tag);
    expect(c.blossomServer).toBe("https://blossom.example");
    expect(c.maxFileSize).toBe(5);
    expect(c.allowedTypes).toEqual(["image/"]);
  });

  it("carries required and placeholder", () => {
    const tag = buildFieldTag(field({ required: true, placeholder: "Type here" }));
    expect(config(tag).required).toBe(true);
    expect(config(tag).placeholder).toBe("Type here");
  });
});

describe("parseFieldTag — reads upstream-authored fields", () => {
  it("resolves the type from renderElement, not the primitive", () => {
    const f = parseFieldTag([
      "field",
      "abc123",
      "text",
      "Your birthday",
      "[]",
      '{"renderElement":"date","required":true}',
    ]);
    expect(f.type).toBe(AnswerType.date);
    expect(f.required).toBe(true);
  });

  it("parses upstream grid options into gridRows/gridCols", () => {
    const f = parseFieldTag([
      "field",
      "g1",
      "grid",
      "Rate these",
      JSON.stringify({
        rows: [
          ["r1", "Speed"],
          ["r2", "Quality"],
        ],
        columns: [
          ["c1", "Bad"],
          ["c2", "Good"],
        ],
      }),
      '{"renderElement":"multipleChoiceGrid"}',
    ]);
    expect(f.type).toBe(AnswerType.multipleChoiceGrid);
    expect(f.gridRows).toEqual(["Speed", "Quality"]);
    expect(f.gridCols).toEqual(["Bad", "Good"]);
  });

  it("parses rating maxStars", () => {
    const f = parseFieldTag([
      "field",
      "r1",
      "rating",
      "Stars",
      "[]",
      '{"renderElement":"rating","maxStars":10}',
    ]);
    expect(f.type).toBe(AnswerType.rating);
    expect(f.maxStars).toBe(10);
  });

  it("maps validationRules back to validation", () => {
    const f = parseFieldTag([
      "field",
      "v1",
      "text",
      "Name",
      "[]",
      JSON.stringify({
        renderElement: "shortText",
        validationRules: {
          min: { min: 2 },
          max: { max: 10 },
          regex: { pattern: "^a+$", errorMessage: "Only a's" },
        },
      }),
    ]);
    expect(f.validation).toEqual({ min: 2, max: 10, regex: "^a+$", regexError: "Only a's" });
  });

  it("maps file settings back to fileConfig", () => {
    const f = parseFieldTag([
      "field",
      "u1",
      "file",
      "Upload",
      "[]",
      JSON.stringify({
        renderElement: "fileUpload",
        blossomServer: "https://blossom.example",
        maxFileSize: 5,
        allowedTypes: ["image/"],
      }),
    ]);
    expect(f.fileConfig).toEqual({
      blossomServer: "https://blossom.example",
      maxBytes: 5 * 1024 * 1024,
      mimeTypes: ["image/"],
    });
  });
});

describe("parseFieldTag — legacy + fallback type resolution", () => {
  it("accepts legacy super-app tags with the AnswerType in slot 3", () => {
    const f = parseFieldTag(["field", "f1", "shortText", "Name", "[]", '{"required":false}']);
    expect(f.type).toBe(AnswerType.shortText);
  });

  it("normalizes the legacy 'multiChoiceGrid' enum string", () => {
    const f = parseFieldTag(["field", "f1", "multiChoiceGrid", "Grid", "[]", "{}"]);
    expect(f.type).toBe(AnswerType.multipleChoiceGrid);
  });

  it("falls back to a sensible default per primitive", () => {
    expect(parseFieldTag(["field", "f1", "text", "Q", "[]", "{}"]).type).toBe(
      AnswerType.shortText,
    );
    expect(parseFieldTag(["field", "f2", "option", "Q", "[]", "{}"]).type).toBe(
      AnswerType.radioButton,
    );
    expect(parseFieldTag(["field", "f3", "grid", "Q", "[]", "{}"]).type).toBe(
      AnswerType.multipleChoiceGrid,
    );
    expect(parseFieldTag(["field", "f4", "file", "Q", "[]", "{}"]).type).toBe(
      AnswerType.fileUpload,
    );
  });

  it("tolerates a malformed config JSON", () => {
    const f = parseFieldTag(["field", "f1", "text", "Q", "[]", "not-json"]);
    expect(f.type).toBe(AnswerType.shortText);
    expect(f.label).toBe("Q");
  });
});

describe("field codec round-trip", () => {
  it("build → parse preserves a rich field", () => {
    const original = field({
      type: AnswerType.checkboxes,
      label: "Pick some",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      required: true,
      placeholder: "choose",
      validation: { min: 1, max: 2 },
    });
    const parsed = parseFieldTag(buildFieldTag(original));
    expect(parsed.type).toBe(AnswerType.checkboxes);
    expect(parsed.options).toEqual(original.options);
    expect(parsed.required).toBe(true);
    expect(parsed.placeholder).toBe("choose");
    expect(parsed.validation).toEqual({ min: 1, max: 2 });
  });

  it("build → parse preserves a grid field's rows/cols", () => {
    const original = field({
      type: AnswerType.multipleChoiceGrid,
      gridRows: ["R1", "R2"],
      gridCols: ["C1"],
    });
    const parsed = parseFieldTag(buildFieldTag(original));
    expect(parsed.gridRows).toEqual(["R1", "R2"]);
    expect(parsed.gridCols).toEqual(["C1"]);
  });
});
