/**
 * File: apps/web/src/features/home/HomePanel.tsx
 * Purpose: The home panel, the desktop app's window between calls (v1.1.0, ADR-0041): the launcher
 *          (Launcher.tsx: ADR-0051, ADR-0055). Every account has account sync (ADR-0092), so the classic
 *          local-only panel (session cards stored on this computer, the session-file start card) is
 *          gone. Opened anywhere but a desktop app from 1.1.0, the launcher sends it to the dashboard.
 * Used by: app/home/page.tsx
 * Depends on: ./Launcher.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.3; ADR-0041, ADR-0051, ADR-0092
 */
'use client';

import { Launcher } from './Launcher';

/** Props for HomePanel. */
export interface HomePanelProps {
  /** The signed-in person's email. */
  email: string;
  /** The session a paramountai:// link named: its Connect card shows first. */
  startSessionId?: string;
}

/**
 * The home panel: the launcher.
 *
 * @param props See HomePanelProps.
 * @returns The panel.
 * Rendered by: app/home/page.tsx
 */
export function HomePanel({ email, startSessionId }: HomePanelProps) {
  return <Launcher email={email} {...(startSessionId ? { fromBrowserId: startSessionId } : {})} />;
}
