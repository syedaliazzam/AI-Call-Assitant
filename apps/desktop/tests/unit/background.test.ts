/**
 * Tests for apps/desktop/src/drive/background.ts (desktop 1.7.2, ADR-0106): an exit with Drive work left
 * closes the windows and runs on (ADR-0131: with no system notification, only the tray); the app quits by itself once the page reports
 * nothing left and no upload is sending; "Quit now" asks first; a second exit asks the same; uploads that
 * stand still for STALL_MS end it; a call that just ended counts until its page reports; reopening runs
 * the app as usual; bad reports are ignored; the tray's words.
 */
import { describe, expect, it } from 'vitest';
import {
  CHECK_EVERY_MS,
  REPORT_GRACE_MS,
  STALL_MS,
  createBackgroundExit,
  workLine,
  type BackgroundView,
} from '../../src/drive/background';

/**
 * A controller with fakes, and what they saw.
 * @param options.keep    Whether a page is left to keep uploading.
 * @param options.confirm The answer to "Quit now?".
 * @returns The controller, what it did, and the clock and timer controls.
 */
function rig(options: { keep?: boolean; confirm?: boolean } = {}) {
  let now = 1_000_000;
  let uploads = 0;
  const seen = {
    entered: 0,
    quits: 0,
    views: [] as BackgroundView[],
    timers: [] as { run: () => void; ms: number; stopped: boolean }[],
    asked: 0,
  };
  const control = createBackgroundExit({
    now: () => now,
    activeUploads: () => uploads,
    enterBackground: () => {
      seen.entered += 1;
      return options.keep ?? true;
    },
    quit: () => {
      seen.quits += 1;
    },
    confirmQuitNow: async () => {
      seen.asked += 1;
      return options.confirm ?? true;
    },
    showView: (view) => seen.views.push(view),
    startTimer: (run, ms) => {
      const timer = { run, ms, stopped: false };
      seen.timers.push(timer);
      return timer;
    },
    stopTimer: (handle) => {
      (handle as { stopped: boolean }).stopped = true;
    },
  });
  return {
    control,
    seen,
    advance: (ms: number) => {
      now += ms;
    },
    setUploads: (n: number) => {
      uploads = n;
    },
    /**
     * Runs the live timer once, as setInterval would.
     * @returns Nothing.
     */
    tick: () => seen.timers.filter((t) => !t.stopped).forEach((t) => t.run()),
  };
}

const ONE = { calls: 1, recordings: 1, sent: 0, total: 100 };

describe('workLine', () => {
  it('says what is left, with the share of the recordings already in Drive', () => {
    expect(workLine(null)).toBeNull();
    expect(workLine({ calls: 0, recordings: 0, sent: 0, total: 0 })).toBeNull();
    expect(workLine({ calls: 1, recordings: 1, sent: 42, total: 100 })).toBe(
      'Uploading 1 recording to Drive: 42%',
    );
    expect(workLine({ calls: 1, recordings: 2, sent: 0, total: 0 })).toBe(
      'Uploading 2 recordings to Drive',
    );
    expect(workLine({ calls: 2, recordings: 0, sent: 0, total: 0 })).toBe(
      'Saving 2 calls to Drive',
    );
  });

  it('ADR-0131: the controller has no way to show a system notification', async () => {
    const background = await import('../../src/drive/background');
    expect('backgroundNotice' in background).toBe(false);
  });
});

