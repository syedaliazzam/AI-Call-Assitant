/**
 * File: apps/desktop/tests/manual/recording.spec.ts
 * Purpose: Meeting recording on the real shell and the real call page (desktop 1.5.0, ADR-0068):
 *          1. a call records in two parts: the first started with the Rec pill (consent popover) and
 *             stopped with Ctrl+Alt+R (the shortcut's own path: the shell's hotkey message), the second
 *             started with Ctrl+Alt+R and stopped with the pill; Ctrl+Alt+R is registered during the call;
 *             Private comes on by itself; End leaves two finalised parts (with their stereo files) in the
 *             Recordings folder and the index; the second part, decoded in the Kite page from the
 *             player's kite-recording:// address, shows the overlay's painted area 0% while Private was on
 *             and most of it once Private was off (the Private pixel check, in the video itself);
 *          2. a crash during a recording: the app is killed, started again, recovers the file (it plays,
 *             with its length).
 *          The real screen is never recorded: a synthetic "meeting" in its own Electron process
 *          (tests/fixtures/cover) covers the main display, and nothing records unless its four corner
 *          markers are seen first; every decoded frame is checked for them too. The other side's sound is
 *          this computer's real sound (as in any call): the files stay in a temporary folder, are only
 *          decoded for pixels, and are deleted at the end. Numbers only are printed.
 *          Needs the overlay rig running (`pnpm --filter web exec tsx tests/visual/overlay-rig.ts`, port
 *          3123) and this checkout's shell built (`pnpm --filter @kite/desktop build`), or a packaged program
 *          named by KITE_INSTALLED_EXE (release/win-unpacked/Paramount AI.exe). Temporary profiles.
 *          Usage: pnpm --filter @kite/desktop exec playwright test -c playwright.manual.config.ts recording
 * Used by: the developer before a release (docs/testing/benchmark-results.md, 1.5.0)
 * Depends on: @playwright/test (_electron), tests/fixtures/cover, the rig's /call page
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HotkeyStatus, ShareProtectionState } from '@kite/shared';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/** apps/desktop. */
const APP_DIR = path.join(__dirname, '..', '..');

/** The overlay rig. */
const RIG = `http://localhost:${process.env.RIG_PORT ?? 3123}`;

/** An official test recording, played as the microphone (apps/web/tests/fixtures/audio/SOURCES.md). */
const MIC = path.join(APP_DIR, '..', 'web', 'tests', 'fixtures', 'audio', '0.wav');

/**
 * With REC_SHOTS=<folder>, page screenshots of the overlay (its own page only, never the screen) are
 * saved there for a visual check of the Rec pill and its popover.
 */
const SHOTS = process.env.REC_SHOTS;

/**
 * Saves a page screenshot of the overlay when REC_SHOTS is set.
 * @param page The overlay page.
 * @param name The file's name.
 */
async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** The part of the shell's bridge this test calls from a page. */
interface TestBridge {
  /** Opens a Kite page in the main window. */
  openPagesWindow: (page: string) => Promise<void>;
  /** Whether each global shortcut is registered. */
  checkHotkeys: () => Promise<HotkeyStatus[]>;
  /** Private's state. */
  getShareProtection: () => Promise<ShareProtectionState>;
  /** Turns Private on or off. */
  setShareProtection: (on: boolean) => Promise<ShareProtectionState>;
}

/** A Kite page's window, as this test sees it. */
interface TestWindow {
  /** The shell's bridge. */
  kiteDesktop: TestBridge;
}

/** The Electron program (the same one Playwright launches). */
const ELECTRON = createRequire(__filename)('electron') as string;

/** The environment without the editor's ELECTRON_RUN_AS_NODE (it would start Electron as Node). */
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...BASE_ENV } = process.env;

/** Where this run's recordings go, and the folders to remove at the end. */
const RECORDINGS = mkdtempSync(path.join(tmpdir(), 'kite-rec-files-'));
const PROFILE = mkdtempSync(path.join(tmpdir(), 'kite-rec-profile-'));
const COVER_PROFILE = mkdtempSync(path.join(tmpdir(), 'kite-rec-cover-'));

