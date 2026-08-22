import { describe, expect, it, vi } from "vitest";

import { singleFlight } from "./singleFlight";

/** A promise plus the handles to settle it from the test. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("singleFlight", () => {
  it("runs the task immediately when nothing is in flight", async () => {
    const task = vi.fn(async () => {});
    await singleFlight(task)();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("collapses calls arriving mid-flight into exactly one re-run", async () => {
    const first = deferred();
    const task = vi.fn(() => first.promise);
    const run = singleFlight(task);

    const inFlight = run();
    // Three invalidations land while the first fetch is still going. They are
    // one piece of news, not three: a single re-run sees all of their events.
    run();
    run();
    run();
    expect(task).toHaveBeenCalledTimes(1);

    first.resolve();
    await inFlight;
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not re-run when nothing arrived during the flight", async () => {
    const task = vi.fn(async () => {});
    const run = singleFlight(task);
    await run();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("still re-runs after a failed task", async () => {
    // A refetch that throws is the case most in need of a retry, and a rejected
    // promise must not wedge the guard shut for the rest of the session.
    const task = vi.fn(async () => {
      throw new Error("relay said no");
    });
    const run = singleFlight(task);

    await run();
    await run();
    expect(task).toHaveBeenCalledTimes(2);
  });
});
