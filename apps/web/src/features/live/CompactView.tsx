/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The overlay (the compact live view; spec S13–S16, ADR-0029, ADR-0041): separate pieces rather
 *          than one window-sized panel. Bar 1 (status, Rec, Auto answer and Click-through toggles, move,
 *          compact, timer, ⋮ and Exit; ADR-0082: no Answer, Screenshot or Chat buttons and no chat bar, the
 *          shortcuts do those), then bar 2, the transcript bar (ADR-0118, like ParakeetAI: always there during
 *          a call, always the live words as phrase chips, with the level, Clear and expand buttons;
 *          StatusBar.tsx), then the call's current warning in a slim line of its own (WarningLine.tsx; it
 *          shared bar 2's line from ADR-0082 to ADR-0118), then the panels: the full transcript opens under
 *          bar 2 (it no longer replaces it). The answer panel opens by itself when an
 *          answer starts; with both panels open they sit side by side when the window is wide enough, and
 *          stack when it is not. Compact shrinks everything to an icon. The panels are see-through with
 *          the opacity setting, and are remembered. The script bar (v1.0.2) replaces all of it with one
 *          slim bar. Presentational: CompactLive.tsx gives it the state.
 * Used by: src/features/live/CompactLive.tsx (desktop overlay window; browser picture-in-picture)
 * Depends on: src/core/live/liveChannel.ts (types), @kite/shared, src/core/storage (overlayPrefs,
 *             appearancePrefs), src/features/live/overlay/*
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13–S16);
 *               docs/architecture/kite-architecture-v3.1.md §5, §4 (protection);
 *               ADR-0029, ADR-0041, ADR-0045
 *
 * Bar 1 is the window's drag handle (the desktop window has no frame); its buttons opt out. Nothing
 * here calls focus() on its own: updates never take the keyboard from the meeting; clicking into a box
 * does.
 *
 * ADR-0055: the empty space around and between the pieces is marked data-gap; in desktop 1.3.0 clicks
 * there pass through to the app behind the overlay (overlay/useClickThrough.ts).
 *
 * v1.3.2: the panels are as tall as what they show (up to the height the window allows), and the page
 * tells the shell that height (OverlayLayout.contentHeight), so the window is exactly its visible box;
 * the space beside a narrower panel stays a gap. A click on a panel's button gives the keyboard back to
 * the app that had it (onReleaseFocus). Click-through mode (⋮ or Ctrl+Alt+X, held by the live page):
 * everything but the bars (data-bars) passes clicks to the app behind, a click on the bars gives the
 * keyboard back too, and bar 1 says "Click-through on".
 *
 * ADR-0056 (desktop 1.3.0): the overlay sits at one of six positions. On the bottom row everything is
 * mirrored: bar 1 at the bottom edge, the chat bar and bar 2 above it, the panels above them, and the
 * menus open upward (theme.css .k-overlay-up); the window grows upward to fit them. The ⋮ menu has the
 * Position grid, and Ctrl+Alt+T turns the transcript on or off while the bars have focus.
 *
 * 1.6.3 (ADR-0075): on the bottom row the panels sit on the bars, as they hang from them on the top row
 * (they were at the top of the window, with empty space between them and the bars, which also kept the
 * window from shrinking to them); stacked panels are mirrored too, the transcript nearest the bars.
 * Auto answer moved to bar 1, so there is no floating Auto answer pill. The panels' look and the
 * opacity setting are unchanged (ADR-0033).
 *
 * ADR-0085: the transcript (left) and the answer (right) sit side by side from 600 CSS px wide, with a
 * divider between them (overlay/PanelSplit.tsx; remembered per device); below that they stack. A panel open
 * alone fills the width. (ADR-0118 removed bar 1's Transcript switch: bar 2's level and expand buttons and
 * Ctrl+Alt+T open and close the full transcript.)
 * The page is as tall as its window at every UI zoom (.k-zoom-screen), so zooming never adds a scrollbar.
 *
 * ADR-0094: bar 1's model chip and the ⋮ menu's Model row switch the answer model (Fast / Smart) for the
 * next answers; once the live page has switched, a short toast says so under bar 1 (above it on the bottom
 * row), and the window grows for it as it does for a menu.
 *
 * ADR-0105 (desktop 1.7.1): with an answer shown, the answer panel is at least its default height (a typical
 * answer with no scrolling; overlay/answerHeight.ts), grows with a longer answer up to what the shell allows
 * (70 % of the work area) and, while the same answer shows, never shrinks (no jumping as it streams); the next
 * answer fits again. Any open menu closes on a press outside it (the closing press triggers nothing), when the
 * window loses focus, on Esc, or when an item is chosen (overlay/usePopupDismiss.ts, LiveMenu.tsx).
 *
 * ADR-0113 (reverses ADR-0085's "a panel open alone fills the width"): the pieces sit in one column as wide as
 * bar 1's natural width (up to the window's), so bar 1 never stretches and never gives way because the answer
 * was resized; bar 2, the warnings and the panels' area are exactly that wide. The answer panel (with the
 * transcript beside it, as one block) has its own width, a share of the bars' width (never wider, so the
 * window never has to grow for it) and never narrower than its button strip; its corner grip changes it (the
 * window's width never changes; up and down still sets the window's height). The column and the panels line
 * up by the position's column: left positions on the left edge, centre ones centred, right ones on the right
 * edge (overlay/panelWidth.ts). The transcript open alone still fills the bars' width.
 *
 * ADR-0115: until the user drags the grip, the answer open alone is 62 % of the bars' width (a reading
 * column; it was the bars' whole width), and the transcript and the answer side by side keep the bars' width
 * (overlay/panelWidth.ts panelsShare()). A dragged width is remembered and used for both, as before.
 *
 * An older desktop shell (1.1.0) has a fixed height for "no panels open" and cannot make an icon. So the
 * page tells every shell how tall its bars are (OverlayLayout.popupHeight, which any shell from 1.1.0
 * honours), and compact collapses to bar 1 where there is no icon.
 */
'use client';

import {
  overlayRow,
  type OverlayLayout,
  type OverlayMode,
  type OverlayPreset,
  type OverlayResizeStep,
  type ShareProtectionState,
} from '@kite/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import {
  THEME_DEFAULTS,
  type ResolvedTheme,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