describe('createBackgroundExit', () => {
  it('quits at once when nothing is left', () => {
    const r = rig();
    r.control.report({ calls: 0, recordings: 0, sent: 0, total: 0 });
    expect(r.control.requestExit()).toBe('quit');
    expect(r.seen.entered).toBe(0);
  });

  it('runs on with work left, says so in the tray only, and quits by itself when it is done', () => {
    const r = rig();
    r.control.report(ONE);
    expect(r.control.requestExit()).toBe('background');
    expect(r.control.inBackground()).toBe(true);
    expect(r.seen.entered).toBe(1);
    expect(r.seen.timers[0]!.ms).toBe(CHECK_EVERY_MS);
    expect(r.seen.views.at(-1)).toEqual({
      background: true,
      status: 'Uploading 1 recording to Drive: 0%',
    });
    // Progress shows in the tray.
    r.control.report({ ...ONE, sent: 50 });
    expect(r.seen.views.at(-1)!.status).toBe('Uploading 1 recording to Drive: 50%');
    expect(r.seen.quits).toBe(0);
    // Done: it quits by itself, once.
    r.control.report({ calls: 0, recordings: 0, sent: 0, total: 0 });
    expect(r.seen.quits).toBe(1);
    expect(r.seen.timers[0]!.stopped).toBe(true);
  });

  it('waits for an upload the shell is still sending, even when the page says nothing is left', () => {
    const r = rig();
    r.setUploads(1);
    expect(r.control.requestExit()).toBe('background');
    r.control.report({ calls: 0, recordings: 0, sent: 0, total: 0 });
    expect(r.seen.quits).toBe(0);
    r.setUploads(0);
    r.control.uploadsChanged();
    expect(r.seen.quits).toBe(1);
  });

  it('quits when no page is left to keep uploading', () => {
    const r = rig({ keep: false });
    r.control.report(ONE);
    expect(r.control.requestExit()).toBe('quit');
    expect(r.control.inBackground()).toBe(false);
  });

  it('counts a call that just ended until its page reports it', () => {
    const r = rig();
    r.control.report({ calls: 0, recordings: 0, sent: 0, total: 0 });
    r.advance(1_000);
    r.control.callEnded();
    r.advance(500);
    expect(r.control.hasWork()).toBe(true);
    // The page's report after the call's end decides.
    r.control.report({ calls: 0, recordings: 0, sent: 0, total: 0 });
    expect(r.control.hasWork()).toBe(false);
    // And without any report, the grace ends.
    r.control.callEnded();
    r.advance(REPORT_GRACE_MS);
    expect(r.control.hasWork()).toBe(false);
  });

  it('quits when the uploads stand still for STALL_MS (the queue resumes at the next start)', () => {
    const r = rig();
    r.control.report(ONE);
    r.control.requestExit();
    r.advance(STALL_MS - 1);
    r.tick();
    expect(r.seen.quits).toBe(0);
    // Progress restarts the wait.
    r.control.report({ ...ONE, sent: 10 });
    r.advance(STALL_MS - 1);
    r.tick();
    expect(r.seen.quits).toBe(0);
    r.advance(1);
    r.tick();
    expect(r.seen.quits).toBe(1);
  });

  it('asks before "Quit now", and keeps uploading when the person says so', async () => {
    const keep = rig({ confirm: false });
    keep.control.report(ONE);
    keep.control.requestExit();
    await keep.control.quitNow();
    expect(keep.seen.asked).toBe(1);
    expect(keep.seen.quits).toBe(0);
    expect(keep.control.inBackground()).toBe(true);

    const stop = rig({ confirm: true });
    stop.control.report(ONE);
    stop.control.requestExit();
    await stop.control.quitNow();
    expect(stop.seen.quits).toBe(1);
  });

  it('asks the same question on a second exit while it runs on', async () => {
    const r = rig({ confirm: true });
    r.control.report(ONE);
    r.control.requestExit();
    expect(r.control.requestExit()).toBe('background');
    await Promise.resolve();
    await Promise.resolve();
    expect(r.seen.asked).toBe(1);
    expect(r.seen.quits).toBe(1);
    expect(r.seen.entered).toBe(1);
  });

  it('runs as usual again when the person opens the app (the work goes on, no quit)', () => {
    const r = rig();
    r.control.report(ONE);
    r.control.requestExit();
    r.control.leave();
    expect(r.control.inBackground()).toBe(false);
    expect(r.seen.timers[0]!.stopped).toBe(true);
    expect(r.seen.views.at(-1)!.background).toBe(false);
    r.control.report({ calls: 0, recordings: 0, sent: 0, total: 0 });
    expect(r.seen.quits).toBe(0);
    // A later exit with work left runs on again.
    r.control.report(ONE);
    expect(r.control.requestExit()).toBe('background');
    expect(r.seen.entered).toBe(2);
  });

  it('ignores a report that is not well formed', () => {
    const r = rig();
    for (const bad of [
      null,
      'x',
      { calls: -1, recordings: 0, sent: 0, total: 0 },
      { calls: 1, recordings: 1.5, sent: 0, total: 0 },
      { calls: 1, recordings: 1, sent: 200, total: 100 },
      { calls: 1, recordings: 1, sent: 0 },
    ]) {
      r.control.report(bad);
    }
    expect(r.control.hasWork()).toBe(false);
    expect(r.control.requestExit()).toBe('quit');
  });
});
