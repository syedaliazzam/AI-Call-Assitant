/**
 * File: apps/web/src/platform/index.ts
 * Purpose: Picks the right Platform at run time: desktop when the page runs inside the Kite
 *          desktop app (`window.kiteDesktop` exists), otherwise browser. The rest of the app
 *          imports only from here and never checks for the desktop app itself.
 * Used by: src/core/* and src/features/* (from Day 2), tests/unit/platform/index.test.ts
 * Depends on: src/platform/browser.ts, src/platform/desktop.ts, src/platform/desktopDocument.ts,
 *             src/platform/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3
 */
import { browserPlatform } from './browser';
import { createDesktopPlatform, type DesktopPlatform } from './desktop';
import { installDesktopDocument } from './desktopDocument';
import type { Platform } from './types';

export type { DesktopPlatform } from './desktop';
export { CaptureError, NotImplementedError, type CaptureErrorCode } from './errors';
export type { MicDevice } from './media';
export type { HotkeyAction, OtherSideSource, OtherSideStream, Platform } from './types';

/**
 * Returns the Platform for the current environment.
 * While Next.js renders on the server there is no `window`; the browser platform is returned
 * then, but its methods must only be called in the page (for example from event handlers).
 * The result is not cached because building it is cheap and the bridge never changes in a page.
 *
 * @returns The desktop platform if `window.kiteDesktop` exists, otherwise the browser platform.
 * Called from: isDesktop() below; feature and core code that needs audio, screenshots or hotkeys.
 */
export function getPlatform(): Platform {
  const bridge = typeof window === 'undefined' ? undefined : window.kiteDesktop;
  if (!bridge) return browserPlatform;
  // ADR-0055: popups stay inside the window, where screen-share protection reaches (once per page).
  installDesktopDocument();
  return createDesktopPlatform(bridge);
}

/** Details of the desktop shell, for display (for example in the sidebar footer). */
export interface DesktopInfo {
  /** Shell version, for example '0.1.0'. */
  version: string;
  /** Operating system the shell runs on. */
  os: DesktopPlatform['os'];
}

/**
 * Returns the desktop shell's version and OS, or null in a browser (and on the server).
 *
 * @returns DesktopInfo inside the desktop app, otherwise null.
 * Called from: src/ui/Sidebar.tsx (footer label)
 */
export function getDesktopInfo(): DesktopInfo | null {
  const platform = getPlatform();
  if (platform.kind !== 'desktop') return null;
  const { version, os } = platform as DesktopPlatform;
  return { version, os };
}

/**
 * Tells whether Kite is running inside the desktop app.
 * Use it only for display (for example "Desktop app v0.1" in the sidebar), never to branch
 * behaviour; behaviour differences belong in the Platform implementations.
 *
 * @returns True inside the desktop app, false in a normal browser or on the server.
 * Called from: src/ui/Sidebar.tsx (Stage 5)
 */
export function isDesktop(): boolean {
  return getPlatform().kind === 'desktop';
}