import {
  getOverlayPanelsWidth,
  getOverlaySplit,
  OVERLAY_OPACITY,
  OVERLAY_PANELS_WIDTH,
  setOverlayPanelsWidth,
  setOverlaySplit,
  type OverlayPanels,
} from '@/core/storage/overlayPrefs';
import type { AnswerModel } from '@/core/storage/types';
import { isTranscriptKey } from '@/platform/keymap';
import {
  answerHoldKey,
  answerPanelMinHeight,
  holdHeight,
  neededPanelHeight,
  type HeldHeight,
} from './overlay/answerHeight';
import { AnswerPreferencesSheet } from './overlay/AnswerPreferencesSheet';
import { DisplaySheet } from './overlay/DisplaySheet';
import { ControlBar, type DeviceList } from './overlay/ControlBar';
import { DevicePicker } from './overlay/DevicePicker';
import { pressRecPill, RecordPopover } from './overlay/RecordControls';
import { usePrivateOffWhileRecording } from './PrivateOffWarning';
import { IconMode } from './overlay/IconMode';
import { LiveMenu } from './overlay/LiveMenu';
import {
  modelOf,
  ModelPopover,
  modelRefusedToast,
  modelSwitchToast,
  modelOff,
} from './overlay/ModelChoice';
import { OverlayAnswer } from './overlay/OverlayAnswer';
import { PanelSplit } from './overlay/PanelSplit';
import {
  columnAlignClass,
  gripSide,
  overlayColumn,
  panelsShare,
  panelsWidthStyle,
  widthShareAfterDrag,
} from './overlay/panelWidth';
import { ownResizeObserver, pieceClass, type LevelStore } from './overlay/parts';
import { ResizeGrips, type WidthDrag } from './overlay/ResizeGrips';
import { ScriptBar } from './overlay/ScriptBar';
import { StatusBar } from './overlay/StatusBar';
import { statusMessage } from './overlay/statusLine';
import { TranscriptPanel } from './overlay/TranscriptPanel';
import { BARS_ATTRIBUTE, GAP_ATTRIBUTE, useClickThrough } from './overlay/useClickThrough';
import { usePopupDismiss } from './overlay/usePopupDismiss';
import { WarningLine } from './overlay/WarningLine';

/** The overlay's window-level settings (desktop app; a browser window cannot do these). */
export interface OverlayWindowSettings {
  /** The chosen panel-background opacity, 0.4–1 (ADR-0033). */
  opacity: number;
  /** The opacity to paint right now: with fading on, lower when the pointer is elsewhere. */
  panelAlpha: number;
  /** Sets the opacity. */
  onOpacity: (value: number) => void;
}

/** Props for CompactView. */
export interface CompactViewProps {
  /** What to show (null until the live page answers). */
  state: CompactState | null;
  /** Protection (null where it does not apply, for example a browser). */
  protection: ShareProtectionState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Turns protection on or off (desktop). */
  onProtection?: (on: boolean) => void;
  /** True on macOS (for the shortcuts' spoken names). */
  mac?: boolean;
  /** The signed-in person's email, once known. */
  email?: string | null | undefined;
  /** Opacity; undefined where the window cannot do it (a browser). */
  windowSettings?: OverlayWindowSettings;
  /**
   * Tells the window which shape the overlay has (desktop: it changes size): full, collapsed to its
   * controls bar, the icon, or the script bar with or without its input (v1.0.2, ADR-0035).
   */
  onMode?: (mode: OverlayMode) => void;
  /** Tells the window which panels are open, so it fits them (desktop 1.1.0+, ADR-0041). */
  onLayout?: (layout: OverlayLayout) => void;
  /** Resizes the window from an edge (desktop 1.0.2+: the see-through window has no frame). */
  onResize?: (step: OverlayResizeStep) => void;
  /** Moves the window to a preset place at its default size (desktop 1.0.2+). */
  onPlace?: (preset: OverlayPreset) => void;
  /**
   * The overlay's position (desktop 1.3.0, ADR-0056): on the bottom row the panels open above the bars.
   * Null until the shell says; absent where there are no positions.
   */
  position?: OverlayPreset | null;
  /** Puts the overlay at one of the six positions (the ⋮ grid; desktop 1.3.0). */
  onPosition?: (preset: OverlayPreset) => void;
  /** Moves the window by a distance; given only where the shell can make the icon (1.2.0). */
  onMove?: ((dx: number, dy: number) => void) | undefined;
  /** Opens the dashboard, where this app has a separate window for it (desktop 1.1.0+, a browser). */
  onDashboard?: () => void;
  /** Opens the user guide, likewise. */
  onHelp?: () => void;
  /** Opens Edit session, likewise. */
  onEditSession?: () => void;
  /** True for the see-through panels (the desktop window); otherwise they are solid. */
  glass?: boolean;
  /** Which panels are open. */
  panels: OverlayPanels;
  /** Opens or closes panels (remembered). */
  onPanels: (panels: OverlayPanels) => void;
  /** The theme chosen. */
  theme?: ThemeChoice;
  /** The theme to paint (a solid picture-in-picture window stays dark). */
  resolvedTheme?: ResolvedTheme;
  /** The UI scale. */
  zoom?: number;
  /** The overlay's text size. */
  fontScale?: number;
  /** Where the live levels come from. */
  levels?: LevelStore;
  /** Puts text on the clipboard (tests pass a fake). */
  copy?: (text: string) => Promise<void>;
  /**
   * Lets clicks pass through the transparent gaps (desktop 1.3.0, ADR-0055); absent where the window is
   * solid or the shell cannot.
   */
  onClickThrough?: (through: boolean) => void;
  /**
   * v1.3.2: gives the keyboard back to the app behind after a click on a panel's button (desktop 1.3.2;
   * absent where the window cannot).
   */
  onReleaseFocus?: () => void;
}

/** Which floating list or menu is open. */
type Popup = DeviceList | 'menu' | 'preferences' | 'display' | 'record' | 'record-notice' | 'model';

/**
 * The most a menu may ask the desktop app's window to grow, in DIPs: the shell refuses a larger request
 * outright (MAX_POPUP_HEIGHT in apps/desktop/src/windows.ts, every version so far), and then the window does
 * not grow at all and the menu is cut off. Asked for at most this, the window grows as far as the screen allows.
 */
export const OVERLAY_MAX_POPUP_HEIGHT = 900;

/** ADR-0094: how long the model toast stays, ms (the --k-toast-ms token's 3 s, spec §1 motion). */
export const MODEL_TOAST_MS = 3_000;

/**
 * ADR-0113: a piece under bar 1 (bar 2, a warning, the panels' area) is exactly as wide as bar 1: it fills the
 * bars' column without widening it (w-0: its own content never counts toward the column's width, which is
 * bar 1's natural width up to the window's). Until ADR-0113 every bar filled the window up to 980 CSS px.
 */
const UNDER_BAR = 'w-0 min-w-full';

/**
 * ADR-0113: how wide the answer panel must be to show its button strip whole, as a share of the bars'
 * width: its max-content width (the strip; the text below it is size-contained and wraps), measured with both
 * boxes in the page's client coordinates, so the share holds at any UI zoom.
 *
 * @param panel The answer panel.
 * @param bars  The bars' column.
 * @returns The share (0 when the bars have no width yet).
 * Called from: CompactView (the minimum width effect, the grip's drag)
 */
function answerMinShare(panel: HTMLElement, bars: HTMLElement): number {
  const barsWidth = bars.getBoundingClientRect().width;
  if (!(barsWidth > 0)) return 0;
  return answerMinWidth(panel) / barsWidth;
}

/**
 * ADR-0113: the answer panel's smallest width (its button strip whole), in client coordinates: its
 * max-content width, measured by sizing it so for one synchronous layout and putting it back.
 *
 * @param panel The answer panel.
 * @returns The width.
 * Called from: answerMinShare(), CompactView (the grip's drag)
 */
function answerMinWidth(panel: HTMLElement): number {
  const { width, flex } = panel.style;
  panel.style.width = 'max-content';
  panel.style.flex = 'none';
  const measured = panel.getBoundingClientRect().width;
  panel.style.width = width;
  panel.style.flex = flex;
  return measured;
}

/**
 * How far an element's top is below the top of the page, whatever it sits inside.
 *
 * @param element The element.
 * @returns The distance, in the page's own pixels (before the UI scale).
 * Called from: extentOf()
 */
