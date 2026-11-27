/**
 * File: apps/desktop/src/drive/background.ts
 * Purpose: Finishing Google Drive uploads after the user exits (desktop 1.7.2, ADR-0106). The page reports
 *          how much Drive work this computer still has (DriveQueueReport); when the user exits (the panel's
 *          close button, closing its window, the tray's Quit, Cmd+Q) with work left, the app closes every
 *          window but keeps running with its tray icon (whose tooltip and menu say what is left), and quits
 *          by itself once the work is done. Mac 1.8.2 / Windows 1.7.6 (ADR-0131): no system notification
 *          any more (a shared screen would show it). "Quit now" in the tray
 *          asks first, then quits (the queue resumes at the next start). Uploads that stop moving for
 *          STALL_MS (offline, Google refusing) also end it: the queue resumes at the next start, so the app
 *          never runs on in the background for nothing. The app is never hidden from the taskbar's tray,
 *          the Dock or the process list (CLAUDE.md).
 *          Pure logic: main.ts gives it the windows, the tray and the quit.
 * Used by: src/main.ts; tests/unit/background.test.ts
 * Depends on: @kite/shared (DriveQueueReport, isDriveQueueReport)
 * Architecture: docs/decisions/ADR-0106-background-upload-on-exit.md; ADR-0072, ADR-0077
 *
 * Logs counts and outcomes only: never an id, a name or a title.
 */
import { isDriveQueueReport, type DriveQueueReport } from '@kite/shared';

/** How long uploads may stand still in the background before the app quits anyway, ms. */
export const STALL_MS = 10 * 60_000;

/** How often the background state is looked at, ms (reports and upload ends also look at once). */
export const CHECK_EVERY_MS = 15_000;

/**
 * After a call ends, how long its page has to report it before "nothing left" is believed, ms. A call that
 * just ended is written, then reported within about a second; an exit in that second must not lose it.
 */
export const REPORT_GRACE_MS = 15_000;

/** What the tray shows. */
export interface BackgroundView {
  /** True while the app runs on after the user exited. */
  background: boolean;
  /** The progress line ("Uploading 1 recording to Drive: 42%"), or null when nothing is left. */
  status: string | null;
}

/** What the controller needs from main.ts (tests pass fakes). */
export interface BackgroundExitDeps {
  /** The clock, Unix ms. */
  now(): number;
  /** How many recording uploads the shell is sending right now. */
  activeUploads(): number;
  /**
   * Closes every window but the page that keeps uploading, which stays open but hidden.
   * @returns False when no page is left that can keep uploading (then the app just quits).
   */
  enterBackground(): boolean;
  /** Quits for real (main.ts lets the quit through). */
  quit(): void;
  /**
   * Asks whether to stop the upload and quit now.
   * @returns True when the user chose "Quit now".
   */
  confirmQuitNow(): Promise<boolean>;
  /**
   * Shows the state in the tray.
   * @param view What to show.
   */
  showView(view: BackgroundView): void;
  /**
   * Starts a repeating timer.
   * @param run What to run.
   * @param ms  How often.
   * @returns A handle for stopTimer.
   */
  startTimer(run: () => void, ms: number): unknown;
  /**
   * Stops a timer.
   * @param handle What startTimer returned.
   */
  stopTimer(handle: unknown): void;
}

/** The controller. */
export interface BackgroundExit {
  /**
   * The page's report of the Drive work left (checked here: the page is not trusted).
   * @param value What arrived over IPC.
   */
  report(value: unknown): void;
  /** A call ended: its page reports it shortly (REPORT_GRACE_MS). */
  callEnded(): void;
  /** A shell upload started or ended. */
  uploadsChanged(): void;
  /** @returns True while there is Drive work left on this computer. */
  hasWork(): boolean;
  /**
   * The user asked to exit.
   * @returns 'quit' to let the app quit; 'background' when it runs on (or asks, when it already does).
   */
  requestExit(): 'quit' | 'background';
  /** "Quit now" in the tray: asks, then quits. */
  quitNow(): Promise<void>;
  /** The user opened the app again: it runs as usual (the work goes on). */
  leave(): void;
  /** @returns True while the app runs on after the user exited. */
  inBackground(): boolean;
  /** @returns What the tray shows now. */
  view(): BackgroundView;
}

