/**
 * File: apps/desktop/src/icon.ts
 * Purpose: The app's window icon (UI theme stage U4): build/icon.png, made from the company
 *          logo mark by apps/web/scripts/make-brand.ts. Windows shows it in the title bar and
 *          the taskbar. A packaged app (Day 6) takes its icon from the .exe (build/icon.ico),
 *          so a missing file here only means Electron's default icon.
 * Used by: src/main.ts (the main and compact windows)
 * Depends on: node:fs, node:path
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3 (desktop shell);
 *               docs/design/kite-ui-theme.md §7 (brand assets)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The window icon's path, when the file is there.
 *
 * @param baseDir The folder holding main.js (dist/); build/ is next to it.
 * @param exists  File check (tests pass their own).
 * @returns The path, or undefined to keep Electron's default icon.
 * Called from: main.ts (BrowserWindow options); tests
 */
export function appIconPath(
  baseDir: string,
  exists: (file: string) => boolean = existsSync,
): string | undefined {
  const file = path.join(baseDir, '..', 'build', 'icon.png');
  return exists(file) ? file : undefined;
}