function topOf(element: HTMLElement): number {
  let top = 0;
  for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null) {
    top += at.offsetTop;
  }
  return top;
}

/**
 * How much of the window an element needs, from the edge the overlay grows from: from the top down to
 * its bottom, or (on the bottom row, ADR-0056) from the bottom up to its top.
 *
 * @param element The element.
 * @param up      True on the bottom row.
 * @param height  The page's height, in its own pixels.
 * @returns The distance, in the page's own pixels (before the UI scale).
 * Called from: CompactView
 */
function extentOf(element: HTMLElement, up: boolean, height: number): number {
  return up ? height - topOf(element) : topOf(element) + element.scrollHeight;
}

/**
 * ADR-0107: how much of the window a floating menu, sheet or toast needs to show all it holds: its content
 * (scrollHeight) and its borders, from the edge the overlay grows from. On the bottom row the visible box
 * was measured before, which the menu's own max height had already squeezed (the ⋮ menu showed two rows),
 * and the 2 px of borders were never counted (a scrollbar showed in every menu at rest).
 *
 * @param element The floating element (its own box scrolls when it is too tall).
 * @param up      True on the bottom row.
 * @param height  The page's height, in its own pixels.
 * @returns The distance, in the page's own pixels (before the UI scale).
 * Called from: CompactView (the popup height effect)
 */
export function popupExtentOf(element: HTMLElement, up: boolean, height: number): number {
  const borders = element.offsetHeight - element.clientHeight;
  const full = element.scrollHeight + Math.max(0, borders);
  return up ? height - topOf(element) - element.offsetHeight + full : topOf(element) + full;
}

/**
 * How much of the window a panel would need to show everything it holds (v1.3.2): its extent now plus
 * what its scroll areas (data-scroll) hide. Measured from what is there, so a window that is already
 * smaller than the content still learns how tall it should be.
 *
 * @param panel  The panel.
 * @param up     True on the bottom row.
 * @param height The page's height, in its own pixels.
 * @returns The distance, in the page's own pixels (before the UI scale).
 * Called from: CompactView
 */
function naturalExtentOf(panel: HTMLElement, up: boolean, height: number): number {
  const hidden = [...panel.querySelectorAll<HTMLElement>('[data-scroll]')].reduce(
    (sum, scroller) => sum + Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    0,
  );
  // ADR-0105: the answer panel's default height (data-min-height), which a window still shorter than it
  // cannot show yet: the window is asked for it too.
  const minHeight = Number(panel.dataset.minHeight ?? 0) || 0;
  // What lies between the panel and the edge the overlay grows from (the bars, the panels before it).
  const before = up ? height - topOf(panel) - panel.offsetHeight : topOf(panel);
  return before + neededPanelHeight(panel.offsetHeight, hidden, minHeight);
}

/**
 * ADR-0107: whether the open panels are stacked one above the other (both open, under 600 CSS px).
 *
 * @param area   The panels' area.
 * @param panels Its panels.
 * @returns True when there are two panels in a column.
 * Called from: CompactView (the height effect)
 */
function stackedPanels(area: HTMLElement, panels: readonly HTMLElement[]): boolean {
  return panels.length > 1 && getComputedStyle(area).flexDirection.startsWith('column');
}

/**
 * ADR-0107: how much of the window stacked panels need: from the edge the overlay grows from to the far
 * edge of the farthest panel, plus what every panel still hides (each one's own need, its default height
 * included). Measuring each panel alone and taking the largest left the stack short by the other panel's
 * hidden part (the transcript was squeezed to ~10 px under a 1.7.1 answer).
 *
 * @param panels The stacked panels.
 * @param up     True on the bottom row.
 * @param height The page's height, in its own pixels.
 * @returns The distance, in the page's own pixels (before the UI scale).
 * Called from: CompactView (the height effect)
 */
function stackedExtentOf(panels: readonly HTMLElement[], up: boolean, height: number): number {
  const far = Math.max(
    ...panels.map((panel) => (up ? height - topOf(panel) : topOf(panel) + panel.offsetHeight)),
  );
  const missing = panels.reduce((sum, panel) => {
    const hidden = [...panel.querySelectorAll<HTMLElement>('[data-scroll]')].reduce(
      (total, scroller) => total + Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      0,
    );
    const minHeight = Number(panel.dataset.minHeight ?? 0) || 0;
    return sum + neededPanelHeight(panel.offsetHeight, hidden, minHeight) - panel.offsetHeight;
  }, 0);
  return far + missing;
}

/**
 * How the panels' area lays out its panels (1.6.3, ADR-0075). Top row: they hang from the bars, side by
 * side from 600 CSS px (ADR-0085; 900 before) or stacked below that (the transcript first). Bottom row: mirrored, so they sit on
 * the bars: side by side along the bottom, or stacked upward with the transcript nearest the bars. ADR-0119: 600 px
 * of the window (the root, container "overlay"), not of the panels' block, which since ADR-0113 was never wider
 * than bar 1 and so stacked in every 640 px window.
 *
 * @param both True when both panels are open.
 * @param up   True on the bottom row (ADR-0056).
 * @returns The area's flex classes.
 * Called from: CompactView
 */
export function panelsLayout(both: boolean, up: boolean): string {
  if (!both) return up ? 'items-end' : 'items-start';
  return up
    ? 'flex-col-reverse @min-[600px]/overlay:flex-row @min-[600px]/overlay:items-end'
    : 'flex-col @min-[600px]/overlay:flex-row @min-[600px]/overlay:items-start';
}

/** v1.3.2: the window's height follows the content in steps of this many pixels (fewer resizes). */
const CONTENT_STEP = 8;

/** v1.3.2: what a click lands on to give the keyboard back afterwards (buttons, switches, links). */
const RELEASING = 'button, a, [role="switch"], [role="menuitem"]';

/**
 * The overlay.
 *
 * @param props See CompactViewProps.
 * @returns The view.
 * Rendered by: CompactLive.tsx
 */
