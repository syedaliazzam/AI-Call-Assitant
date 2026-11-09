/**
 * File: apps/web/src/features/live/BrowserCallLayout.tsx
 * Purpose: The browser live call view as a split screen (live-ui-split) that fills the whole window,
 *          over the app's sidebar, so the shared screen gets the room. On the left, edge to edge,
 *          the shared-tab preview and its control strip (TabPreview) with the live transcript under
 *          them; on the right the brand and the call's top bar (call timer, ⋮ menu, End) above the
 *          answers panel (passed in as `answers`: the same panel as the desktop main window since
 *          v1.0.2). A divider between the halves is draggable and remembered per device; at 1280 px
 *          and wider the halves sit side by side, below that they stack (preview above answers). An
 *          arrow on the window's right edge hides or shows the answers.
 * Used by: src/features/live/LivePage.tsx (browser only; the desktop keeps LiveCallLayout)
 * Depends on: src/features/live/TabPreview.tsx, src/core/live/splitPane.ts, src/ui (BrandLockup,
 *             Badge, icons), React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0033
 * Theme: docs/design/kite-ui-theme.md §6 (live view: dark)
 */
'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { clampSplit, getSplit, setSplit, SPLIT_RANGE } from '@/core/live/splitPane';
import { useAppearance } from '@/features/appearance/useAppearance';
import { BrandLockup } from '@/ui/BrandLockup';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { ChevronDownIcon } from '@/ui/icons';
import { TabPreview, type TabPreviewProps } from './TabPreview';

/** The call's status badge in the top bar. */
export interface BrowserCallStatus {
  /** The badge's tone. */
  tone: BadgeTone;
  /** The badge's text. */
  label: string;
}

/** Props for BrowserCallLayout. */
export interface BrowserCallLayoutProps {
  /** The call's title (a mono eyebrow), for example "Interview call". */
  title: string;
  /** The session's company or topic. */
  name: string;
  /** The status badge. */
  status: BrowserCallStatus;
  /** The audio meters (in the control strip). */
  meters: ReactNode;
  /** The shared-tab preview and its control strip. */
  preview: TabPreviewProps;
  /** The live transcript (shown under the preview). */
  transcript: ReactNode;
  /**
   * The answers panel (LiveAnswers.tsx): its own top bar (call timer, ⋮ menu, Exit), the answers,
   * the message box and the Answer and Screenshot buttons (v1.0.2: the same panel as the desktop).
   */
  answers: ReactNode;
  /** Notices above the transcript (channel errors, restarts), or nothing. */
  notices?: ReactNode;
  /** Receives the element the call's top bar goes in (LiveAnswers renders into it). */
  topBarSlot?: (element: HTMLDivElement | null) => void;
}

/**
 * A no-op subscription: the remembered split fraction does not change from outside this component.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Subscribes to a media query (the split breakpoint), so the layout re-renders when it changes.
 *
 * @param query A media query string.
 * @returns True when it matches (false during the server render).
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/**
 * The browser split call view.
 *
 * @param props See BrowserCallLayoutProps.
 * @returns The split screen.
 * Rendered by: LivePage.tsx (browser)
 */
