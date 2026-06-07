import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("./FormAnalytics", () => ({
  FormAnalytics: () => <div data-testid="analytics">Analytics</div>,
}));

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

import {
  AnswerType,
  type FormTemplate,
  type FormResponseEvent,
} from "@formstr/agent/services/forms/types";

import { ResponsesDialog } from "./ResponsesDialog";

const mockForm: FormTemplate = {
  id: "form1",
  name: "My Survey",
  pubkey: "pub1",
  createdAt: 0,
  isEncrypted: false,
  settings: {},
  fields: [{ id: "q1", type: AnswerType.shortText, label: "Name", required: false }],
};

const mockResponses: FormResponseEvent[] = [
  {
    id: "r1",
    pubkey: "responder1",
    responses: [{ fieldId: "q1", answer: "Alice" }],
    createdAt: 1700000000,
    event: {} as any,
  },
  {
    id: "r2",
    pubkey: "responder2",
    responses: [{ fieldId: "q1", answer: "Bob" }],
    createdAt: 1700001000,
    event: {} as any,
  },
];

describe("ResponsesDialog", () => {
  it("shows skeleton when loading", () => {
    render(<ResponsesDialog open form={null} responses={[]} isLoading onClose={vi.fn()} />);
    // Dialog renders in a portal, query document.body
    expect(document.body.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
  });

  it("shows empty state text when responses=[]", () => {
    render(
      <ResponsesDialog open form={mockForm} responses={[]} isLoading={false} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/no responses yet/i)).toBeInTheDocument();
  });

  it("renders response count in title", () => {
    render(
      <ResponsesDialog
        open
        form={mockForm}
        responses={mockResponses}
        isLoading={false}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("renders a row for each response", () => {
    render(
      <ResponsesDialog
        open
        form={mockForm}
        responses={mockResponses}
        isLoading={false}
        onClose={vi.fn()}
      />,
    );
    // Use getAllByText to handle any aria duplicates MUI may render
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
  });

  it("renders FormAnalytics when Analytics tab is clicked", () => {
    render(
      <ResponsesDialog
        open
        form={mockForm}
        responses={mockResponses}
        isLoading={false}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /analytics/i }));
    expect(screen.getByTestId("analytics")).toBeInTheDocument();
  });
});