/**
 * "1 recording", "2 recordings".
 * @param n    How many.
 * @param word The word for one.
 * @returns The phrase.
 */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The progress line for the tray.
 *
 * @param work What is left (null: nothing reported yet).
 * @returns "Uploading 1 recording to Drive: 42%", "Saving 2 calls to Drive", or null when nothing is left.
 * Called from: the controller's view(); tests
 */
export function workLine(work: DriveQueueReport | null): string | null {
  if (!work) return null;
  if (work.recordings > 0) {
    const percent = work.total > 0 ? `: ${Math.floor((work.sent / work.total) * 100)}%` : '';
    return `Uploading ${plural(work.recordings, 'recording')} to Drive${percent}`;
  }
  if (work.calls > 0) return `Saving ${plural(work.calls, 'call')} to Drive`;
  return null;
}

/**
 * Creates the controller.
 *
 * @param deps See BackgroundExitDeps.
 * @returns The controller.
 * Called from: start() in main.ts; tests
 */
export function createBackgroundExit(deps: BackgroundExitDeps): BackgroundExit {
  let work: DriveQueueReport | null = null;
  let reportedAt = 0;
  let callEndedAt = 0;
  let background = false;
  let lastMoveAt = 0;
  let lastUploads = 0;
  let timer: unknown = null;
  let asking = false;

  const hasWork = () => {
    if (deps.activeUploads() > 0) return true;
    if (work && (work.calls > 0 || work.recordings > 0)) return true;
    // A call that just ended and has not been reported yet counts as work for a moment.
    return callEndedAt > reportedAt && deps.now() - callEndedAt < REPORT_GRACE_MS;
  };
  const view = (): BackgroundView => ({
    background,
    status: workLine(work) ?? (deps.activeUploads() > 0 ? 'Uploading to Drive' : null),
  });
  const stopTimer = () => {
    if (timer !== null) deps.stopTimer(timer);
    timer = null;
  };
  /**
   * Quits once the work is done or has stood still too long; otherwise refreshes the tray.
   */
  const check = () => {
    if (!background) {
      deps.showView(view());
      return;
    }
    if (!hasWork()) {
      console.info('drive: background work done, quitting');
      stopTimer();
      deps.quit();
      return;
    }
    if (deps.now() - lastMoveAt >= STALL_MS) {
      // Offline, or Google refusing: the queue resumes at the next start (nothing is lost).
      console.info('drive: background work stalled, quitting', { recordings: work?.recordings });
      stopTimer();
      deps.quit();
      return;
    }
    deps.showView(view());
  };

  /** "Quit now": asks, then quits (one question at a time). */
  const quitNow = async () => {
    if (asking) return;
    asking = true;
    try {
      if (!(await deps.confirmQuitNow())) return;
    } finally {
      asking = false;
    }
    console.info('drive: quit now chosen', { recordings: work?.recordings ?? 0 });
    stopTimer();
    deps.quit();
  };

  return {
    report(value) {
      if (!isDriveQueueReport(value)) return;
      const moved =
        !work ||
        work.sent !== value.sent ||
        work.recordings !== value.recordings ||
        work.calls !== value.calls;
      if (moved) lastMoveAt = deps.now();
      work = {
        calls: value.calls,
        recordings: value.recordings,
        sent: value.sent,
        total: value.total,
      };
      reportedAt = deps.now();
      check();
    },
    callEnded() {
      callEndedAt = deps.now();
      lastMoveAt = deps.now();
    },
    uploadsChanged() {
      const uploads = deps.activeUploads();
      if (uploads !== lastUploads) lastMoveAt = deps.now();
      lastUploads = uploads;
      check();
    },
    hasWork,
    requestExit() {
      if (background) {
        // A second exit while it runs on (the tray's Quit, Cmd+Q): the same question as "Quit now".
        void quitNow();
        return 'background';
      }
      if (!hasWork()) return 'quit';
      if (!deps.enterBackground()) return 'quit';
      background = true;
      lastMoveAt = deps.now();
      // ADR-0131: no system notification ("Saving your call to Drive."): a shared screen would show it. The
      // tray icon's tooltip and menu say what is left (showView below).
      console.info('drive: running on in the background', {
        recordings: work?.recordings ?? 0,
        calls: work?.calls ?? 0,
      });
      stopTimer();
      timer = deps.startTimer(check, CHECK_EVERY_MS);
      deps.showView(view());
      return 'background';
    },
    quitNow,
    leave() {
      if (!background) return;
      background = false;
      stopTimer();
      deps.showView(view());
    },
    inBackground: () => background,
    view,
  };
}
