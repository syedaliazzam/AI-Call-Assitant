/**
 * File: apps/web/src/features/live/ScreenshotSource.tsx
 * Purpose: Mac 1.8.1 / Windows 1.7.5: what a screenshot answer was made from, on the answer card (the call window's
 *          and the overlay's): a small thumbnail, the screen's name ("Screen 2") when the desktop app says which
 *          screen it took, and "Wrong screen?", which takes the next screen and asks again on the same card. The
 *          screen name and "Wrong screen?" show only with more than one screen and a desktop app that names the
 *          screen (Windows 1.7.5, Mac 1.8.1): a browser and an older desktop app show the thumbnail only.
 * Used by: src/features/live/AnswerPanel.tsx, src/features/live/overlay/OverlayAnswer.tsx
 * Depends on: @kite/shared (the ScreenshotScreen type)
 * Architecture: docs/decisions/ADR-0127-desktop-1.8.1-1.7.5-keys-updates-screens.md §5
 *
 * The thumbnail is a data URL in memory only: never saved, sent or logged.
 */
'use client';

import type { ScreenshotScreen } from '@kite/shared';

/** Props for ScreenshotSource. */
export interface ScreenshotSourceProps {
  /** The screenshot as a small JPEG data URL (or the full one from before the preview existed). */
  image?: string | undefined;
  /** The screen it came from, when the desktop app says; absent in a browser and with an older desktop app. */
  screen?: Pick<ScreenshotScreen, 'number' | 'count'> | undefined;
  /** "Wrong screen?": take the next screen and ask again. Absent: no button. */
  onWrongScreen?: (() => void) | undefined;
  /** True while a screenshot is being taken (the button waits). */
  busy?: boolean | undefined;
  /** 'panel' for the call window's card, 'overlay' for the overlay's smaller card. */
  size?: 'panel' | 'overlay';
}

/**
 * Whether a card should offer "Wrong screen?": its screen is known and the computer has more than one.
 *
 * @param screen The card's screen, if known.
 * @returns True when another screen can be taken.
 * Called from: ScreenshotSource; OverlayAnswer.tsx; tests
 */
export function canRetakeScreen(screen: { count: number } | undefined): boolean {
  return (screen?.count ?? 0) > 1;
}

/**
 * The thumbnail, the screen's name and "Wrong screen?".
 *
 * @param props See ScreenshotSourceProps.
 * @returns The row, or null when there is nothing to show.
 * Rendered by: AnswerPanel (AnswerCard), OverlayAnswer
 */
export function ScreenshotSource(props: ScreenshotSourceProps) {
  const many = canRetakeScreen(props.screen);
  if (!props.image && !many) return null;
  const overlay = props.size === 'overlay';
  return (
    <div
      data-screenshot-source=""
      className={`flex items-center gap-2 ${overlay ? 'mb-1.5 text-[12px]' : 'mb-2 text-[13px]'} text-ui-muted`}
    >
      {props.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.image}
          alt="Screenshot this answer is about"
          className={`${overlay ? 'max-h-10' : 'max-h-20'} rounded-[3px] border border-ui-border`}
        />
      )}
      {many && props.screen && (
        <span data-screen-name="">
          Screen {props.screen.number}
          <span className="sr-only"> of {props.screen.count}</span>
        </span>
      )}
      {many && props.onWrongScreen && (
        <button
          type="button"
          onClick={props.onWrongScreen}
          disabled={props.busy === true}
          aria-label="Wrong screen? Take the next screen and answer again"
          className="rounded-control px-1.5 py-0.5 text-ui-accent underline-offset-2 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          Wrong screen?
        </button>
      )}
    </div>
  );
}
