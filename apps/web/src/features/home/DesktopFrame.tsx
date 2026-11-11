/**
 * File: apps/web/src/features/home/DesktopFrame.tsx
 * Purpose: The desktop app's window frame around its cards (reference "first desktop app card appear",
 *          ADR-0055): the logo at the left; at the right an optional dark "Buy credits" button, then
 *          compact, move (the drag handle), ⋮ and the red close. The page under it scrolls. "Buy credits"
 *          only shows a short toast: Paramount AI has no payments, and the team account is unlimited.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: lucide-react, src/features/home/HomeMenu.tsx, src/features/appearance/useAppearance,
 *             src/platform, src/ui (BrandLockup, icons)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S10, S12); ADR-0055, ADR-0071
 *
 * The header is the frameless window's drag handle; its buttons opt out.
 */
'use client';

import { Coins } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ResolvedTheme, ThemeChoice } from '@/core/storage/appearancePrefs';
import { getPlatform } from '@/platform';
import { BrandLockup } from '@/ui/BrandLockup';
import { CloseIcon, CollapseIcon, MoreIcon, MoveIcon } from '@/ui/icons';
import { HomeMenu } from './HomeMenu';

/** What Buy credits says: there is nothing to buy. */
export const NO_CREDITS_NEEDED = 'Not needed, your team account is unlimited.';

/**
 * How long the toast stays, in ms: the --k-toast-ms motion token (v1.3.1, 3 s), read from the page's
 * styles; 3000 when it cannot be read (unit tests have no stylesheet).
 *
 * @returns Milliseconds.
 * Called from: useToast()
 */
function toastMs(): number {
  const raw =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue('--k-toast-ms');
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 3_000;
}

/** A toast's look: neutral (dark) for a note, green for something that worked. */
export type ToastTone = 'neutral' | 'success';

/** The toast's colours per tone (v1.3.1: success toasts are green, ADR-0058). */
const TOAST_TONES: Record<ToastTone, string> = {
  neutral: 'bg-ui-primary text-ui-on-primary',
  success: 'bg-ui-accent-fill text-ui-on-accent',
};

/** The message a toast shows. */
interface ToastMessage {
  /** Changes with every message, so the same text shown twice replays the slide-up. */
  id: number;
  /** The words. */
  text: string;
  /** Neutral or success. */
  tone: ToastTone;
}

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
  /** Show the dark "Buy credits" button (ADR-0071: on every card of the launcher). */
  buyCredits?: boolean;
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
export function DesktopFrame({
  email,
  theme,
  resolved,
  zoom,
  buyCredits = false,
  children,
}: DesktopFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();

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
      {/* @container: a narrow window (an older desktop app keeps 400 px) drops Buy credits' words. */}
      <header className="@container flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 [-webkit-app-region:drag]">
        <span className="min-w-0 flex-1">
          <BrandLockup tone={resolved === 'dark' ? 'dark' : 'light'} size="md" />
        </span>
        {buyCredits && <BuyCreditsButton onPress={() => toast.show(NO_CREDITS_NEEDED)} header />}
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
      <ToastContext.Provider value={toast.show}>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </ToastContext.Provider>
      {toast.current && (
        // key: a new message replays the slide-up (200 ms, k-anim-toast).
        <p
          key={toast.current.id}
          role="status"
          className={`k-anim-toast pointer-events-none absolute bottom-6 left-1/2 z-40 max-w-[90%] -translate-x-1/2 rounded-control px-4 py-2.5 text-center text-[14px] font-medium shadow-modal ${TOAST_TONES[toast.current.tone]}`}
        >
          {toast.current.text}
        </p>
      )}
    </div>
  );
}

/** The frame's toast, for the cards inside it. */
const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);

/**
 * The frame's toast.
 *
 * @returns A function that shows a short message.
 * Called from: LauncherStart.tsx
 */
export function useFrameToast(): (text: string, tone?: ToastTone) => void {
  return useContext(ToastContext);
}

/**
 * A toast's state: the message and a timer that clears it after --k-toast-ms.
 *
 * @returns The message shown (or null) and show(text, tone).
 * Called from: DesktopFrame
 */
function useToast(): {
  current: ToastMessage | null;
  show: (text: string, tone?: ToastTone) => void;
} {
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((text: string, tone: ToastTone = 'neutral') => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent({ id: Date.now(), text, tone });
    timer.current = setTimeout(() => setCurrent(null), toastMs());
  }, []);
  return { current, show };
}

/**
 * The dark "Buy credits" button. It never starts a payment: it shows NO_CREDITS_NEEDED.
 *
 * @param props.onPress What it does (show the toast).
 * @param props.header  True in the window header (40 px tall, words hidden in a narrow window); false
 *                      for the full-width button on the Start card.
 * @param props.label   Its words (default "Buy credits").
 * @returns The button.
 * Rendered by: DesktopFrame, LauncherStart.tsx
 */
export function BuyCreditsButton({
  onPress,
  header = false,
  label = 'Buy credits',
}: {
  /** What it does. */
  onPress: () => void;
  /** True in the window header. */
  header?: boolean;
  /** Its words. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className={
        header
          ? 'inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-ui-primary px-3.5 text-[15px] font-semibold text-ui-on-primary hover:bg-ui-primary-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]'
          : 'inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-ui-primary px-4 text-[15px] font-semibold text-ui-on-primary hover:bg-ui-primary-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]'
      }
    >
      {header && <Coins aria-hidden="true" size={18} strokeWidth={1.75} />}
      <span className={header ? '@max-[460px]:hidden' : ''}>{label}</span>
    </button>
  );
}
