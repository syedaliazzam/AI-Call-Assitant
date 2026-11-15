/**
 * File: apps/web/src/features/home/DesktopFrame.tsx
 * Purpose: The desktop app's window frame around its cards (reference "first desktop app card appear",
 *          ADR-0055): the logo at the left; at the right compact, move (the drag handle), ⋮ and the red
 *          close. The page under it scrolls. ADR-0082: no "Buy credits" button (Paramount AI has no
 *          payments; it only showed a toast), so the frame has no toast either.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: lucide-react, src/features/home/HomeMenu.tsx, src/features/appearance/useAppearance,
 *             src/platform, src/ui (BrandLockup, icons)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S10, S12); ADR-0055, ADR-0071, ADR-0082
 *
 * The header is the frameless window's drag handle; its buttons opt out.
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ResolvedTheme, ThemeChoice } from '@/core/storage/appearancePrefs';
import { getPlatform } from '@/platform';
import { BrandLockup } from '@/ui/BrandLockup';
import { CloseIcon, CollapseIcon, MoreIcon, MoveIcon } from '@/ui/icons';
import { HomeMenu } from './HomeMenu';

/** A square header button (reference: 40 px, a light outline, radius 10). */
const FRAME_BUTTON =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-ui-border bg-ui-bg text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]';

/** Props for DesktopFrame. */
export interface DesktopFrameProps {
  /** The signed-in person's email (the ⋮ menu's first row). */
  email: string;
  /** The theme chosen (the ⋮ menu). */
  theme: ThemeChoice;
  /** The theme painted. */
  resolved: ResolvedTheme;
  /** The UI scale (the ⋮ menu). */
  zoom: number;
  /** The card(s) under the header. */
  children: ReactNode;
}

/**
 * The frame.
 *
 * @param props See DesktopFrameProps.
 * @returns The header, the page and the toast.
 * Rendered by: Launcher.tsx
 */
export function DesktopFrame({ email, theme, resolved, zoom, children }: DesktopFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // A press anywhere else, or Escape, closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest?.('[data-menu="home"]') || target.closest?.('[aria-label="Menu"]')) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div
      className={`${resolved === 'dark' ? 'k-dark' : 'k-light'} relative flex h-screen flex-col overflow-hidden bg-ui-bg text-ui-text`}
    >
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 [-webkit-app-region:drag]">
        <span className="min-w-0 flex-1">
          <BrandLockup tone={resolved === 'dark' ? 'dark' : 'light'} size="md" />
        </span>
        <button
          type="button"
          className={FRAME_BUTTON}
          aria-label="Compact"
          onClick={() => getPlatform().windowControl('minimize')}
        >
          <CollapseIcon />
        </button>
        {/* The whole header drags the window; this is where people look for it. */}
        <span
          role="img"
          aria-label="Drag here to move"
          className={`${FRAME_BUTTON.replace('[-webkit-app-region:no-drag]', '')} cursor-move`}
        >
          <MoveIcon />
        </span>
        <button
          type="button"
          className={FRAME_BUTTON}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((was) => !was)}
        >
          <MoreIcon />
        </button>
        <button
          type="button"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-ui-end text-ui-on-end hover:opacity-90 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
          aria-label="Close"
          onClick={() => getPlatform().windowControl('close')}
        >
          <CloseIcon />
        </button>
        {menuOpen && (
          <HomeMenu
            email={email}
            theme={theme}
            zoom={zoom}
            onClose={() => setMenuOpen(false)}
            launcher
          />
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
