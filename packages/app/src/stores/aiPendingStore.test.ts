import { describe, it, expect } from "vitest";

import { moduleForTool } from "./aiPendingStore";

describe("moduleForTool", () => {
  it("classifies a representative tool from each module", () => {
    expect(moduleForTool("create_form")).toBe("forms");
    expect(moduleForTool("submit_form_response")).toBe("forms");
    expect(moduleForTool("create_calendar_event")).toBe("calendar");
    expect(moduleForTool("list_booking_requests")).toBe("calendar");
    expect(moduleForTool("rsvp_event")).toBe("calendar");
    expect(moduleForTool("create_page")).toBe("pages");
    expect(moduleForTool("set_page_tags")).toBe("pages");
    expect(moduleForTool("create_poll")).toBe("polls");
    expect(moduleForTool("clear_my_vote")).toBe("polls");
    expect(moduleForTool("browse_files")).toBe("drive");
    expect(moduleForTool("rename_file")).toBe("drive");
  });

  it("returns null for an unknown tool", () => {
    expect(moduleForTool("does_not_exist")).toBeNull();
  });
});
