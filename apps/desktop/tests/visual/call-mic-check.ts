/**
 * File: apps/desktop/tests/visual/call-mic-check.ts
 * Purpose: v1.0.3 item 4, during a call: in the REAL desktop shell (dev build) connects a real call
 *          on the rig's /call page (apps/web/tests/visual/rig-call.tsx: the real LivePage; the real
 *          microphone and the computer's sound, the real speech engine), presses the message box's
 *          microphone, has Windows speak a question through the speakers into the microphone, and
 *          reports what happened: the button's state, the question the dictated message produced
 *          (answers fail on purpose: the rig has no /api/answer), any page errors, with screen
 *          captures. Usage as mic-check.ts.
 * Used by: the developer before a release (needs a microphone, speakers and a screen)
 * Depends on: @playwright/test (_electron), PowerShell (System.Speech, capture.ps1)
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

/** apps/desktop. */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the captures go. */
const OUT = path.resolve(process.argv[2] ?? path.join(APP_DIR, 'test-results', 'call-mic-check'));

/**
 * Waits.
 *
 * @param ms Milliseconds.
 * @returns When done.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captures the main window from the screen.
 *
 * @param app  The shell.
 * @param name The file name (without .png).
 */
async function capture(app: ElectronApplication, name: string): Promise<void> {
  // Pinned on top for the capture, so no other window (the developer's own) is captured.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setAlwaysOnTop(true, 'normal');
    win.focus();
  });
  await wait(800);
  const { bounds, scale } = await app.evaluate(({ BrowserWindow, screen }) => ({
    bounds: BrowserWindow.getAllWindows()[0]!.getBounds(),
    scale: screen.getPrimaryDisplay().scaleFactor,
  }));
  const file = path.join(OUT, `${name}.png`);
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
    String(Math.round(bounds.width * scale)),
    '-H',
    String(Math.round(bounds.height * scale)),
    '-Out',
    file,
  ]);
  console.info(`capture: ${file}`);
}

/** Runs the check. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [
      APP_DIR,
      '--kite-url=http://localhost:3123/call',
      `--user-data-dir=${path.join(OUT, 'profile')}`,
    ],
    cwd: APP_DIR,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('dictat')) {
      errors.push(`${message.type()}: ${message.text().slice(0, 200)}`);
    }
  });
  const connect = page.getByRole('button', { name: /^Connect/ });
  await connect.waitFor({ timeout: 120_000 });
  // The model must be ready before Connect works.
  await page.waitForFunction(
    () => !(document.querySelector('button') as HTMLButtonElement | null)?.disabled,
    undefined,
    { timeout: 120_000 },
  );
  await connect.click();
  const mic = page.getByRole('button', { name: 'Speak a question' });
  // With nothing playing on the computer, the sound check waits for "Go live".
  const goLive = page.getByRole('button', { name: 'Go live' });
  await Promise.race([mic.waitFor({ timeout: 60_000 }), goLive.waitFor({ timeout: 60_000 })]).catch(
    () => undefined,
  );
  if (await goLive.isVisible()) await goLive.click();
  try {
    await mic.waitFor({ timeout: 60_000 });
  } catch (error) {
    // Show what the call page says instead (a channel error, a notice), then give up.
    await capture(app, '10-call-mic-failed');
    console.info(`page text: ${(await page.locator('body').innerText()).slice(0, 600)}`);
    await app.close();
    throw error;
  }
  await wait(3_000);
  await mic.click();
  const listening = await page.getByRole('button', { name: 'Stop listening' }).isVisible();
  console.info(`after pressing the microphone: ${listening ? 'listening' : 'NOT listening'}`);
  // The window's own contents (no desktop around it): the state right after the press.
  await page.screenshot({ path: path.join(OUT, '10-call-mic-listening.png') });
  spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume = 100; $s.Rate = -1; $s.Speak('What production grade applications have you built?')",
  ]);
  // Sent after a 1.2 s pause; the answer then fails (no /api/answer in the rig), on purpose.
  await wait(6_000);
  const questions = await page.getByLabel('Question').allInnerTexts();
  const stillListening = await page.getByRole('button', { name: 'Stop listening' }).isVisible();
  console.info(`questions on the answer cards: ${JSON.stringify(questions)}`);
  console.info(`still listening: ${stillListening}`);
  await page.screenshot({ path: path.join(OUT, '11-call-mic-sent.png') });
  console.info(`page errors: ${JSON.stringify(errors.slice(0, 10))}`);
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
