/**
 * Wrap an async task so overlapping calls collapse into one re-run.
 *
 * A store's refetch is idempotent — it reads whatever the relay currently holds
 * — so a burst of invalidations arriving while one is in flight is a single
 * piece of news, not N. Without this, opening a board that receives ten card
 * events would stack ten concurrent `fetchCards`, each decrypting the same
 * board, and let them resolve out of order into the store.
 *
 * Exactly one re-run is queued no matter how many calls land mid-flight, and it
 * starts only once the previous one has settled.
 */
export function singleFlight(task: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const run = async (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }

    // A rejected refetch is exactly the case that wants retrying, so the guard
    // has to reopen on failure as well as success.
    const settle = task().finally(() => {
      inFlight = null;
      if (queued) {
        queued = false;
        void run();
      }
    });
    inFlight = settle.then(
      () => {},
      () => {},
    );
    return inFlight;
  };

  return run;
}