export function BrowserCallLayout({ topBarSlot, ...props }: BrowserCallLayoutProps) {
  // The call's theme (v1.3.0: dark until chosen). Read only here: LiveAnswers' ⋮ changes it.
  const { resolved } = useAppearance('call', false);
  // 1280 px and wider: the two halves sit side by side with a draggable divider; narrower: stacked.
  const wide = useMediaQuery('(min-width: 1280px)');
  // The remembered divider position (server render uses the default, so the two renders match);
  // once the user drags, their live choice takes over until they let go, when it is saved.
  const savedFraction = useSyncExternalStore(subscribeNever, getSplit, () => SPLIT_RANGE.default);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const fraction = dragFraction ?? savedFraction;
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Dragging the divider: the left column's width is the pointer's share of the body's width.
  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragging.current || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    setDragFraction(clampSplit((event.clientX - rect.left) / rect.width));
  }, []);
  const stopDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setDragFraction((value) => {
      if (value !== null) setSplit(value);
      return value;
    });
  }, []);
  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDrag);
    };
  }, [onPointerMove, stopDrag]);

  const sideBySide = wide && !collapsed;
  const left = (
    // Stacked (narrow) the window scrolls, so this column takes its own height instead of sharing.
    <section
      aria-label="Shared tab and transcript"
      className={`flex min-w-0 flex-col ${wide ? 'min-h-0 flex-1' : 'shrink-0'}`}
      style={sideBySide ? { gridColumn: 1, gridRow: '1 / 3' } : undefined}
    >
      <TabPreview {...props.preview} meters={props.meters} />
      {props.notices && <div className="flex flex-col gap-2 px-4 pt-3">{props.notices}</div>}
      <div className={`flex min-h-0 flex-col ${wide ? 'flex-1' : 'h-80'}`}>{props.transcript}</div>
    </section>
  );
  const right = (
    // Stacked (narrow) the panel needs its own height: the answers scroll inside it. Hidden, not
    // removed (v1.0.4): this panel owns the call's answers and the overlay's link.
    <section
      aria-label="Answers panel"
      className={`min-h-0 min-w-0 flex-col p-4 ${collapsed ? 'hidden' : 'flex'} ${sideBySide ? '' : 'h-[40rem] shrink-0'}`}
      style={sideBySide ? { gridColumn: 3, gridRow: 2 } : undefined}
    >
      {props.answers}
    </section>
  );

  return (
    // fixed inset-0: the call takes the whole window, over the sidebar, whose width it needs. The
    // app's dialogs and notices still show above it: they open in the browser's top layer.
    <div
      ref={bodyRef}
      className={`${resolved === 'light' ? 'k-light' : 'k-dark'} @container fixed inset-0 z-30 bg-ui-bg text-ui-text ${sideBySide ? 'grid' : 'flex flex-col'} ${wide ? '' : 'overflow-y-auto'}`}
      style={
        sideBySide
          ? {
              gridTemplateColumns: `${fraction}fr 0.5rem ${1 - fraction}fr`,
              gridTemplateRows: 'auto minmax(0, 1fr)',
            }
          : undefined
      }
    >
      <header
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ui-border bg-ui-band px-4 py-2.5"
        style={sideBySide ? { gridColumn: 3, gridRow: 1 } : undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <BrandLockup tone={resolved} size="sm" byline={false} />
          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-ui-border" />
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-medium text-ui-heading">{props.name}</h1>
            <div className="flex items-center gap-2">
              <p className="truncate text-[12px] text-ui-muted">{props.title}</p>
              <Badge tone={props.status.tone}>{props.status.label}</Badge>
            </div>
          </div>
        </div>
        {/* empty:hidden: in a harness with no top bar in the slot, no empty space shows. */}
        <div ref={topBarSlot} className="shrink-0 empty:hidden" />
      </header>

      {left}
      {sideBySide && (
        // The draggable divider; a wide hit area, a thin visible line.
        <div
          role="separator"
          aria-label="Resize"
          aria-orientation="vertical"
          className="group relative flex cursor-col-resize items-center justify-center"
          style={{ gridColumn: 2, gridRow: '1 / 3' }}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
        >
          <span className="absolute inset-y-0 w-px bg-ui-border" />
          <span className="relative h-16 w-1 rounded-full bg-ui-muted group-hover:bg-ui-text" />
        </div>
      )}
      {right}

      {/* The arrow on the window's edge hides the answers, leaving the preview the whole width. */}
      {wide && (
        <button
          type="button"
          aria-label={collapsed ? 'Show answers' : 'Hide answers'}
          aria-pressed={collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="absolute right-1 top-1/2 inline-flex h-11 w-6 -translate-y-1/2 items-center justify-center rounded-control border border-ui-border bg-ui-surface text-ui-muted hover:bg-ui-hover hover:text-ui-text focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <span className={`inline-flex ${collapsed ? 'rotate-90' : '-rotate-90'}`}>
            <ChevronDownIcon />
          </span>
        </button>
      )}
    </div>
  );
}
