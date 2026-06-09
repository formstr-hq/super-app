import {
  AnswerType,
  type FormResponseEvent,
  type FormTemplate,
} from "@formstr/agent/services/forms/types";
import { describe, it, expect } from "vitest";

import { responsesToCsv, responsesToJson } from "./exportResponses";

const form: FormTemplate = {
  id: "f1",
  name: "Survey",
  pubkey: "p".repeat(64),
  createdAt: 0,
  isEncrypted: false,
  settings: {},
  fields: [
    { id: "q1", type: AnswerType.shortText, label: "Name" },
    {
      id: "q2",
      type: AnswerType.checkboxes,
      label: "Likes",
      options: [
        { id: "o1", label: "Cats" },
        { id: "o2", label: "Dogs" },
      ],
    },
    { id: "q3", type: AnswerType.label, label: "Section header" },
  ],
};

const responses: FormResponseEvent[] = [
  {
    id: "r1",
    pubkey: "a".repeat(64),
    createdAt: 1700000000,
    event: {} as never,
    responses: [
      { fieldId: "q1", answer: "Alice, the great" },
      { fieldId: "q2", answer: JSON.stringify(["o1", "o2"]) },
    ],
  },
];

describe("responsesToCsv", () => {
  it("maps checkbox option ids to labels and joins them", () => {
    const csv = responsesToCsv(form, responses);
    expect(csv).toContain("Cats; Dogs");
  });

  it("excludes label/section fields from columns", () => {
    const csv = responsesToCsv(form, responses);
    expect(csv).not.toContain("Section header");
  });

  it("escapes values containing commas", () => {
    const csv = responsesToCsv(form, responses);
    expect(csv).toContain('"Alice, the great"');
  });

  it("includes a Responder column with the npub", () => {
    const csv = responsesToCsv(form, responses);
    const header = csv.split("\n")[0];
    expect(header).toContain("Responder");
  });
});

describe("responsesToJson", () => {
  it("serialises the raw responses array", () => {
    const json = JSON.parse(responsesToJson(responses));
    expect(json).toHaveLength(1);
    expect(json[0].responses[0].answer).toBe("Alice, the great");
  });
});