let cover: ChildProcess | null = null;

test.describe.configure({ mode: 'serial', timeout: 600_000 });

test.beforeAll(async () => {
  cover = spawn(
    ELECTRON,
    [
      path.join(APP_DIR, 'tests', 'fixtures', 'cover', 'main.mjs'),
      `--user-data-dir=${COVER_PROFILE}`,
    ],
    {
      env: BASE_ENV,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the cover did not start')), 30_000);
    cover!.stdout!.on('data', (data: Buffer) => {
      if (data.toString().includes('cover-ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

test.afterAll(() => {
  cover?.kill();
  for (const dir of [RECORDINGS, PROFILE, COVER_PROFILE]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Starts the shell on the rig with this run's profile and Recordings folder.
 * @returns The app.
 */
async function launch(): Promise<ElectronApplication> {
  // KITE_INSTALLED_EXE: a packaged program (release/win-unpacked) instead of this checkout's build, so
  // the finalising worker is checked from inside the app archive too.
  const installed = process.env.KITE_INSTALLED_EXE;
  return electron.launch({
    ...(installed ? { executablePath: installed } : {}),
    args: [
      ...(installed ? [] : [APP_DIR]),
      `--user-data-dir=${PROFILE}`,
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${MIC}`,
    ],
    env: {
      ...BASE_ENV,
      KITE_URL: `${RIG}/`,
      KITE_NO_UPDATE_CHECK: '1',
      KITE_RECORDINGS_DIR: RECORDINGS,
    },
  });
}

/**
 * Whether the synthetic cover is what a screen capture sees: its four corner markers, read from a small
 * capture in the shell (in memory only, never kept).
 * @param app The shell.
 * @returns True when all four corners are the cover's.
 */
async function coverSeen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(async ({ desktopCapturer, screen }) => {
    const display = screen.getPrimaryDisplay();
    const width = 384;
    const height = Math.round((width * display.bounds.height) / display.bounds.width);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) return false;
    const size = source.thumbnail.getSize();
    const bitmap = source.thumbnail.toBitmap();
    const pixel = (x: number, y: number) => {
      const i = (y * size.width + x) * 4;
      return [bitmap[i + 2]!, bitmap[i + 1]!, bitmap[i]!];
    };
    const near = (c: number[], t: number[]) => c.every((v, i) => Math.abs(v - t[i]!) < 60);
    return (
      near(pixel(3, 3), [255, 0, 0]) &&
      near(pixel(size.width - 4, 3), [0, 200, 0]) &&
      near(pixel(3, size.height - 4), [0, 0, 255]) &&
      near(pixel(size.width - 4, size.height - 4), [255, 220, 0])
    );
  });
}

/**
 * Opens the rig's call page in the main window and connects the call.
 * @param app The shell.
 * @returns The call page and the overlay page.
 */
async function connect(app: ElectronApplication): Promise<{ call: Page; overlay: Page }> {
  const panel = await app.firstWindow();
  await panel.waitForLoadState();
  const opened = app.waitForEvent('window');
  await panel.evaluate(() => (window as unknown as TestWindow).kiteDesktop.openPagesWindow('/'));
  const call = await opened;
  await call.waitForLoadState();
  await call.goto(`${RIG}/call?overlay=on&save=on`);
  // Nothing is recorded unless the cover is what a capture sees.
  expect(await coverSeen(app), 'the synthetic cover must hide the real screen').toBe(true);
  await call.getByRole('button', { name: 'Connect' }).click({ timeout: 300_000 });
  // The overlay's window opens before it navigates, so it is found by its address once there.
  let overlay: Page | undefined;
  await expect
    .poll(
      () => {
        overlay = app.windows().find((page) => page.url().includes('/compact/'));
        return overlay !== undefined;
      },
      { timeout: 300_000 },
    )
    .toBe(true);
  await overlay!.waitForLoadState();
  await expect(overlay!.getByRole('button', { name: 'Start recording' })).toBeVisible({
    timeout: 120_000,
  });
  return { call, overlay: overlay! };
}

/**
 * Sends Ctrl+Alt+R as the shell does when the global shortcut is pressed in another app.
 * @param app The shell.
 */
async function pressRecordShortcut(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/call'),
    );
    main?.webContents.send('kite:hotkey', 'record');
  });
}

/**
 * The recordings index the shell keeps in the profile.
 * @returns Its entries ([] before it exists).
 */
function index(): {
  id: string;
  status: string;
  durationMs: number;
  part: number;
  hasStereo: boolean;
}[] {
  const file = path.join(PROFILE, 'recordings.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { recordings: never[] }).recordings;
}

/**
 * Decodes frames of a recording in a Kite page, from the player's address, and counts painted pixels.
 * @param page  A Kite page.
 * @param id    The recording.
 * @param times Seconds into the video to look at.
 * @param rect  The area to count in, in DIPs of the main display (null: none).
 * @returns The video's length and, per time, the area's magenta share and whether the cover's corners show.
 */
async function decode(
  page: Page,
  id: string,
  times: number[],
  rect: { x: number; y: number; width: number; height: number } | null,
): Promise<{ duration: number; frames: { magenta: number; cover: boolean }[] }> {
  return page.evaluate(
    async ({ id, times, rect }) => {
      const video = document.createElement('video');
      video.muted = true;
      video.crossOrigin = 'anonymous';
      video.src = `kite-recording://file/${id}`;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('the recording did not load'));
      });
      const frames: { magenta: number; cover: boolean }[] = [];
      for (const time of times) {
        video.currentTime = time;
        await new Promise((resolve) => (video.onseeked = resolve));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const g = canvas.getContext('2d')!;
        g.drawImage(video, 0, 0);
        const at = (x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data);
        const near = (c: number[], t: number[]) => t.every((v, i) => Math.abs(c[i]! - v) < 70);
        const w = canvas.width;
        const h = canvas.height;
        const coverShows =
          near(at(4, 4), [255, 0, 0]) &&
          near(at(w - 5, 4), [0, 200, 0]) &&
          near(at(4, h - 5), [0, 0, 255]) &&
          near(at(w - 5, h - 5), [255, 220, 0]);
        let magenta = 0;
        if (rect) {
          const scale = w / screen.width;
          const x0 = Math.round((rect.x + rect.width * 0.2) * scale);
          const y0 = Math.round((rect.y + rect.height * 0.4) * scale);
          const box = g.getImageData(
            x0,
            y0,
            Math.round(rect.width * 0.6 * scale),
            Math.round(rect.height * 0.4 * scale),
          ).data;
          let hits = 0;
          for (let i = 0; i < box.length; i += 4) {
            if (box[i]! > 200 && box[i + 1]! < 70 && box[i + 2]! > 200) hits += 1;
          }
          magenta = hits / (box.length / 4);
        }
        frames.push({ magenta, cover: coverShows });
      }
      return { duration: video.duration, frames };
    },
    { id, times, rect },
  );
}

test('records a call in two parts with the Rec pill and Ctrl+Alt+R; Private keeps the overlay out of the video', async () => {
  const app = await launch();
  try {
    const { call, overlay } = await connect(app);
    // Ctrl+Alt+R is held during the call (Settings reports it otherwise).
    const statuses = await call.evaluate(() =>
      (window as unknown as TestWindow).kiteDesktop.checkHotkeys(),
    );
    expect(statuses.find((s) => s.action === 'record')?.registered).toBe(true);

    // Part 1: the Rec pill and its consent question.
    await shot(overlay, '1-off');
    await overlay.getByRole('button', { name: 'Start recording' }).click();
    const startDialog = overlay.getByRole('dialog', { name: 'Start recording' });
    await expect(startDialog).toContainText('Everyone has agreed to be recorded?');
    await shot(overlay, '2-start-question');
    await startDialog.getByRole('button', { name: 'Start recording' }).click();
    await expect(overlay.getByRole('button', { name: /^Recording, / })).toBeVisible({
      timeout: 30_000,
    });
    await overlay.waitForTimeout(1_500);
    await shot(overlay, '3-recording');
    // Private came on by itself.
    const privateOn = await call.evaluate(() =>
      (window as unknown as TestWindow).kiteDesktop.getShareProtection(),
    );
    expect(privateOn.on).toBe(true);
    await overlay.waitForTimeout(10_000);
    // Stopped with Ctrl+Alt+R: the same question, then Stop.
    await pressRecordShortcut(app);
    const stopDialog = overlay.getByRole('dialog', { name: 'Stop recording?' });
    await stopDialog.getByRole('button', { name: 'Stop recording' }).click();
    await expect(overlay.getByRole('button', { name: 'Start recording' })).toBeEnabled({
      timeout: 60_000,
    });

    // Part 2: started with Ctrl+Alt+R.
    await pressRecordShortcut(app);
    await overlay
      .getByRole('dialog', { name: 'Start recording' })
      .getByRole('button', { name: 'Start recording' })
      .click();
    await expect(overlay.getByRole('button', { name: /^Recording, / })).toBeVisible({
      timeout: 30_000,
    });
    // The overlay's lower area painted magenta, above the cover, at a known place.
    const rect = { x: 160, y: 160, width: 900, height: 420 };
    await overlay.evaluate(() => {
      const paint = document.createElement('div');
      paint.id = 'paint';
      paint.style.cssText =
        'position:fixed;left:0;right:0;top:80px;bottom:0;background:#ff00ff;z-index:2147483647;pointer-events:none';
      document.body.append(paint);
    });
    await app.evaluate(({ BrowserWindow }, bounds) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/compact/'),
      );
      win?.setBounds(bounds);
      win?.setAlwaysOnTop(true, 'screen-saver', 1);
      win?.moveTop();
    }, rect);
    const partStart = Date.now();
    await overlay.waitForTimeout(4_000);
    await call.evaluate(() =>
      (window as unknown as TestWindow).kiteDesktop.setShareProtection(false),
    );
    const privateOffAt = (Date.now() - partStart) / 1000;
    await overlay.waitForTimeout(4_000);
    await overlay.evaluate(() => document.getElementById('paint')?.remove());
    await overlay.getByRole('button', { name: /^Recording, / }).click();
    await overlay
      .getByRole('dialog', { name: 'Stop recording?' })
      .getByRole('button', { name: 'Stop recording' })
      .click();
    await expect(overlay.getByRole('button', { name: 'Start recording' })).toBeEnabled({
      timeout: 60_000,
    });
    await overlay.getByRole('button', { name: 'Exit: end call' }).click();

    // Two finalised parts, each with its stereo file.
    await expect
      .poll(() => index().filter((e) => e.status === 'complete').length, { timeout: 60_000 })
      .toBe(2);
    const parts = index().sort((a, b) => a.part - b.part);
    expect(parts.map((p) => p.part)).toEqual([1, 2]);
    expect(parts.every((p) => p.durationMs > 2_000 && p.hasStereo)).toBe(true);
    const files = readdirSync(RECORDINGS);
    expect(files.filter((f) => f.endsWith('.mkv') || f.endsWith('.webm'))).toHaveLength(4);
    expect(files.filter((f) => f.endsWith('.stereo.webm'))).toHaveLength(2);

    // The Private pixel check, in the recording itself.
    const result = await decode(
      call,
      parts[1]!.id,
      [Math.max(1, privateOffAt - 1.5), privateOffAt + 2],
      rect,
    );
    console.log(
      '[recording] part 2',
      JSON.stringify({
        seconds: Math.round(result.duration * 10) / 10,
        privateOn: Math.round(result.frames[0]!.magenta * 1000) / 1000,
        privateOff: Math.round(result.frames[1]!.magenta * 1000) / 1000,
      }),
    );
    expect(Number.isFinite(result.duration)).toBe(true);
    expect(result.frames.every((f) => f.cover)).toBe(true);
    expect(result.frames[0]!.magenta).toBeLessThan(0.01);
    expect(result.frames[1]!.magenta).toBeGreaterThan(0.5);

    // Meetings (the desktop app): one meeting of two parts, saved on this computer, renamable; Play
    // opens the player window.
    await call.goto(`${RIG}/meetings`);
    const meeting = call.getByRole('list', { name: 'Recorded meetings' }).getByRole('listitem');
    await expect(meeting).toHaveCount(1);
    await expect(meeting).toContainText('2 parts');
    await expect(meeting).toContainText('Saved on');
    await call.getByRole('button', { name: 'Rename' }).click();
    await call.getByLabel('This computer’s name').fill('Rig laptop');
    await call.getByRole('button', { name: 'Save' }).click();
    await expect(call.getByText('Rig laptop')).toBeVisible();
    await meeting.getByRole('button', { name: 'Play' }).click();
    let player: Page | undefined;
    await expect
      .poll(
        () => {
          player = app.windows().find((page) => page.url().includes('/player/'));
          return player !== undefined;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await player!.waitForLoadState();
    // The video plays from this computer, with its length; the parts and the transcript are beside it.
    await expect
      .poll(
        () =>
          player!.evaluate(() => {
            const video = document.querySelector('video');
            return video && Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(5);
    await expect(
      player!.getByRole('navigation', { name: 'Parts' }).getByRole('button'),
    ).toHaveCount(2);
    await player!.getByRole('button', { name: 'Part 2' }).click();
    await expect(player!.getByRole('button', { name: 'Part 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(player!.getByRole('complementary', { name: 'Transcript' })).toBeVisible();
    for (const name of ['Save as…', 'Open folder', 'Delete']) {
      await expect(player!.getByRole('button', { name })).toBeVisible();
    }
  } finally {
    await app.close();
  }
});

test('a crash during a recording: the next start recovers the file, and it plays', async () => {
  let app = await launch();
  const { overlay } = await connect(app);
  await overlay.getByRole('button', { name: 'Start recording' }).click();
  await overlay
    .getByRole('dialog', { name: 'Start recording' })
    .getByRole('button', { name: 'Start recording' })
    .click();
  await expect(overlay.getByRole('button', { name: /^Recording, / })).toBeVisible({
    timeout: 30_000,
  });
  await overlay.waitForTimeout(6_000);
  const before = new Set(index().map((e) => e.id));
  const crashed = index().find((e) => e.status === 'recording');
  expect(crashed).toBeTruthy();
  // Killed with all its processes, as a crash or a power cut would: nothing is closed or finalised.
  const pid = app.process().pid!;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  await expect
    .poll(
      () =>
        spawnSync('tasklist', ['/FI', `PID eq ${pid}`], { encoding: 'utf8' }).stdout.includes(
          String(pid),
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe(false);
  // Its child processes let go of the profile (the single-instance lock) a moment later.
  await new Promise((resolve) => setTimeout(resolve, 4_000));

  app = await launch();
  try {
    await expect
      .poll(() => index().find((e) => e.id === crashed!.id)?.status, { timeout: 60_000 })
      .toBe('recovered');
    expect(before.has(crashed!.id)).toBe(true);
    const panel = await app.firstWindow();
    await panel.waitForLoadState();
    expect(await coverSeen(app)).toBe(true);
    const result = await decode(panel, crashed!.id, [1], null);
    console.log(
      '[recording] recovered',
      JSON.stringify({ seconds: Math.round(result.duration * 10) / 10 }),
    );
    expect(result.duration).toBeGreaterThan(3);
    expect(result.frames[0]!.cover).toBe(true);
  } finally {
    await app.close();
  }
});
