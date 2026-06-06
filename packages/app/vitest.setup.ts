import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// `globals` is off, so React Testing Library's auto-cleanup never registers and
// renders accumulate across tests in a file. Unmount after each test so queries
// only ever see the current render.
afterEach(() => {
  cleanup();
});
