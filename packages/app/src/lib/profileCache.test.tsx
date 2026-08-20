import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@formstr/agent/services/profile", () => ({
  fetchProfile: vi.fn(),
}));

import { fetchProfile } from "@formstr/agent/services/profile";

import { resetProfileCache, useProfileName } from "./profileCache";

const fetchProfileMock = vi.mocked(fetchProfile);
const PUBKEY = "a".repeat(64);

function Name({ pubkey }: { pubkey: string }) {
  return <span data-testid="name">{useProfileName(pubkey)}</span>;
}

beforeEach(() => {
  resetProfileCache();
  fetchProfileMock.mockReset();
});

afterEach(() => {
  resetProfileCache();
});

describe("useProfileName", () => {
  it("shows the short npub first, then the kind-0 name", async () => {
    fetchProfileMock.mockResolvedValue({ pubkey: PUBKEY, displayName: "Alice", createdAt: 1 });

    render(<Name pubkey={PUBKEY} />);
    expect(screen.getByTestId("name").textContent).toMatch(/^npub1/);

    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Alice"));
  });

  it("falls back to `name` when there is no display name", async () => {
    fetchProfileMock.mockResolvedValue({ pubkey: PUBKEY, name: "bob", createdAt: 1 });

    render(<Name pubkey={PUBKEY} />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("bob"));
  });

  it("fetches once for many rows sharing a pubkey", async () => {
    fetchProfileMock.mockResolvedValue({ pubkey: PUBKEY, displayName: "Alice", createdAt: 1 });

    render(
      <>
        <Name pubkey={PUBKEY} />
        <Name pubkey={PUBKEY} />
        <Name pubkey={PUBKEY} />
      </>,
    );

    await waitFor(() => expect(screen.getAllByTestId("name")[2]).toHaveTextContent("Alice"));
    expect(fetchProfileMock).toHaveBeenCalledTimes(1);
  });

  it("caches a missing profile so it is not re-queried", async () => {
    fetchProfileMock.mockResolvedValue(null);

    const first = render(<Name pubkey={PUBKEY} />);
    await waitFor(() => expect(fetchProfileMock).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<Name pubkey={PUBKEY} />);
    await waitFor(() => expect(screen.getByTestId("name").textContent).toMatch(/^npub1/));
    expect(fetchProfileMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the npub when the lookup rejects", async () => {
    fetchProfileMock.mockRejectedValue(new Error("relay down"));

    render(<Name pubkey={PUBKEY} />);
    await waitFor(() => expect(fetchProfileMock).toHaveBeenCalled());
    expect(screen.getByTestId("name").textContent).toMatch(/^npub1/);
  });
});
