import { render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const getRelaysForModule = vi.fn();
const listConnectionStatus = vi.fn();

vi.mock("@formstr/core", () => ({
  relayManager: { getRelaysForModule: (m: string) => getRelaysForModule(m) },
  nostrRuntime: { pool: { listConnectionStatus: () => listConnectionStatus() } },
}));

import { RelayStatus } from "./RelayStatus";

beforeEach(() => {
  vi.clearAllMocks();
  getRelaysForModule.mockReturnValue(["wss://a.test", "wss://b.test", "wss://c.test"]);
  listConnectionStatus.mockReturnValue(new Map());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const arms = () => document.querySelectorAll("[data-relay-arm]");

describe("RelayStatus", () => {
  it("draws one arm per relay the module publishes to", () => {
    render(<RelayStatus module="kanban" />);
    expect(getRelaysForModule).toHaveBeenCalledWith("kanban");
    expect(arms()).toHaveLength(3);
  });

  it("lights only the relays the pool reports as connected", () => {
    listConnectionStatus.mockReturnValue(
      new Map([
        ["wss://a.test", true],
        ["wss://b.test", false],
      ]),
    );
    render(<RelayStatus module="kanban" />);
    const states = [...arms()].map((a) => a.getAttribute("data-relay-arm"));
    // c.test was never contacted — idle, not down.
    expect(states).toEqual(["connected", "down", "idle"]);
  });

  it("names the connected count for screen readers", () => {
    listConnectionStatus.mockReturnValue(
      new Map([
        ["wss://a.test", true],
        ["wss://b.test", true],
      ]),
    );
    render(<RelayStatus module="kanban" />);
    expect(screen.getByRole("img")).toHaveAccessibleName("2 of 3 relays connected");
  });

  it("re-reads connection status on an interval", () => {
    vi.useFakeTimers();
    render(<RelayStatus module="kanban" />);
    expect([...arms()].every((a) => a.getAttribute("data-relay-arm") === "idle")).toBe(true);

    listConnectionStatus.mockReturnValue(new Map([["wss://a.test", true]]));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(arms()[0].getAttribute("data-relay-arm")).toBe("connected");
  });

  it("stops polling once unmounted", () => {
    vi.useFakeTimers();
    const { unmount } = render(<RelayStatus module="kanban" />);
    const callsAtMount = listConnectionStatus.mock.calls.length;
    unmount();
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(listConnectionStatus.mock.calls.length).toBe(callsAtMount);
  });
});
