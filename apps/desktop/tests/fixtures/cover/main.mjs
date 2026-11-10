/**
 * File: apps/desktop/tests/fixtures/cover/main.mjs
 * Purpose: Test fixture (not shipped): a full-screen synthetic "meeting" that covers the main display while
 *          a recording test runs, so the developer's real screen is never recorded (desktop 1.5.0,
 *          ADR-0068). It runs as its own Electron process, so Paramount AI's Private setting (which
 *          protects every window of the app) can never hide it from a capture. Four coloured corner markers
 *          let the test check that it covers everything before it records. Prints "cover-ready" once
 *          shown; closes when its process is killed.
 * Used by: apps/desktop/tests/manual/recording.spec.ts (spawned with Electron and a temporary profile)
 * Depends on: electron, ./cover.html
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md (tests never record the real screen)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, screen } from 'electron';

/** This fixture's folder (cover.html is beside it). */
const HERE = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay();
  const cover = new BrowserWindow({
    ...display.bounds,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    skipTaskbar: false,
    backgroundColor: '#f3f4f6',
    webPreferences: { backgroundThrottling: false },
  });
  // Above everything but the test's own Kite windows, which the test raises afterwards.
  cover.setAlwaysOnTop(true, 'screen-saver');
  cover.setIgnoreMouseEvents(true);
  await cover.loadFile(path.join(HERE, 'cover.html'));
  cover.showInactive();
  cover.setBounds(display.bounds);
  // The test reads this line from stdout.
  setTimeout(() => console.log('cover-ready'), 1_000);
});
