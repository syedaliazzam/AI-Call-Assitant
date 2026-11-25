/**
 * File: apps/web/src/features/permissions/MacPermissions.tsx
 * Purpose: The Mac permission screen (desktop 1.8.0, ADR-0111): which of the two macOS permissions
 *          Paramount AI still needs (Microphone; Screen & System Audio Recording), a button that asks macOS
 *          or opens the right System Settings page, and "Quit and reopen" (macOS applies a new Screen
 *          Recording permission only to a freshly started app). Shown on the home panel the first time
 *          (until both are on, or "Later" for this run), and again whenever Connect finds one missing.
 *          Only in the desktop app on a Mac (getPlatform().macPermissions); nothing anywhere else.
 * Used by: src/features/home/Launcher.tsx (first run), src/features/home/LauncherConnect.tsx and
 *          src/features/live/ConnectPanel.tsx (Connect)
 * Depends on: @kite/shared (MacPermissionKind, MacPermissionState), src/platform (macPermissions),
 *             src/ui (Button)
 * Architecture: docs/decisions/ADR-0111-mac-parity.md
 */
'use client';

import type { MacPermissionKind, MacPermissionState, MacPermissionStatus } from '@kite/shared';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';

/**
 * Whether both permissions are on.
 *
 * @param state The states.
 * @returns True when the microphone and screen recording are both granted.
 * Called from: useMacPermissions(), LauncherConnect.tsx, ConnectPanel.tsx; tests
 */
export function macPermissionsReady(state: MacPermissionState): boolean {
  return state.microphone === 'granted' && state.screen === 'granted';
}

/**
 * Before Connect: reads the permissions again and tells whether the call can start.
 *
 * @returns The states when one is missing (show the card), or null when the call can start (both on, not a
 *          Mac, or the shell could not tell: the call itself then reports any problem).
 * Called from: LauncherConnect.tsx connect(), ConnectPanel.tsx (Connect)
 */
export async function missingMacPermissions(): Promise<MacPermissionState | null> {
  const host = getPlatform().macPermissions;
  if (!host) return null;
  const state = await host.read().catch(() => null);
  return state && !macPermissionsReady(state) ? state : null;
}

/** What one permission is for, in the card. */
const ROWS: readonly { kind: MacPermissionKind; title: string; detail: string }[] = [
  { kind: 'microphone', title: 'Microphone', detail: 'Your side of the call.' },
  {
    kind: 'screen',
    title: 'Screen & System Audio Recording',
    detail: 'The other side of the call, screenshots and screen recordings.',
  },
];

/**
 * The words for a permission's state.
 *
 * @param status What macOS reports.
 * @returns A short phrase.
 * Called from: MacPermissionsCard; tests
 */
export function statusWords(status: MacPermissionStatus): string {
  if (status === 'granted') return 'Allowed';
  if (status === 'restricted') return 'Blocked by this Mac’s settings: ask IT';
  if (status === 'denied') return 'Turned off: turn it on in System Settings';
  return 'Not allowed yet';
}

/** Props for MacPermissionsCard. */
export interface MacPermissionsCardProps {
  /** The states to show (the card reads them again after each button). */
  state: MacPermissionState;
  /** Called with the new states after a button. */
  onChange: (state: MacPermissionState) => void;
  /** Why the card is shown: before the first call, or because Connect found one missing. */
  reason: 'first-run' | 'connect';
  /** "Later": hides the first-run card for this run (absent: no Later button). */
  onLater?: () => void;
}

/**
 * The card: one row per permission with its state and the button that fixes it, then "Quit and reopen"
 * while screen recording is not on.
 *
 * @param props See MacPermissionsCardProps.
 * @returns The card.
 * Rendered by: Launcher.tsx, LauncherConnect.tsx, ConnectPanel.tsx
 */
export function MacPermissionsCard({ state, onChange, reason, onLater }: MacPermissionsCardProps) {
  const host = getPlatform().macPermissions;
  const [busy, setBusy] = useState(false);

  /**
   * Runs a step, then reads the states again.
   *
   * @param step What to do.
   */
  const run = async (step: () => Promise<unknown>) => {
    if (!host) return;
    setBusy(true);
    try {
      await step();
      const next = await host.read();
      if (next) onChange(next);
    } catch {
      // The states stay as they were; the person can try again or use System Settings.
    } finally {
      setBusy(false);
    }
  };

  /**
   * The button for one permission: ask macOS the first time, otherwise open System Settings.
   *
   * @param kind   The permission.
   * @param status Its state.
   * @returns The button, or nothing once it is allowed (or blocked by a device policy).
   */
  const action = (kind: MacPermissionKind, status: MacPermissionStatus) => {
    if (!host || status === 'granted' || status === 'restricted') return null;
    if (status === 'not-determined' || status === 'unknown') {
      return (
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => run(() => host.request(kind))}
        >
          Allow
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => run(() => host.openSettings(kind))}
      >
        Open System Settings
      </Button>
    );
  };

  return (
    <section
      aria-label="Mac permissions"
      className="flex flex-col gap-3 rounded-card border border-ui-border bg-ui-surface p-4 text-[14px] text-ui-text"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-label text-ui-heading">
          {reason === 'connect'
            ? 'Paramount AI needs two permissions first'
            : 'Before your first call on this Mac'}
        </h2>
        <p className="text-helper text-ui-muted">
          macOS asks once. Paramount AI never stores call audio.
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {ROWS.map((row) => {
          const status = state[row.kind];
          return (
            <li key={row.kind} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ui-heading">{row.title}</p>
                <p className="text-helper text-ui-muted">{row.detail}</p>
                <p
                  className={`flex items-center gap-1 text-helper ${status === 'granted' ? 'text-ui-success' : 'text-ui-warning'}`}
                >
                  {status === 'granted' && <Check aria-hidden="true" size={14} />}
                  {statusWords(status)}
                </p>
              </div>
              {action(row.kind, status)}
            </li>
          );
        })}
      </ul>
      {state.screen !== 'granted' && state.screen !== 'restricted' && (
        <div className="flex flex-col gap-2 rounded-control border border-ui-border p-3">
          <p>
            In System Settings, turn on <strong>Paramount AI</strong> under Screen &amp; System
            Audio Recording, then <strong>quit and reopen</strong> Paramount AI: macOS applies it
            only after a restart.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => host?.openSettings('screen') ?? Promise.resolve())}
            >
              Open System Settings
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void host?.relaunch()}
            >
              Quit and reopen
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => run(() => Promise.resolve())}
        >
          Check again
        </Button>
        {onLater && (
          <Button size="sm" variant="ghost" onClick={onLater}>
            Later
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * The permission states for the first-run card: read once when the page opens (in the Mac desktop app
 * only), and whenever the window comes back to the front (after System Settings).
 *
 * @returns The states (null until read, and always null outside the Mac desktop app) and a setter.
 * Called from: Launcher.tsx
 */
export function useMacPermissions(): {
  state: MacPermissionState | null;
  setState: (state: MacPermissionState) => void;
} {
  const [state, setState] = useState<MacPermissionState | null>(null);
  const read = useCallback(() => {
    const host = getPlatform().macPermissions;
    if (!host) return;
    host
      .read()
      .then((next) => {
        if (next) setState(next);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    read();
    // Back from System Settings: show what changed (screen recording still needs the restart).
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, [read]);
  return { state, setState };
}
