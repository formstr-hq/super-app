import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { makeBoard } from "./boardFixture";
import { assignableRoles, boardMembers, canManageMembers, parseInvitee, roleOf } from "./roles";

const OWNER = "a".repeat(64);
const EDITOR = "b".repeat(64);
const VIEWER = "c".repeat(64);
const STRANGER = "d".repeat(64);

const board = makeBoard({ pubkey: OWNER, maintainers: [EDITOR], members: [VIEWER] });

describe("roleOf", () => {
  it("reads every role off the board's own tags", () => {
    expect(roleOf(board, OWNER)).toBe("owner");
    expect(roleOf(board, EDITOR)).toBe("maintainer");
    expect(roleOf(board, VIEWER)).toBe("member");
  });

  it("is null for a stranger and for a signed-out user", () => {
    expect(roleOf(board, STRANGER)).toBeNull();
    expect(roleOf(board, null)).toBeNull();
  });

  it("prefers owner when the owner also appears in a member list", () => {
    const odd = makeBoard({ pubkey: OWNER, maintainers: [OWNER] });
    expect(roleOf(odd, OWNER)).toBe("owner");
  });
});

describe("canManageMembers", () => {
  it("is the owner alone — a maintainer's write would throw NotBoardOwnerError", () => {
    expect(canManageMembers(board, OWNER)).toBe(true);
    expect(canManageMembers(board, EDITOR)).toBe(false);
    expect(canManageMembers(board, VIEWER)).toBe(false);
    expect(canManageMembers(board, null)).toBe(false);
  });
});

describe("boardMembers", () => {
  it("lists the owner first, then editors, then viewers", () => {
    expect(boardMembers(board)).toEqual([
      { pubkey: OWNER, role: "owner" },
      { pubkey: EDITOR, role: "maintainer" },
      { pubkey: VIEWER, role: "member" },
    ]);
  });

  it("is the owner alone on an empty board", () => {
    expect(boardMembers(makeBoard({ pubkey: OWNER }))).toEqual([{ pubkey: OWNER, role: "owner" }]);
  });
});

describe("assignableRoles", () => {
  it("offers the read-only role only where there is a key to withhold", () => {
    expect(assignableRoles(makeBoard({ isPrivate: true }))).toEqual(["maintainer", "member"]);
    expect(assignableRoles(makeBoard({ isPrivate: false }))).toEqual(["maintainer"]);
  });
});

describe("parseInvitee", () => {
  it("accepts a hex pubkey", () => {
    expect(parseInvitee(STRANGER, board, OWNER)).toEqual({ pubkey: STRANGER });
  });

  it("accepts an npub and returns hex", () => {
    const npub = nip19.npubEncode(STRANGER);
    expect(parseInvitee(` ${npub} `, board, OWNER)).toEqual({ pubkey: STRANGER });
  });

  it("rejects empty and malformed input", () => {
    expect(parseInvitee("   ", board, OWNER)).toEqual({
      error: "Enter an npub or a hex public key.",
    });
    expect(parseInvitee("nope", board, OWNER)).toEqual({
      error: "That is not a valid npub or 64-character hex public key.",
    });
  });

  it("rejects the owner, naming them as you when you are the owner", () => {
    expect(parseInvitee(OWNER, board, OWNER)).toEqual({
      error: "That is you — you own this board.",
    });
    expect(parseInvitee(OWNER, board, EDITOR)).toEqual({ error: "That is the owner." });
  });

  it("rejects someone the board already lists", () => {
    expect(parseInvitee(EDITOR, board, OWNER)).toEqual({
      error: "Already an editor on this board.",
    });
    expect(parseInvitee(VIEWER, board, OWNER)).toEqual({
      error: "Already a viewer on this board.",
    });
  });
});
