import { describe, it, expect } from "vitest";

import { normalizePubkey, normalizePubkeyList, aiFieldsToFormFields } from "../src/tools/shared";

const HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

describe("shared transforms", () => {
  it("normalizes hex and npub to hex, rejects junk", () => {
    expect(normalizePubkey(HEX)).toBe(HEX);
    expect(normalizePubkey(NPUB)).toBe(HEX);
    expect(normalizePubkey("garbage")).toBeNull();
  });

  it("filters a mixed pubkey list to valid hex", () => {
    expect(normalizePubkeyList([HEX, "garbage", NPUB])).toEqual([HEX, HEX]);
  });

  it("maps AI field objects to FormField with generated ids", () => {
    const fields = aiFieldsToFormFields([
      { label: "Name", type: "shortText", required: true },
      { label: "Color", type: "radioButton", options: ["Red", "Blue"] },
    ]);
    expect(fields[0]).toMatchObject({ id: "f0", label: "Name", required: true });
    expect(fields[1].options).toEqual([
      { id: "o0", label: "Red" },
      { id: "o1", label: "Blue" },
    ]);
  });
});
