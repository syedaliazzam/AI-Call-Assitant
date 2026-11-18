/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The overlay (the compact live view; spec S13–S16, ADR-0029, ADR-0041): separate pieces rather
 *          than one window-sized panel. Bar 1 (status, the Transcript, Rec, Auto answer and Click-through
 *          toggles, move, compact, timer, ⋮ and Exit; ADR-0082: no Answer, Screenshot or Chat buttons and
 *          no chat bar, the shortcuts do those), then bar 2, the one status bar (ADR-0082: the warnings and
 *          the live words share it; StatusBar.tsx), or the transcript panel in bar 2's place, whose header
 *          is the same status bar. The answer panel opens by itself when an
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
 * alone fills the width. The Transcript switch on bar 1 is there for every account and never gives way.
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
  getOverlaySplit,
  OVERLAY_OPACITY,
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
import { pieceClass, type LevelStore } from './overlay/parts';
import { ResizeGrips } from './overlay/ResizeGrips';
import { ScriptBar } from './overlay/ScriptBar';
import { StatusBar } from './overlay/StatusBar';
import { statusMessage } from './overlay/statusLine';
import { TranscriptPanel } from './overlay/TranscriptPanel';
import { BARS_ATTRIBUTE, GAP_ATTRIBUTE, useClickThrough } from './overlay/useClickThrough';
import { usePopupDismiss } from './overlay/usePopupDismiss';

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
 * The bars keep their own width; only the panels fill a window wider than this (spec S13): 980, the
 * reference look (ADR-0055: bar 1 also holds the Transcript pill; desktop 1.5.0, ADR-0068: and the
 * Rec pill, so a 1.5.0 overlay opens 980 wide and every key-cap shows; in a 900-wide window of an older
 * shell, which has no Rec pill, the bar fills the window as before).
 */
const BARS_WIDTH = 'mx-auto w-full max-w-[980px]';

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
 * How the panels' area lays out its panels (1.6.3, ADR-0075). Top row: they hang from the bars, side by
 * side from 600 CSS px (ADR-0085; 900 before) or stacked below that (the transcript first). Bottom row: mirrored, so they sit on
 * the bars: side by side along the bottom, or stacked upward with the transcript nearest the bars.
 *
 * @param both True when both panels are open.
 * @param up   True on the bottom row (ADR-0056).
 * @returns The area's flex classes.
 * Called from: CompactView
 */
