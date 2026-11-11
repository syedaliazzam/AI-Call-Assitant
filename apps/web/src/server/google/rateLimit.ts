/**
 * File: apps/web/src/server/google/rateLimit.ts
 * Purpose: A small per-account rate limit for the Google routes (ADR-0072): at most N requests in a
 *          sliding minute, counted in this server instance's memory. Vercel may run several instances,
 *          so the real ceiling is a few times N; that still stops a stuck loop in a page from refreshing
 *          tokens at Google hundreds of times a minute, which is what it is for.
 * Used by: src/server/google/api.ts
 * Depends on: nothing
 * Architecture: ADR-0072
 */
import 'server-only';

/** A limiter: allow(key) says whether one more request fits. */
export interface RateLimiter {
  /**
   * Counts a request if it fits.
   * @param key The account (and route).
   * @returns True when allowed.
   */
  allow(key: string): boolean;
}

/** The most keys remembered before old ones are dropped (bounded memory). */
const MAX_KEYS = 5_000;

/**
 * Creates a limiter.
 *
 * @param limit    Requests allowed per window.
 * @param windowMs The window, ms.
 * @param now      The clock (tests pass their own).
 * @returns The limiter.
 * Called from: api.ts; tests
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((time) => time > at - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(at);
      // Re-inserted, so the Map's first key is the least recently used.
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
      return true;
    },
  };
}