export function CompactView(props: CompactViewProps) {
  const { state, onCommand, mac = false, panels, onPanels, onMove } = props;
  // 1.5.2 (ADR-0070): a screen recording with Private off: a warning bar, and a hint on the Rec pill.
  const privateOff = usePrivateOffWhileRecording(state?.recording);
  // ADR-0085: Private off during the call (where it can be on), recording or not: an amber line.
  const privateOffInCall =
    props.protection?.supported === true && !props.protection.on && !privateOff.visible;
  const { levels, onResize, copy } = props;
  const glass = props.glass ?? false;
  const zoom = props.zoom ?? 1;
  const fontScale = props.fontScale ?? 1;
  const [popup, setPopup] = useState<Popup | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [icon, setIcon] = useState(false);
  // Clear hides the words on screen at once; the live page keeps them out from then on.
  const [clearedChips, setClearedChips] = useState<readonly string[]>([]);
  const [scriptInput, setScriptInput] = useState(false);
  const [neededHeight, setNeededHeight] = useState(0);
  // ADR-0085: the transcript's share of the width side by side (the divider; remembered per device).
  const [split, setSplit] = useState(getOverlaySplit);
  // ADR-0113: the panels' own width, a share of the bars' width (the answer's corner grip; remembered per
  // device), and the share the answer panel's button strip needs (measured; the width never goes under it).
  // ADR-0115: null until the user drags the grip; the default then depends on the panels open (panelsShare()).
  const [panelsWidth, setPanelsWidth] = useState<number | null>(getOverlayPanelsWidth);
  const [stripShare, setStripShare] = useState(0);
  // ADR-0113: the bars' column (as wide as bar 1), bar 1's own box (its lists float from it), the answer panel.
  const barsColumn = useRef<HTMLDivElement>(null);
  const barsBlock = useRef<HTMLDivElement>(null);
  const answerPanel = useRef<HTMLDivElement>(null);
  // ADR-0113: the grip's drag while it runs: where it started, the width then, and its limits.
  const widthDragFrom = useRef<{ x: number; width: number; min: number; max: number } | null>(null);
  const latestWidth = useRef(panelsWidth);
  const popupElement = useRef<HTMLDivElement>(null);
  const barsEnd = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Desktop 1.5.0 (ADR-0068): the Rec pill, whose popover sits under it (its left edge, measured when
  // the popover opens).
  const recButton = useRef<HTMLButtonElement>(null);
  const [recLeft, setRecLeft] = useState(6);
  // ADR-0094: the model chip, whose popover sits under it, and the toast after a switch.
  const modelButton = useRef<HTMLButtonElement>(null);
  const [modelLeft, setModelLeft] = useState(6);
  const toastElement = useRef<HTMLParagraphElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // v1.3.2: the panels' area, measured for the window's height.
  const panelsArea = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  // ADR-0105: the content height held for the answer shown (it only grows while that answer shows).
  const answerHeld = useRef<HeldHeight | null>(null);
  // ADR-0056: the bottom row mirrors the overlay, so it grows upward from the bars.
  const up = props.position ? overlayRow(props.position) === 'bottom' : false;
  // ADR-0113: and its column lines the pieces up on the left, in the middle or on the right.
  const column = overlayColumn(props.position);

  /**
   * Collapses the overlay to bar 1, or opens it again.
   *
   * @param next True to collapse.
   */
  const collapse = (next: boolean) => {
    setCollapsed(next);
    setPopup(null);
  };

  // Desktop 1.5.0 (ADR-0068): Ctrl+Alt+R (the live page counts the presses) opens the Start or Stop
  // question; a new recording notice opens on its own unless another list is open. While rendering, as
  // React advises for state that follows a changed value.
  const recordPrompts = state?.recording?.promptCount ?? 0;
  const [seenPrompts, setSeenPrompts] = useState(recordPrompts);
  if (recordPrompts !== seenPrompts) {
    setSeenPrompts(recordPrompts);
    if (recordPrompts > seenPrompts) {
      setPopup('record');
      setIcon(false);
      setCollapsed(false);
    }
  }
  const recordNotice = state?.recording?.notice ?? null;
  const [seenNotice, setSeenNotice] = useState(recordNotice);
  if (recordNotice !== seenNotice) {
    setSeenNotice(recordNotice);
    if (recordNotice && (popup === null || popup === 'record-notice')) setPopup('record-notice');
    else if (!recordNotice && popup === 'record-notice') setPopup(null);
  }

  // ADR-0094: the model picked here, until the live page says it is in use (or refused it); then a toast.
  // While rendering, as React advises for state that follows a changed value.
  const modelChoice = modelOf(state);
  const [pendingModel, setPendingModel] = useState<AnswerModel | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  if (pendingModel && modelChoice?.model === pendingModel) {
    setPendingModel(null);
    setToast((was) => ({
      id: (was?.id ?? 0) + 1,
      text: modelSwitchToast(pendingModel),
    }));
  } else if (pendingModel && modelChoice && modelOff(pendingModel, modelChoice)) {
    // An admin turned Smart off between the menu opening and the pick: the model stays as it was. ADR-0095:
    // the same for Groq (or the server has no key); ADR-0099: and for the Gemini and GPT models.
    setPendingModel(null);
    setToast((was) => ({
      id: (was?.id ?? 0) + 1,
      text: modelRefusedToast(pendingModel),
    }));
  }
  // ADR-0095: Voice mode's one-time tip, where the toast shows (never both at once).
  const voiceTipShown = (state?.voiceTip ?? false) && !toast && !state?.ended;
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), MODEL_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  /**
   * ADR-0094: switches the answer model (the live page applies it from the next answer and saves it with
   * the session).
   *
   * @param model The model picked.
   */
  const pickModel = (model: AnswerModel) => {
    setPendingModel(model);
    onCommand({ type: 'model', model });
  };

  // The script bar (v1.0.2): the live page holds whether it is on (Ctrl+Alt+S reaches it there).
  const scriptBar = state?.scriptBar ?? false;
  // The window's shape follows the view: the shell resizes it (ADR-0035).
  const mode: OverlayMode = scriptBar
    ? scriptInput
      ? 'script-input'
      : 'script'
    : icon
      ? 'icon'
      : collapsed
        ? 'collapsed'
        : 'full';
  const onModeRef = useRef(props.onMode);
  const onLayout = useRef(props.onLayout);
  useEffect(() => {
    onModeRef.current = props.onMode;
    onLayout.current = props.onLayout;
  });
  useEffect(() => {
    onModeRef.current?.(mode);
  }, [mode]);

  // ADR-0085: the zoom reaches <html> in CompactLive's effect (useAppearance), after this view's layout
  // effects have measured, and the window's new size arrives later still: measure again on the next
  // frame, and whenever what the panels hold changes size (text re-wrapping at a new zoom or width), so
  // the window is fitted to the text as it is drawn (at 80 % and 130 % the answer panel was fitted to its
  // 100 % wrapping and scrolled). A new measurement that gives the same height changes nothing.
  const [zoomPass, setZoomPass] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setZoomPass((count) => count + 1));
    return () => cancelAnimationFrame(frame);
  }, [zoom, fontScale]);
  const answerOpen = panels.answer;
  const transcriptOpen = panels.transcript;
  const shownAnswer = state?.answer?.id;
  const turnCount = state?.groups?.length;
  useEffect(() => {
    const area = panelsArea.current;
    // jsdom (unit tests) has no ResizeObserver. ADR-0107: the observer of the area's own window.
    const Observer = area ? ownResizeObserver(area) : undefined;
    if (!area || !Observer) return;
    const observer = new Observer(() => setZoomPass((count) => count + 1));
    for (const content of area.querySelectorAll('[data-scroll] > *')) observer.observe(content);
    return () => observer.disconnect();
    // The panels' content elements change when a panel opens or a new answer replaces the last one.
  }, [answerOpen, transcriptOpen, shownAnswer, turnCount]);

  // A menu, and on any shell the bars themselves with no panel open, need more room than the shell's
  // fixed heights: the window grows for them. Measured by content, because a menu's own height is
  // limited by the window it is about to enlarge.
  const noPanels = !panels.transcript && !panels.answer;
  useLayoutEffect(() => {
    const height = root.current?.offsetHeight ?? 0;
    const floating = popupElement.current;
    const forPopup = floating ? popupExtentOf(floating, up, height) + 8 : 0;
    const forBars = noPanels && barsEnd.current ? extentOf(barsEnd.current, up, height) + 2 : 0;
    // ADR-0094: the model toast floats like a menu, so the window grows for it too while it shows (ADR-0095:
    // and Voice mode's tip, in the same place).
    const forToast = toastElement.current ? popupExtentOf(toastElement.current, up, height) + 8 : 0;
    // Never more than the shell accepts (17 Nov 2026: a taller ⋮ menu made it refuse, and the menu was cut).
    setNeededHeight(
      Math.min(OVERLAY_MAX_POPUP_HEIGHT, Math.max(forPopup, forBars, forToast) * zoom),
    );
  }, [popup, noPanels, zoom, zoomPass, collapsed, icon, scriptBar, up, toast, voiceTipShown]);

  // Desktop 1.5.0 (ADR-0068): the Rec popover sits under its pill.
  useLayoutEffect(() => {
    if (popup !== 'record' && popup !== 'record-notice') return;
    // Under the pill, but inside bar 1's box (the popover is 320 wide; ADR-0113: the bars may be narrower
    // than the window and off its left edge, and the popover is placed from bar 1's left edge).
    const width = barsBlock.current?.clientWidth ?? root.current?.clientWidth ?? 900;
    setRecLeft(Math.max(6, Math.min(recButton.current?.offsetLeft ?? 6, width - 326)));
  }, [popup]);

  // ADR-0107: an open menu that grows after it opens (the Model row expanded, a hint, the microphone list
  // arriving) is measured again, so the window grows with it instead of the menu scrolling.
  useEffect(() => {
    const floating = popupElement.current;
    const Observer = floating ? ownResizeObserver(floating) : undefined;
    if (popup === null || !floating || !Observer) return;
    const observer = new Observer(() => setZoomPass((count) => count + 1));
    for (const child of floating.children) observer.observe(child);
    return () => observer.disconnect();
  }, [popup]);

  // ADR-0094: the model popover sits under its chip, inside the window (ADR-0107: it is 288 wide, w-72;
  // the old 256 let it run 26 px past the right edge at 480 px).
  useLayoutEffect(() => {
    if (popup !== 'model') return;
    // ADR-0113: inside bar 1's box, as the Rec popover.
    const width = barsBlock.current?.clientWidth ?? root.current?.clientWidth ?? 900;
    setModelLeft(Math.max(6, Math.min(modelButton.current?.offsetLeft ?? 6, width - 294)));
  }, [popup]);

  // v1.3.2: with a panel open, how tall the bars and panels are, so the shell can fit the window to them.
  // Measured after every render (new lines, a streaming answer); a new value only when it changes by a
  // step.
  useLayoutEffect(() => {
    const area = panelsArea.current;
    const page = root.current;
    if (!area || !page) {
      setContentHeight((was) => (was === undefined ? was : undefined));
      return;
    }
    const height = page.offsetHeight;
    const panelElements = [...area.querySelectorAll<HTMLElement>('[data-panel]')];
    const panelExtents = stackedPanels(area, panelElements)
      ? [stackedExtentOf(panelElements, up, height)]
      : panelElements.map((panel) => naturalExtentOf(panel, up, height));
    const pieces = [...page.querySelectorAll<HTMLElement>(`[${BARS_ATTRIBUTE}]`)].map((piece) =>
      extentOf(piece, up, height),
    );
    const needed = Math.max(0, ...panelExtents, ...pieces) + 2;
    const stepped = Math.ceil((needed * zoom) / CONTENT_STEP) * CONTENT_STEP;
    // ADR-0105: while the same answer shows, the height only grows (no jumping as it streams); a new answer,
    // or a new width, zoom or text size, fits again.
    const held = holdHeight(
      answerHeld.current,
      answerHoldKey({
        answerId: panels.answer ? state?.answer?.id : null,
        transcript: panels.transcript,
        up,
        zoom,
        fontScale,
        // ADR-0113: the panels' own width (a drag of the corner grip fits the height again too).
        width: area.clientWidth,
      }),
      stepped,
    );
    answerHeld.current = held;
    const reported = held?.height ?? stepped;
    setContentHeight((was) => (was === reported ? was : reported));
    // Everything that changes what the panels hold or where they sit: each state update is new words.
  }, [
    state,
    panels,
    zoom,
    zoomPass,
    up,
    fontScale,
    collapsed,
    popup,
    icon,
    scriptBar,
    panelsWidth,
  ]);

  // ADR-0113: the share of the bars' width the answer panel's button strip needs, measured after every
  // render that can change it (the panel opening, Stop while streaming, "1 of N", a new window width or zoom:
  // zoomPass follows the panels' content changing size). A new value only when it moves by more than 0.5 %.
  const streamingAnswer = state?.answer?.status === 'streaming';
  const answerTotal = state?.total ?? 0;
  useLayoutEffect(() => {
    const panel = answerPanel.current;
    const bars = barsColumn.current;
    if (!panel || !bars) return;
    const share = Math.min(1, answerMinShare(panel, bars));
    setStripShare((was) => (Math.abs(was - share) > 0.005 ? share : was));
  }, [panels.answer, streamingAnswer, answerTotal, zoom, zoomPass, collapsed, icon, scriptBar]);

  /**
   * ADR-0113: a drag of the answer panel's corner grip sideways: the panels' own width follows it (the
   * window's does not), between the button strip and the bars' width, and is remembered when it ends.
   *
   * @param phase   'start', 'move' or 'end'.
   * @param clientX The pointer's x, in the page's client coordinates.
   */
  const widthDrag: WidthDrag = (phase, clientX) => {
    if (phase === 'start') {
      const bars = barsColumn.current?.getBoundingClientRect().width ?? 0;
      const block = panelsArea.current?.getBoundingClientRect().width ?? 0;
      const panel = answerPanel.current;
      widthDragFrom.current = {
        x: clientX,
        width: block,
        min: panel ? answerMinWidth(panel) : 0,
        max: bars,
      };
      return;
    }
    const from = widthDragFrom.current;
    if (!from) return;
    const share = widthShareAfterDrag({
      startWidth: from.width,
      dx: clientX - from.x,
      column,
      min: from.min,
      max: from.max,
    });
    if (share !== null) {
      latestWidth.current = share;
      setPanelsWidth(share);
    }
    if (phase === 'end') {
      widthDragFrom.current = null;
      // ADR-0115: null only if the bars had no width all drag long; then nothing was chosen to remember.
      if (latestWidth.current !== null) setOverlayPanelsWidth(latestWidth.current);
    }
  };

  useEffect(() => {
    onLayout.current?.({
      transcript: panels.transcript,
      answer: panels.answer,
      popupHeight: neededHeight,
      scale: zoom,
      ...(contentHeight === undefined || noPanels ? {} : { contentHeight }),
    });
  }, [panels.transcript, panels.answer, neededHeight, zoom, contentHeight, noPanels]);

  // An answer starting opens its panel, without taking focus from the meeting. 1.5.2 (ADR-0070): any new
  // answer, not only one first seen while streaming: since 1.5.1 the live page sends its state at most every
  // 200 ms, so a quick answer can arrive already finished, and its panel then stayed closed. An answer that
  // was there when this window opened (the initial value) opens nothing.
  const answerId = state?.answer?.id;
  const [seenAnswer, setSeenAnswer] = useState(answerId);
  if (answerId !== seenAnswer) {
    // While rendering, as React advises for state that follows a changed value.
    setSeenAnswer(answerId);
    if (answerId) {
      setCollapsed(false);
      setIcon(false);
    }
  }
  // The panels are the live page's state, so they change from an effect.
  const panelSeenAnswer = useRef(answerId);
  useEffect(() => {
    if (answerId === panelSeenAnswer.current) return;
    panelSeenAnswer.current = answerId;
    if (answerId && !panels.answer) onPanels({ ...panels, answer: true });
  }, [answerId, panels, onPanels]);

  // ADR-0105: a press anywhere else (the bars, the panels, the button that opened it), the window losing focus
  // (a click in another app) or Esc closes a menu; the closing press triggers nothing under it. (Until 1.7.1
  // the opener's own button toggled it, a press on the bars' drag areas never arrived, and a click in another
  // app left it open.)
  usePopupDismiss(popup !== null, popupElement, (reason) => {
    setPopup(null);
    // Esc puts the focus back where the menu was opened from.
    if (reason === 'escape') menuButton.current?.focus();
  });

  // ADR-0056: Ctrl+Alt+T turns the transcript on or off, only while the bars have focus (the shell
  // never holds it, so other apps keep it).
  const transcriptKey = useRef<() => void>(() => undefined);
  useEffect(() => {
    transcriptKey.current = () => onPanels({ ...panels, transcript: !panels.transcript });
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isTranscriptKey(event, mac)) return;
      event.preventDefault();
      transcriptKey.current();
    };
    // ADR-0107: the overlay's own document (Ctrl+Alt+T did nothing in the picture-in-picture window).
    const ownDocument = root.current?.ownerDocument ?? document;
    ownDocument.addEventListener('keydown', onKey);
    return () => ownDocument.removeEventListener('keydown', onKey);
  }, [mac]);

  // ADR-0055: clicks pass through the gaps, except while a menu or list is open (a click beside it
  // closes it), in the icon and in the script bar.
  const clickThrough = props.onClickThrough;
  // v1.3.2: Click-through mode, held by the live page (⋮ or Ctrl+Alt+X); only where clicks can pass.
  const passAll = clickThrough !== undefined && glass && (state?.clickThrough ?? false);
  useClickThrough(
    clickThrough !== undefined && glass && popup === null && !icon && !scriptBar,
    (through) => clickThrough?.(through),
    passAll,
  );

  // v1.3.2: a click on a panel's button (copy, ← →, a switch), or in Click-through mode on any of the
  // bars' buttons, gives the keyboard back to the app that had it: the overlay keeps no focus it was not
  // asked to keep. Not when the click opened a box to type in (the report box).
  const releaseFocus = props.onReleaseFocus;
  const releaseAfterBars = useRef(passAll);
  // ADR-0105: whether a menu is open, read after a click (a layout effect: set before the click's timer).
  const popupOpen = useRef(popup !== null);
  useLayoutEffect(() => {
    popupOpen.current = popup !== null;
  });
  useEffect(() => {
    releaseAfterBars.current = passAll;
  });
  useEffect(() => {
    if (!releaseFocus) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(RELEASING)) return;
      const inPanel = target.closest('[data-panel]') !== null;
      const inBars = target.closest(`[${BARS_ATTRIBUTE}]`) !== null;
      if (!inPanel && !(inBars && releaseAfterBars.current)) return;
      if (target.closest('[data-keeps-focus]')) return;
      // After React has applied the click: a box it opened has the focus by then.
      setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        // ADR-0105: not while a menu is open (the click opened it, ⋮ in Click-through mode): losing focus
        // would close it at once. It is given back when the menu closes (below).
        if (popupOpen.current) return;
        releaseFocus();
      }, 0);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [releaseFocus]);
  // Turning the mode on gives the keyboard back at once (from the menu or Ctrl+Alt+X there).
  useEffect(() => {
    if (passAll) releaseFocus?.();
  }, [passAll, releaseFocus]);
  // ADR-0105: in Click-through mode a menu closing gives the keyboard back too (the overlay kept it only for
  // the menu). After a click in another app it is already gone, and the shell does nothing.
  const hadPopup = useRef(false);
  useEffect(() => {
    if (hadPopup.current && popup === null && passAll) releaseFocus?.();
    hadPopup.current = popup !== null;
  }, [popup, passAll, releaseFocus]);

  /** Opens the full call window (from ⋮ only since v1.1.0): the live page brings it forward. */
  const openCallWindow = () => {
    setPopup(null);
    onCommand({ type: 'call-window' });
  };

  /** Clears the words on screen, in the strip and the panel. */
  const clearTranscript = () => {
    setClearedChips((state?.chips ?? []).map((chip) => chip.id));
    onCommand({ type: 'clear-transcript' });
  };

  if (scriptBar && state && !state.ended) {
    return (
      <ScriptBar
        state={state}
        glass={glass}
        panelAlpha={props.windowSettings?.panelAlpha}
        inputOpen={scriptInput}
        onInputOpen={setScriptInput}
        onCommand={onCommand}
      />
    );
  }

  const chips = (state?.chips ?? []).filter((chip) => !clearedChips.includes(chip.id));
  const piece = pieceClass(glass);
  // A solid picture-in-picture window stays dark: nothing shows through it.
  const themeClass = glass && props.resolvedTheme === 'light' ? 'k-light' : 'k-dark';
  // ADR-0033: the see-through panels' background opacity (never the text). The solid
  // picture-in-picture panels ignore it.
  const rootStyle = glass
    ? ({
        '--k-overlay-alpha': props.windowSettings?.panelAlpha ?? OVERLAY_OPACITY.default,
      } as CSSProperties)
    : undefined;

  if (icon && onMove) {
    return (
      <div className={`${themeClass} k-overlay-root k-zoom-screen text-ui-text`} style={rootStyle}>
        <IconMode
          piece={piece}
          on={state?.audio.them ?? false}
          levels={levels}
          onMove={onMove}
          onRestore={() => {
            setIcon(false);
            setCollapsed(false);
          }}
        />
      </div>
    );
  }

  const both = panels.transcript && panels.answer;
  // ADR-0105: the answer panel's default height, while an answer shows (none for the empty panel).
  const answerMin = state?.answer ? answerPanelMinHeight(fontScale) : null;

  // ADR-0118: bar 2, the transcript bar: always the live words, with the level, Clear and expand buttons.
  const statusBar = (
    <StatusBar
      state={state}
      chips={chips}
      transcriptOpen={panels.transcript}
      onTranscript={(open) => onPanels({ ...panels, transcript: open })}
      onClear={clearTranscript}
      mac={mac}
      levels={levels}
    />
  );
  // ADR-0118: the call's current message (statusLine.ts) in a slim line of its own under bar 2, only while it
  // applies; until ADR-0118 it replaced the live words on bar 2 (ADR-0082).
  const message = statusMessage(state, privateOff.visible, privateOffInCall);
  const warningLine = message ? (
    <div className={`${piece} min-w-0`} {...{ [BARS_ATTRIBUTE]: '' }}>
      <WarningLine
        message={message}
        onCommand={onCommand}
        onList={(list) => setPopup(list)}
        onPrivateOn={privateOff.turnOn}
      />
    </div>
  ) : null;
  // ADR-0082: collapsed to bar 1, a warning that needs the user (a side that cannot be heard, the Answer key
  // held by another app, a recording with Private off) still shows; ADR-0118: as the slim line alone.
  const alertWhileCollapsed = collapsed && message?.tone === 'alert';

  return (
    // @container: buttons drop their key-caps when it is narrow, and (ADR-0119: by its name "overlay") the
    // panels stack under 600 CSS px.
    <div
      ref={root}
      {...{ [GAP_ATTRIBUTE]: '' }}
      data-row={up ? 'bottom' : 'top'}
      // ADR-0105: k-popup-open turns the drag areas off while a menu is open (theme.css), so a press on the
      // bars reaches the page and closes it.
      // ADR-0113: the bars' column lines up by the position's column (columnAlignClass), not always centred.
      className={`${themeClass} k-overlay-root k-zoom-screen @container/overlay relative flex flex-col ${columnAlignClass(column)} ${up ? 'k-overlay-up' : ''} ${popup !== null ? 'k-popup-open' : ''} overflow-hidden text-[16px] text-ui-text`}
      style={rootStyle}
    >
      {onResize && !collapsed && <ResizeGrips onResize={onResize} />}

      {/* ADR-0113: the bars' column: as wide as bar 1 needs (w-fit), never wider than the window; everything
          under bar 1 fills it (UNDER_BAR). On the bottom row it is mirrored, as the whole page was before. */}
      <div
        ref={barsColumn}
        {...{ [GAP_ATTRIBUTE]: '' }}
        data-bars-column=""
        className={`flex min-h-0 w-fit max-w-full flex-1 ${up ? 'flex-col-reverse' : 'flex-col'} gap-1.5`}
      >
        {/* Bar 1's lists float from its own edges, so they stay under their buttons in a wide window. */}
        <div ref={barsBlock} {...{ [GAP_ATTRIBUTE]: '' }} className="relative shrink-0">
          {/* v1.3.2: bar 1 is one of the bars: it takes clicks even in Click-through mode. */}
          <div className={piece} {...{ [BARS_ATTRIBUTE]: '' }}>
            <ControlBar
              state={state}
              onCommand={onCommand}
              mac={mac}
              collapsed={collapsed}
              onCollapse={collapse}
              onIcon={
                onMove
                  ? () => {
                      setPopup(null);
                      setIcon(true);
                    }
                  : undefined
              }
              menuOpen={popup === 'menu' || popup === 'preferences' || popup === 'display'}
              onMenu={(open) => setPopup(open ? 'menu' : null)}
              deviceList={popup === 'audio' || popup === 'mic' ? popup : null}
              onDeviceList={setPopup}
              menuButton={menuButton}
              recordOpen={popup === 'record'}
              // ADR-0082: starts at once when consent was ticked at Connect; otherwise asks.
              onRecord={() => {
                const ask = () => setPopup(popup === 'record' ? null : 'record');
                if (state?.recording) pressRecPill(state.recording, onCommand, ask);
                else ask();
              }}
              recButton={recButton}
              up={up}
              // ADR-0094: the model chip next to Auto, where the live page says its model.
              {...(modelChoice
                ? {
                    modelOpen: popup === 'model',
                    onModel: () => setPopup(popup === 'model' ? null : 'model'),
                    modelButton,
                  }
                : {})}
              {...(clickThrough && glass
                ? {
                    // ADR-0082: the Click-through toggle on bar 1 (as Ctrl+Alt+X and ⋮ do).
                    onClickThrough: (on: boolean) => onCommand({ type: 'click-through', on }),
                  }
                : {})}
              // ADR-0095: the Voice toggle (hands-free talking to the assistant), where the live page says it.
              onVoice={(on: boolean) => onCommand({ type: 'voice-mode', on })}
            />
          </div>
          {popup === 'menu' && (
            <LiveMenu
              ref={popupElement}
              state={state}
              onCommand={onCommand}
              protection={props.protection}
              onProtection={props.onProtection}
              email={props.email}
              onDisplay={() => setPopup('display')}
              onPreferences={() => setPopup('preferences')}
              onDashboard={
                props.onDashboard
                  ? () => {
                      setPopup(null);
                      props.onDashboard?.();
                    }
                  : undefined
              }
              onHelp={
                props.onHelp
                  ? () => {
                      setPopup(null);
                      props.onHelp?.();
                    }
                  : undefined
              }
              onEditSession={
                props.onEditSession
                  ? () => {
                      setPopup(null);
                      props.onEditSession?.();
                    }
                  : undefined
              }
              onResetPosition={
                props.onPlace && !props.onPosition
                  ? () => {
                      setPopup(null);
                      props.onPlace?.('top-center');
                    }
                  : undefined
              }
              position={props.position ?? null}
              onPosition={props.onPosition}
              onCallWindow={openCallWindow}
              mac={mac}
              onModel={pickModel}
              onClose={() => setPopup(null)}
              onClickThrough={
                clickThrough && glass
                  ? (on: boolean) => {
                      setPopup(null);
                      onCommand({ type: 'click-through', on });
                    }
                  : undefined
              }
            />
          )}
          {popup === 'display' && (
            // Zoom, Theme, Opacity and Answer text size: a sheet of their own keeps the ⋮ menu one complete card.
            <DisplaySheet
              ref={popupElement}
              theme={props.theme ?? THEME_DEFAULTS.call}
              zoom={zoom}
              fontScale={fontScale}
              opacity={props.windowSettings?.opacity}
              onOpacity={props.windowSettings?.onOpacity}
              onBack={() => setPopup('menu')}
            />
          )}
          {popup === 'preferences' && state?.style && (
            <AnswerPreferencesSheet
              ref={popupElement}
              style={state.style}
              onCommand={onCommand}
              onBack={() => setPopup('menu')}
            />
          )}
          {(popup === 'record' || popup === 'record-notice') && state?.recording && (
            <RecordPopover
              ref={popupElement}
              recording={state.recording}
              mode={popup === 'record' ? 'question' : 'notice'}
              onCommand={onCommand}
              onClose={() => setPopup(null)}
              left={recLeft}
              up={up}
            />
          )}
          {popup === 'model' && modelChoice && (
            <ModelPopover
              ref={popupElement}
              model={modelChoice.model}
              smartAllowed={modelChoice.smartAllowed}
              groqAllowed={modelChoice.groqAllowed}
              geminiAllowed={modelChoice.geminiAllowed}
              openaiAllowed={modelChoice.openaiAllowed}
              moreModels={modelChoice.moreModels}
              left={modelLeft}
              onSelect={pickModel}
              onClose={() => setPopup(null)}
            />
          )}
          {toast && (
            // ADR-0094: the switch's toast, solid like the menus, centred under bar 1 (above it on the bottom
            // row: k-overlay-menu). It takes no clicks; it hides after MODEL_TOAST_MS.
            <p
              ref={toastElement}
              key={toast.id}
              role="status"
              data-toast="model"
              className="k-overlay-menu pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-40 w-max max-w-[calc(100%-12px)] -translate-x-1/2 rounded-control border border-ui-border px-3 py-2 text-[13px] font-medium text-ui-text shadow-modal"
            >
              {toast.text}
            </p>
          )}
          {voiceTipShown && (
            // ADR-0095: shown once per device, the first time Voice mode is turned on; drawn in the page like the
            // toast, so it stays inside the protected window. It hides by itself after a few seconds.
            <p
              ref={toastElement}
              role="status"
              data-toast="voice-tip"
              // ADR-0107: part of the bars for Click-through, so its "Got it" button takes the click (it went
              // to the app behind).
              {...{ [BARS_ATTRIBUTE]: '' }}
              className="k-overlay-menu absolute left-1/2 top-[calc(100%+6px)] z-40 flex w-max max-w-[calc(100%-12px)] -translate-x-1/2 items-center gap-3 rounded-control border border-ui-border px-3 py-2 text-[13px] font-medium text-ui-text shadow-modal [-webkit-app-region:no-drag]"
            >
              <span>Mute yourself in the meeting first if others can hear you.</span>
              <button
                type="button"
                className="shrink-0 rounded-control px-2 py-0.5 text-[13px] font-semibold text-ui-accent hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
                onClick={() => onCommand({ type: 'voice-tip-seen' })}
              >
                Got it
              </button>
            </p>
          )}
          {(popup === 'audio' || popup === 'mic') && (
            <DevicePicker
              ref={popupElement}
              list={popup}
              state={state}
              onCommand={onCommand}
              onClose={() => setPopup(null)}
            />
          )}
        </div>

        {/* ADR-0082: no warning bars of their own (the call notices, the Answer key held elsewhere, a screen
          recording with Private off); ADR-0118: the current one is the slim line, which still shows collapsed
          when it needs the user. */}
        {alertWhileCollapsed && !state?.ended && (
          <div className={`flex shrink-0 flex-col ${UNDER_BAR}`}>{warningLine}</div>
        )}

        {collapsed ? null : state?.ended ? (
          <p className={`${piece} shrink-0 p-3 text-ui-muted ${UNDER_BAR}`}>The call has ended.</p>
        ) : (
          <>
            {/* ADR-0118: bar 2 is always there during a call (the full transcript opens under it), with the
                warning line under it; on the bottom row mirrored (the line above bar 2, ADR-0056). */}
            <div
              ref={barsEnd}
              {...{ [GAP_ATTRIBUTE]: '' }}
              className={`flex shrink-0 ${up ? 'flex-col-reverse' : 'flex-col'} gap-1.5 ${UNDER_BAR}`}
            >
              <div className={`${piece} min-w-0`} {...{ [BARS_ATTRIBUTE]: '' }}>
                {statusBar}
              </div>
              {warningLine}
            </div>
            {(panels.transcript || panels.answer) && (
              // v1.3.2: side by side the panels are as tall as their content (items-start), so the space
              // under a shorter one is a gap; the window is fitted to the taller one (contentHeight).
              // 1.6.3 (ADR-0075): on the bottom row they sit on the bars (items-end), and stacked panels
              // are mirrored (flex-col-reverse: the transcript nearest the bars, the answer above it).
              // ADR-0113: the panels are one block with its own width (with the answer open: its share of the
              // bars' width, never under the button strip; the transcript alone fills it), lined up by the
              // position's column. The block is a container, so side by side or stacked follows its own width.
              <div
                {...{ [GAP_ATTRIBUTE]: '' }}
                className={`flex min-h-0 flex-1 flex-col ${columnAlignClass(column)} ${UNDER_BAR}`}
              >
                <div
                  {...{ [GAP_ATTRIBUTE]: '' }}
                  data-panels-block=""
                  // ADR-0119: with both panels open in a window of 600 CSS px or more, at least as wide as the
                  // window or 720 px, whichever is less (100cqw: the root, the nearest container), with no 100 %
                  // cap. So they sit side by side even where bar 1 is narrower (the 640 default: 13" Mac,
                  // 1366/1536 Windows laptops), and keep the width they had beside the bars before ADR-0118 made
                  // bar 1 narrower (715 px measured at the 768 and 960 defaults). A wider bar 1 still sets it. It
                  // overflows bar 1's column on the side the position's column allows (centred: both sides), never
                  // the window.
                  className={`@container flex min-h-0 max-w-full flex-1 flex-col ${both ? '@min-[600px]/overlay:min-w-[min(720px,100cqw)] @min-[600px]/overlay:max-w-none' : ''}`}
                  style={{
                    // ADR-0115: the user's width, else 62 % for the answer alone and the bars' width beside
                    // the transcript (panelsShare()); never under the button strip.
                    width: panels.answer
                      ? panelsWidthStyle(Math.max(panelsShare(panelsWidth, both), stripShare))
                      : panelsWidthStyle(OVERLAY_PANELS_WIDTH.max),
                  }}
                >
                  <div
                    ref={panelsArea}
                    {...{ [GAP_ATTRIBUTE]: '' }}
                    data-panels-area=""
                    className={`flex min-h-0 flex-1 gap-1.5 ${panelsLayout(both, up)}`}
                    style={{ '--k-split': `${Math.round(split * 1000) / 10}%` } as CSSProperties}
                  >
                    {panels.transcript && (
                      <div
                        data-panel=""
                        // ADR-0085: side by side its width is the split (at least 240); alone it fills the width. A
                        // container of its own, so its header's key-caps follow the panel's width, not the window's.
                        className={`${piece} @container flex max-h-full min-h-0 flex-1 flex-col overflow-hidden ${both ? '@min-[600px]/overlay:min-w-[240px] @min-[600px]/overlay:grow-0 @min-[600px]/overlay:basis-(--k-split)' : ''}`}
                      >
                        <TranscriptPanel
                          state={state}
                          onCommand={onCommand}
                          fontScale={fontScale}
                        />
                      </div>
                    )}
                    {both && (
                      <PanelSplit
                        ratio={split}
                        area={panelsArea}
                        onMove={setSplit}
                        onCommit={setOverlaySplit}
                        up={up}
                      />
                    )}
                    {panels.answer && (
                      <div
                        ref={answerPanel}
                        data-panel=""
                        data-answer-panel=""
                        // ADR-0105: with an answer shown, at least the default height (a typical answer, no
                        // scrolling), but never taller than the window allows (100 %): longer answers grow it.
                        {...(answerMin === null ? {} : { 'data-min-height': answerMin })}
                        // ADR-0107 (fixes a 1.7.1 regression): stacked under the transcript (both open, under 600 CSS
                        // px), the default height leaves the transcript 7.5 rem; it was squeezed to ~10 px.
                        style={
                          answerMin === null
                            ? undefined
                            : {
                                minHeight: `min(${answerMin}px, calc(100% - var(--k-stack-reserve, 0px)))`,
                              }
                        }
                        // ADR-0085: side by side it takes the rest, at least 340. ADR-0113: otherwise never narrower
                        // than its button strip (min-w-max: the text below the strip is size-contained).
                        className={`${piece} flex max-h-full min-h-0 min-w-max flex-1 flex-col overflow-hidden ${both ? '[--k-stack-reserve:7.5rem] @min-[600px]/overlay:min-w-[340px] @min-[600px]/overlay:[--k-stack-reserve:0px]' : ''}`}
                      >
                        <OverlayAnswer
                          state={state}
                          onCommand={onCommand}
                          onCollapse={() => onPanels({ ...panels, answer: false })}
                          mac={mac}
                          fontScale={fontScale}
                          onResize={onResize}
                          copy={copy}
                          onWidthDrag={widthDrag}
                          gripSide={gripSide(column)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
