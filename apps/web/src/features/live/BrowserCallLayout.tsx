/**
 * File: apps/web/src/features/live/BrowserCallLayout.tsx
 * Purpose: The browser live call view as a split screen (live-ui-split): on the left the shared-tab
 *          preview (TabPreview) with the live transcript under it; on the right the answers panel
 *          (passed in as `answers`: the same panel as the desktop main window since v1.0.2, with
 *          its own call timer, ⋮ menu and Exit). A divider between the halves is draggable and
 *          remembered per device; at 1280 px and wider the halves sit side by side, below that they
 *          stack (preview above answers). The right panel can be collapsed to a side arrow.
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
import { BrandLockup } from '@/ui/BrandLockup';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { CollapseIcon, ExpandIcon } from '@/ui/icons';
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
  /** The audio meters (top bar). */
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
  /** Notices across the full width (channel errors, restarts), or nothing. */
  notices?: ReactNode;
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
export function BrowserCallLayout(props: BrowserCallLayoutProps) {
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
    <section
      aria-label="Shared tab and transcript"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    >
      <TabPreview {...props.preview} />
      <div className="flex min-h-[10rem] flex-1 flex-col">{props.transcript}</div>
    </section>
  );
  const right = (
    // Stacked (narrow) the panel needs its own height: the answers scroll inside it.
    <section
      aria-label="Answers panel"
      className={`flex min-h-0 min-w-0 flex-col ${sideBySide ? '' : 'h-[40rem]'}`}
    >
      {props.answers}
    </section>
  );

  return (
    <div className="k-dark @container flex min-h-screen flex-col bg-ui-bg text-ui-text">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-control border-b border-ui-border bg-ui-band px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLockup tone="dark" size="sm" byline={false} />
          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-ui-border" />
          <div className="min-w-0">
            <p className="text-[13px] text-ui-muted">{props.title}</p>
            <h1 className="truncate text-[15px] font-medium text-ui-heading">{props.name}</h1>
          </div>
        </div>
        <Badge tone={props.status.tone}>{props.status.label}</Badge>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex flex-col gap-1">{props.meters}</div>
          {/* The side arrow collapses the answers panel, leaving the preview the whole width. */}
          {wide && (
            <button
              type="button"
              aria-label={collapsed ? 'Show answers' : 'Hide answers'}
              aria-pressed={collapsed}
              onClick={() => setCollapsed((value) => !value)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ui-muted hover:bg-ui-surface hover:text-ui-text focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              {collapsed ? <ExpandIcon /> : <CollapseIcon />}
            </button>
          )}
        </div>
      </header>

      {props.notices && (
        <div className="flex flex-col gap-2 px-4 pt-4 sm:px-6">{props.notices}</div>
      )}

      <div
        ref={bodyRef}
        className={`flex-1 gap-4 p-4 sm:p-6 ${sideBySide ? 'grid h-[calc(100vh-4.5rem)] items-stretch' : 'flex flex-col'}`}
        style={
          sideBySide ? { gridTemplateColumns: `${fraction}fr 0.5rem ${1 - fraction}fr` } : undefined
        }
      >
        {left}
        {sideBySide && (
          // The draggable divider; a wide hit area, a thin visible line.
          <div
            role="separator"
            aria-label="Resize"
            aria-orientation="vertical"
            className="group flex cursor-col-resize items-center justify-center"
            onPointerDown={(event) => {
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
          >
            <span className="h-16 w-1 rounded-full bg-ui-border group-hover:bg-ui-muted" />
          </div>
        )}
        {!collapsed && right}
      </div>
    </div>
  );
}
