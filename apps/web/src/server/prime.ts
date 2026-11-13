/**
 * File: apps/web/src/server/prime.ts
 * Purpose: Starts a reply's text source at once, before the response is returned (Batch C, P1-2). The
 *          answer route reads the daily-limit count from the database at the same time as Claude's
 *          request is opened, instead of one after the other: the source's first read is started here,
 *          and the stream later replays it. When the count says no, the caller stops the request and
 *          discards the source; nothing has been sent to the browser by then.
 * Used by: app/api/answer/route.ts
 * Depends on: nothing
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D (request path), I (P1-2); ADR-0078
 */
import 'server-only';

/** A source whose first read has started. */
export interface PrimedSource<T, R> {
  /** The same items and result as the original source, starting with the read already running. */
  source: AsyncGenerator<T, R, undefined>;
  /** Ends the original source without reading it (the request was refused). */
  discard: () => void;
}

/**
 * Starts reading a source now.
 *
 * @param original The source (an async generator that starts its work on the first read).
 * @returns The primed source and a way to discard it.
 * Called from: app/api/answer/route.ts (counted modes); tests
 */
export function prime<T, R>(original: AsyncGenerator<T, R, undefined>): PrimedSource<T, R> {
  const first = original.next();
  // A source stopped before anyone reads it (over the daily limit) rejects here: that is expected, and it
  // must not become an unhandled rejection.
  first.catch(() => undefined);
  let finished = false;

  /**
   * Replays the first read, then reads on.
   *
   * @returns The items, then the original's result.
   */
  async function* replay(): AsyncGenerator<T, R, undefined> {
    try {
      let result = await first;
      while (!result.done) {
        yield result.value;
        result = await original.next();
      }
      finished = true;
      return result.value;
    } finally {
      // The reader stopped early (the browser went away): the original's own clean-up runs too.
      if (!finished) await original.return(undefined as R).catch(() => undefined);
    }
  }

  return {
    source: replay(),
    discard: () => {
      finished = true;
      void original.return(undefined as R).catch(() => undefined);
    },
  };
}
