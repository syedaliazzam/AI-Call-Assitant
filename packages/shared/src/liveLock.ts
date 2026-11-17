/**
 * File: packages/shared/src/liveLock.ts
 * Purpose: The live-call lock API shared by the web client and the server (ADR-0098): a session's call runs
 *          on one device at a time. A call's start takes the session's lock, a heartbeat keeps it, End
 *          releases it; a lock with no heartbeat for LIVE_LOCK_STALE_MS has expired. Another device of the
 *          same account sees the session as live elsewhere and can take the call over.
 * Used by: apps/web/src/server/liveLock.ts (route /api/live-lock), apps/web/src/core/live/liveLock.ts
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.2, §8.1; ADR-0098
 */

/** How often a running call sends its heartbeat, in ms. */
export const LIVE_LOCK_HEARTBEAT_MS = 15_000;

/** A lock with no heartbeat for this long has expired (a crash, no network, a window closed without End), ms. */
export const LIVE_LOCK_STALE_MS = 90_000;

/** The longest id the route accepts (session, call and device ids are UUIDs made by the device). */
export const LIVE_LOCK_ID_MAX = 100;

/** The error code of a start refused because another device runs the session (HTTP 409). */
export const LIVE_ELSEWHERE_CODE = 'live_elsewhere';

/** A request to POST /api/live-lock. */
export type LiveLockRequest =
  | {
      /** A call starts (or reconnects): take the session's lock for it. */
      action: 'start';
      /** The session. */
      sessionId: string;
      /** The call (its record id). */
      callId: string;
      /** The device running it (core/live/deviceId.ts). */
      deviceId: string;
      /** True after the person confirmed "Take over": the lock is taken even while another call holds it. */
      takeOver: boolean;
    }
  | {
      /** The running call's heartbeat. */
      action: 'beat';
      /** The session. */
      sessionId: string;
      /** The call. */
      callId: string;
      /** The device running it. */
      deviceId: string;
    }
  | {
      /** The call ended: release the lock (only if this call still holds it). */
      action: 'end';
      /** The session. */
      sessionId: string;
      /** The call. */
      callId: string;
    };

/** The reply to a start or heartbeat (200). A refused start is 409 with code LIVE_ELSEWHERE_CODE instead. */
export interface LiveLockReply {
  /** 'held': this call holds the lock; 'moved': another call took the session over, so this call ends. */
  state: 'held' | 'moved' | 'released';
}

/** One session that is live now (GET /api/live-lock). */
export interface LiveSessionEntry {
  /** The session. */
  sessionId: string;
  /** True when the call runs on the device that asked (its own call: shown as usual). */
  here: boolean;
}

/** The reply of GET /api/live-lock: this account's sessions with a lock held now. */
export interface LiveSessionsReply {
  /** The live sessions. */
  live: LiveSessionEntry[];
}

/** The header that names the asking device on GET /api/live-lock (a header, so it is never in a URL log). */
export const DEVICE_HEADER = 'x-kite-device';