export function panelsLayout(both: boolean, up: boolean): string {
  if (!both) return up ? 'items-end' : 'items-start';
  return up
    ? 'flex-col-reverse @min-[600px]:flex-row @min-[600px]:items-end'
    : 'flex-col @min-[600px]:flex-row @min-[600px]:items-start';
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
  const [questionCleared, setQuestionCleared] = useState<string | null>(null);
  const [scriptInput, setScriptInput] = useState(false);
  const [neededHeight, setNeededHeight] = useState(0);
  // ADR-0085: the transcript's share of the width side by side (the divider; remembered per device).
  const [split, setSplit] = useState(getOverlaySplit);
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
    // jsdom (unit tests) has no ResizeObserver.
    if (!area || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setZoomPass((count) => count + 1));
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
    const forPopup = floating ? extentOf(floating, up, height) + 8 : 0;
    const forBars = noPanels && barsEnd.current ? extentOf(barsEnd.current, up, height) + 2 : 0;
    // ADR-0094: the model toast floats like a menu, so the window grows for it too while it shows (ADR-0095:
    // and Voice mode's tip, in the same place).
    const forToast = toastElement.current ? extentOf(toastElement.current, up, height) + 8 : 0;
    // Never more than the shell accepts (17 Nov 2026: a taller ⋮ menu made it refuse, and the menu was cut).
    setNeededHeight(
      Math.min(OVERLAY_MAX_POPUP_HEIGHT, Math.max(forPopup, forBars, forToast) * zoom),
    );
  }, [popup, noPanels, zoom, zoomPass, collapsed, icon, scriptBar, up, toast, voiceTipShown]);

  // Desktop 1.5.0 (ADR-0068): the Rec popover sits under its pill.
  useLayoutEffect(() => {
    if (popup !== 'record' && popup !== 'record-notice') return;
    // Under the pill, but inside the window (the popover is 320 wide).
    const width = root.current?.clientWidth ?? 900;
    setRecLeft(Math.max(6, Math.min(recButton.current?.offsetLeft ?? 6, width - 326)));
  }, [popup]);

  // ADR-0094: the model popover sits under its chip, inside the window (it is 256 wide).
  useLayoutEffect(() => {
    if (popup !== 'model') return;
    const width = root.current?.clientWidth ?? 900;
    setModelLeft(Math.max(6, Math.min(modelButton.current?.offsetLeft ?? 6, width - 262)));
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
    const panelExtents = [...area.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) =>
      naturalExtentOf(panel, up, height),
    );
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
        width: page.clientWidth,
      }),
      stepped,
    );
    answerHeld.current = held;
    const reported = held?.height ?? stepped;
    setContentHeight((was) => (was === reported ? was : reported));
    // Everything that changes what the panels hold or where they sit: each state update is new words.
  }, [state, panels, zoom, zoomPass, up, fontScale, collapsed, popup, icon, scriptBar]);

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
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
    setQuestionCleared(state?.liveQuestion ?? null);
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
  const question =
    state?.liveQuestion && state.liveQuestion !== questionCleared ? state.liveQuestion : null;
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

  // ADR-0082: the one status bar (bar 2): the live words, or the current warning with its button.
  const statusBar = (
    <StatusBar
      state={state}
      chips={chips}
      question={question}
      words
      transcriptOpen={false}
      onTranscript={(open) => {
        if (collapsed) collapse(false);
        onPanels({ ...panels, transcript: open });
      }}
      onCommand={onCommand}
      onClear={clearTranscript}
      onCollapse={() => collapse(true)}
      collapseLabel="Hide the status bar"
      onList={(list) => setPopup(list)}
      privateOff={privateOff.visible}
      onPrivateOn={privateOff.turnOn}
      privateOffInCall={privateOffInCall}
      mac={mac}
      levels={levels}
    />
  );
  // ADR-0082: collapsed to bar 1, a warning that needs the user (a side that cannot be heard, the Answer key
  // held by another app, a recording with Private off) still shows the status bar.
  const alertWhileCollapsed =
    collapsed && statusMessage(state, privateOff.visible)?.tone === 'alert';

  return (
    // @container: buttons drop their key-caps when it is narrow, and the panels stack.
    <div
      ref={root}
      {...{ [GAP_ATTRIBUTE]: '' }}
      data-row={up ? 'bottom' : 'top'}
      // ADR-0105: k-popup-open turns the drag areas off while a menu is open (theme.css), so a press on the
      // bars reaches the page and closes it.
      className={`${themeClass} k-overlay-root k-zoom-screen @container relative flex ${up ? 'k-overlay-up flex-col-reverse' : 'flex-col'} ${popup !== null ? 'k-popup-open' : ''} gap-1.5 overflow-hidden text-[16px] text-ui-text`}
      style={rootStyle}
    >
      {onResize && !collapsed && <ResizeGrips onResize={onResize} />}

      {/* Bar 1's lists float from its own edges, so they stay under their buttons in a wide window. */}
      <div {...{ [GAP_ATTRIBUTE]: '' }} className={`relative shrink-0 ${BARS_WIDTH}`}>
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
            // ADR-0085: the Transcript switch for every account (it was only with account sync).
            transcriptOpen={panels.transcript}
            onTranscript={(open: boolean) => onPanels({ ...panels, transcript: open })}
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

      {/* ADR-0082: no warning bars of their own any more (the call notices, the Answer key held elsewhere, a
          screen recording with Private off): the status bar's line shows the current one with its button. */}
      {alertWhileCollapsed && !state?.ended && (
        <div className={`${piece} shrink-0 ${BARS_WIDTH}`} {...{ [BARS_ATTRIBUTE]: '' }}>
          {statusBar}
        </div>
      )}

      {collapsed ? null : state?.ended ? (
        <p className={`${piece} shrink-0 p-3 text-ui-muted ${BARS_WIDTH}`}>The call has ended.</p>
      ) : (
        <>
          {!panels.transcript && (
            // 1.6.3 (ADR-0075): bar 2 alone; Auto answer is on bar 1.
            <div
              ref={barsEnd}
              {...{ [GAP_ATTRIBUTE]: '' }}
              className={`flex shrink-0 gap-1.5 ${up ? 'items-end' : 'items-start'} ${BARS_WIDTH}`}
            >
              <div className={`${piece} min-w-0 flex-1`} {...{ [BARS_ATTRIBUTE]: '' }}>
                {statusBar}
              </div>
            </div>
          )}
          {(panels.transcript || panels.answer) && (
            // v1.3.2: side by side the panels are as tall as their content (items-start), so the space
            // under a shorter one is a gap; the window is fitted to the taller one (contentHeight).
            // 1.6.3 (ADR-0075): on the bottom row they sit on the bars (items-end), and stacked panels
            // are mirrored (flex-col-reverse: the transcript nearest the bars, the answer above it).
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
                  className={`${piece} @container flex max-h-full min-h-0 flex-1 flex-col overflow-hidden ${both ? '@min-[600px]:min-w-[240px] @min-[600px]:grow-0 @min-[600px]:basis-(--k-split)' : ''}`}
                >
                  <TranscriptPanel
                    state={state}
                    onCommand={onCommand}
                    onClear={clearTranscript}
                    onCollapse={() => onPanels({ ...panels, transcript: false })}
                    mac={mac}
                    levels={levels}
                    fontScale={fontScale}
                    onList={(list) => setPopup(list)}
                    privateOff={privateOff.visible}
                    onPrivateOn={privateOff.turnOn}
                    privateOffInCall={privateOffInCall}
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
                  data-panel=""
                  // ADR-0105: with an answer shown, at least the default height (a typical answer, no
                  // scrolling), but never taller than the window allows (100 %): longer answers grow it.
                  {...(answerMin === null ? {} : { 'data-min-height': answerMin })}
                  style={
                    answerMin === null ? undefined : { minHeight: `min(${answerMin}px, 100%)` }
                  }
                  // ADR-0085: side by side it takes the rest, at least 340.
                  className={`${piece} flex max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${both ? '@min-[600px]:min-w-[340px]' : ''}`}
                >
                  <OverlayAnswer
                    state={state}
                    onCommand={onCommand}
                    onCollapse={() => onPanels({ ...panels, answer: false })}
                    mac={mac}
                    fontScale={fontScale}
                    onResize={onResize}
                    copy={copy}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
