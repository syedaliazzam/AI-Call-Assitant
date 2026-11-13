/**
 * File: apps/desktop/src/priority.ts
 * Purpose: Small helpers for the shell's background processes and call state: give a utility process
 *          below-normal priority once it has started (Accurate transcription since 1.5.1; the recording
 *          finaliser since 1.6.3, ADR-0077), so the call's own work always comes first on a busy computer;
 *          and end the shell's "call active" state when the call window closes during a call (1.6.3,
 *          ADR-0077), so Drive uploads are not left paused.
 * Used by: apps/desktop/src/main.ts
 * Depends on: node:os
 * Architecture: ADR-0069 (priority), ADR-0077 (desktop 1.6.3)
 */
import os from 'node:os';

/** A started child process, as far as these helpers need it. */
export interface PriorityChild {
  /** Its process id, once it has started. */
  readonly pid?: number | undefined;
  /**
   * Listens once for its start.
   * @param event    'spawn'.
   * @param listener Called when it has started.
   */
  once(event: 'spawn', listener: () => void): unknown;
}

/**
 * Lowers a child process to below-normal priority once it has started. A failure only leaves the normal
 * priority (it is noted by name, never with details).
 *
 * @param child       The process.
 * @param name        What it is, for the warning ("accurate", "recording finaliser").
 * @param setPriority os.setPriority (tests pass a fake).
 * Called from: main.ts (Accurate's and the recording finaliser's forks); tests
 */
export function runBelowNormal(
  child: PriorityChild,
  name: string,
  setPriority: (pid: number, priority: number) => void = os.setPriority,
): void {
  child.once('spawn', () => {
    try {
      if (child.pid) setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      console.warn('desktop: priority not lowered', { name });
    }
  });
}

/** The Drive part of the shell, as far as the call state needs it. */
export interface CallActiveTarget {
  /**
   * Tells Drive whether a call is live (uploads pause during one).
   * @param active True during a call.
   */
  setCallActive(active: boolean): void;
}

/**
 * 1.6.3 (ADR-0077): the call window closed. If a call was live, Drive is told it ended: before 1.6.3 only
 * the shell's own flag was cleared, so the page's later "call ended" changed nothing and every recording
 * upload answered "paused" until another call started and ended.
 *
 * @param active Whether a call was live.
 * @param drive  The Drive part, or null before it is installed.
 * @returns The new state: false (no call).
 * Called from: main.ts (the main window's 'closed'); tests
 */
export function endCallOnClose(active: boolean, drive: CallActiveTarget | null): false {
  if (active) drive?.setCallActive(false);
  return false;
}
