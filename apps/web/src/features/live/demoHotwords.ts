/**
 * File: apps/web/src/features/live/demoHotwords.ts
 * Purpose: The fixed call details and hotwords used by the /live/demo session, until real
 *          sessions exist. Hotwords make the speech model prefer these names (one phrase per
 *          line, optional " :score"; see core/stt/hotwords.ts).
 * Used by: src/features/live/LivePage.tsx
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Connect: call information), §12 Day 2
 *
 * Day 3: both come from the session in IndexedDB. The hotword list is then built from the
 * session's company, role and documents (participant and company names, product terms).
 */

/** Call details shown at the top of the Connect view. */
export interface DemoCall {
  /** Session title. */
  title: string;
  /** Company the call is with. */
  company: string;
  /** What the call is about. */
  role: string;
}

/** The demo call. */
export const DEMO_CALL: DemoCall = {
  title: 'Demo call',
  company: 'Paramount Intelligence',
  role: 'Audio and transcript test (Day 2)',
};

/** Hotwords for the demo call. */
export const DEMO_HOTWORDS = ['Paramount Intelligence :2', 'Kite :2'].join('\n');
