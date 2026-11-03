/**
 * File: apps/web/src/features/live/TopBar.tsx
 * Purpose: The answers panel's top bar (v1.0.2, reference layout), the same in the desktop main
 *          window and the browser split view: the call timer, the ⋮ menu (Open overlay, Script bar,
 *          Answer preferences, Clear answers, Reset overlay size and position, End call) and Exit.
 *          Answer and Screenshot are the large buttons under the message box (LiveAnswers.tsx).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/ui (Button, Menu, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0035
 */
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { MenuIcon } from '@/ui/icons';
import { Menu, type MenuItem } from '@/ui/Menu';

/** Props for TopBar. */
export interface TopBarProps {
  /** When the call connected (Unix ms), for the timer. */
  callStartedAt: number;
  /** The ⋮ menu's actions, in order. */
  menu: readonly MenuItem[];
  /** Ends the call. */
  onExit: () => void;
  /** True while End waits for the last line. */
  ending: boolean;
}

/**
 * Writes a call time as m:ss, or h:mm:ss from one hour.
 *
 * @param seconds Whole seconds.
 * @returns For example "4:07".
 * Called from: TopBar; tests
 */
export function callClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * The top bar.
 *
 * @param props See TopBarProps.
 * @returns The bar.
 * Rendered by: LiveAnswers.tsx
 */
export function TopBar(props: TopBarProps) {
  // The timer ticks from a clock state the interval advances (no setState in the effect body).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((nowMs - props.callStartedAt) / 1_000));

  return (
    <div className="flex items-center gap-2 border-b border-ui-border pb-3">
      <span
        className="font-mono text-[15px] tabular-nums text-ui-text"
        aria-label="Call time"
        role="timer"
      >
        {callClock(elapsed)}
      </span>
      <span className="flex-1" />
      <Menu label={<MenuIcon />} ariaLabel="More" variant="ghost" items={props.menu} />
      <Button variant="danger" size="sm" onClick={props.onExit} disabled={props.ending}>
        {props.ending ? 'Ending…' : 'Exit'}
      </Button>
    </div>
  );
}
