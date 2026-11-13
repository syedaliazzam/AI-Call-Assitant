/**
 * File: apps/web/src/core/answer/keepAlive.ts
 * Purpose: The connection keep-alive of a live call (Batch C, P1-2; investigation D2): every
 *          KEEP_ALIVE_MS a tiny authenticated HEAD /api/answer/ping, so the browser keeps its HTTP/2
 *          connection to Vercel's edge open and the next answer skips a new TLS handshake (about 180 ms
 *          measured). It is not Claude: no request is counted and nothing is spent. Unlike the idle
 *          re-warm (keepWarm.ts, which keeps Claude's prompt cache), it runs whether or not answers were
 *          sent. Stopped on End and while listening is paused.
 * Used by: src/features/live/useLiveAnswers.ts
 * Depends on: the browser's fetch (injectable)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md D2; ADR-0078
 */

/** How often the ping is sent during a call, ms (D2: under the idle timeouts of the edge and browser). */
export const KEEP_ALIVE_MS = 25_000;

/** The ping's path. */
export const PING_PATH = '/api/answer/ping';

/** Options for startKeepAlive(). */
export interface KeepAliveOptions {
  /** Sends one ping (default: HEAD PING_PATH with the session cookie, never cached). */
  ping?: () => Promise<{ ok: boolean; status: number }>;
  /** Repeating timer (tests pass a fake one). Default setInterval/clearInterval. */
  every?: (callback: () => void, ms: number) => () => void;
  /**
   * A ping did not get 204 (status 0: no connection). For the timing trace: codes only.
   *
   * @param status The HTTP status.
   */
  onFailed?: (status: number) => void;
}

/**
 * The default ping.
 *
 * @returns Whether it succeeded, and its status (0 when the network failed).
 */
async function defaultPing(): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(PING_PATH, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Starts pinging. The first ping goes one interval from now (the call's warm-up has just used the
 * connection).
 *
 * @param options The ping, the timer, and the failure callback.
 * @returns Stops pinging.
 * Called from: useLiveAnswers.ts (while a call runs and is not paused); tests
 */
export function startKeepAlive(options: KeepAliveOptions = {}): () => void {
  const ping = options.ping ?? defaultPing;
  const every =
    options.every ??
    ((callback: () => void, ms: number) => {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    });
  let stopped = false;
  /** True while a ping is in flight, so a slow network never stacks them. */
  let pinging = false;
  const cancel = every(() => {
    if (stopped || pinging) return;
    pinging = true;
    void ping()
      .then((result) => {
        if (!result.ok && !stopped) options.onFailed?.(result.status);
      })
      .finally(() => {
        pinging = false;
      });
  }, KEEP_ALIVE_MS);
  return () => {
    stopped = true;
    cancel();
  };
}
