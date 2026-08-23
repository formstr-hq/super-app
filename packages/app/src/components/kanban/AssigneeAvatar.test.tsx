import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProfile = vi.hoisted(() => vi.fn());
vi.mock("@formstr/agent/services/profile", () => ({ fetchProfile }));

import { resetProfileCache } from "../../lib/profileCache";
import { avatarInitials } from "../../lib/pubkeyAvatar";

import { AssigneeAvatar } from "./AssigneeAvatar";

const PUBKEY = "a".repeat(63) + "b";
const PICTURE = "https://example.invalid/face.png";

function profile(overrides: Record<string, unknown> = {}) {
  return { pubkey: PUBKEY, createdAt: 1, ...overrides };
}

beforeEach(() => {
  resetProfileCache();
  fetchProfile.mockReset();
  fetchProfile.mockResolvedValue(null);
});
afterEach(cleanup);

describe("AssigneeAvatar", () => {
  // First paint happens before any relay answers, on every board.
  it("shows the npub initials while the profile is still in flight", () => {
    render(<AssigneeAvatar pubkey={PUBKEY} />);
    expect(screen.getByText(avatarInitials(PUBKEY))).toBeInTheDocument();
  });

  it("shows the kind-0 picture once it arrives", async () => {
    fetchProfile.mockResolvedValue(profile({ picture: PICTURE, displayName: "Ada Lovelace" }));
    render(<AssigneeAvatar pubkey={PUBKEY} />);

    const image = await screen.findByRole("img", { name: "Ada Lovelace" });
    expect(image).toHaveAttribute("src", PICTURE);
    expect(screen.queryByText(avatarInitials(PUBKEY))).not.toBeInTheDocument();
  });

  it("falls back to the name's initials when the profile carries no picture", async () => {
    fetchProfile.mockResolvedValue(profile({ displayName: "Naman Khandelwal" }));
    render(<AssigneeAvatar pubkey={PUBKEY} />);

    await waitFor(() => expect(screen.getByText("NK")).toBeInTheDocument());
  });

  it("prefers display_name over name for the initials", async () => {
    fetchProfile.mockResolvedValue(profile({ name: "zed", displayName: "Ada Lovelace" }));
    render(<AssigneeAvatar pubkey={PUBKEY} />);

    await waitFor(() => expect(screen.getByText("AL")).toBeInTheDocument());
  });

  it("keeps the npub initials for a profile with neither picture nor name", async () => {
    fetchProfile.mockResolvedValue(profile());
    render(<AssigneeAvatar pubkey={PUBKEY} />);

    await waitFor(() => expect(fetchProfile).toHaveBeenCalled());
    expect(screen.getByText(avatarInitials(PUBKEY))).toBeInTheDocument();
  });

  // Picture URLs rot: the host disappears, the file 404s, the CDN blocks the
  // referrer. A broken image element is worse than no image at all.
  it("falls back to initials when the picture fails to load", async () => {
    fetchProfile.mockResolvedValue(profile({ picture: PICTURE, displayName: "Ada Lovelace" }));
    render(<AssigneeAvatar pubkey={PUBKEY} />);

    fireEvent.error(await screen.findByRole("img", { name: "Ada Lovelace" }));

    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
