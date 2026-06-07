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
    expect(fields[1].type).toBe("radioButton");
    expect(fields[1].options).toEqual([
      { id: "o0", label: "Red" },
      { id: "o1", label: "Blue" },
    ]);
  });

  it("supports the full field set: object options, grids, validation, file config", () => {
    const [grid, file] = aiFieldsToFormFields([
      {
        label: "Rate",
        type: "multiChoiceGrid",
        gridRows: ["Speed", "Price"],
        gridCols: ["Bad", "Good"],
        options: [{ id: "x", label: "Custom" }],
      },
      {
        label: "Upload",
        type: "fileUpload",
        validation: { required: true, max: 5 },
        fileConfig: { maxBytes: 1024, mimeTypes: ["image/"] },
      },
    ]);
    expect(grid.type).toBe("multiChoiceGrid");
    expect(grid.gridRows).toEqual(["Speed", "Price"]);
    expect(grid.options).toEqual([{ id: "x", label: "Custom" }]);
    expect(file.type).toBe("fileUpload");
    expect(file.validation).toEqual({ required: true, max: 5 });
    expect(file.fileConfig).toEqual({ maxBytes: 1024, mimeTypes: ["image/"] });
  });

  it("coerces unknown field types to shortText", () => {
    expect(aiFieldsToFormFields([{ label: "x", type: "bogus" }])[0].type).toBe("shortText");
  });
});
