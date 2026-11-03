/**
 * File: apps/desktop/tests/visual/mic-check.ts
 * Purpose: v1.0.3 item 4: tries the voice path with the REAL microphone in the REAL desktop shell
 *          (dev build): opens the rig's /mic page (apps/web/tests/visual/rig-mic.tsx, the Ask Kite
 *          voice path), presses Talk, waits for "listening", then has Windows speak a question
 *          through the speakers into the microphone, and reports the state, the words heard, what
 *          was sent and any error, with a screen capture of the window.
 *          Usage: start the rig, then `pnpm --filter desktop build` and
 *                 `pnpm --filter web exec tsx ../desktop/tests/visual/mic-check.ts <out dir>`
 * Used by: the developer before a release (needs a microphone, speakers and a screen)
 * Depends on: @playwright/test (_electron), PowerShell (System.Speech, capture.ps1)
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

/** apps/desktop. */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the capture and the report go. */
const OUT = path.resolve(process.argv[2] ?? path.join(APP_DIR, 'test-results', 'mic-check'));

/** What Windows says into the microphone. */
const SPOKEN = 'What production grade applications have you built?';

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the page reports (window.__mic). */
interface MicReport {
  /** The microphone's state. */
  state: string;
  /** The error, if any. */
  error: string | null;
  /** The words heard so far. */
  preview: string;
  /** What was sent after the pause. */
  sent: string[];
}

/** Runs the check. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [
      APP_DIR,
      '--kite-url=http://localhost:3123/mic',
      `--user-data-dir=${path.join(OUT, 'profile')}`,
    ],
    cwd: APP_DIR,
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: /Talk/ }).waitFor();
  /**
   * The page's report.
   *
   * @returns What window.__mic says now.
   */
  const report = () => page.evaluate(() => (window as unknown as { __mic: MicReport }).__mic);
  await page.getByRole('button', { name: /Talk/ }).click();
  // The model loads on the first press (cached after that).
  for (let i = 0; i < 120; i += 1) {
    const now = await report();
    if (now.state === 'listening' || now.error) break;
    await wait(500);
  }
  console.info('after Talk:', JSON.stringify(await report()));
  // A real voice into the real microphone: Windows speech through the speakers.
  spawn(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume = 100; $s.Rate = -1; $s.Speak('${SPOKEN}')`,
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 40; i += 1) {
    const now = await report();
    if (now.sent.length > 0 || now.error) break;
    await wait(500);
  }
  const final = await report();
  console.info('after speaking:', JSON.stringify(final));
  const { bounds, scale } = await app.evaluate(({ BrowserWindow, screen }) => ({
    bounds: BrowserWindow.getAllWindows()[0]!.getBounds(),
    scale: screen.getPrimaryDisplay().scaleFactor,
  }));
  // Pinned on top for the capture, so no other window (the developer's own) is captured.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setAlwaysOnTop(true, 'normal');
    win.focus();
  });
  await wait(800);
  execFileSync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(APP_DIR, 'tests', 'visual', 'capture.ps1'),
    '-X',
    String(Math.round(bounds.x * scale)),
    '-Y',
    String(Math.round(bounds.y * scale)),
    '-W',
    String(Math.round(Math.min(bounds.width, 900) * scale)),
    '-H',
    String(Math.round(Math.min(bounds.height, 360) * scale)),
    '-Out',
    path.join(OUT, '09-mic-check.png'),
  ]);
  console.info(`capture: ${path.join(OUT, '09-mic-check.png')}`);
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
