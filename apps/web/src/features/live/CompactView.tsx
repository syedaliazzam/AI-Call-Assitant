/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The overlay (the compact live view; architecture §5, ADR-0029): since v1.1.0 (ADR-0041)
 *          stacked pieces rather than one window-sized panel. Bar 1 (status, Answer, Screenshot, Chat,
 *          move, collapse, ⋮, timer and End). Bar 2 (level bars, latest words, Clear, ⤢), or in its
 *          place the transcript panel. Below them the answer panel, which opens by itself when an answer
 *          starts. The panels open together or alone, each see-through with the opacity setting, and
 *          are remembered. The script bar (v1.0.2) replaces all of it with one slim bar. Presentational:
 *          CompactLive.tsx gives it the state.
 * Used by: src/features/live/CompactLive.tsx (desktop overlay window; browser picture-in-picture)
 * Depends on: src/core/live/liveChannel.ts (types), @kite/shared, src/core/storage (overlayPrefs,
 *             appearancePrefs), src/features/live/overlay/*
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §4 (protection);
 *               docs/design/parakeet-parity.md (structure); ADR-0029, ADR-0041
 *
 * Bar 1 is the window's drag handle (the desktop window has no frame); its buttons opt out. Nothing
 * here calls focus() on its own: updates never take the keyboard from the meeting; opening Chat or
 * clicking into a box does.
 */
'use client';

import type {
  OverlayLayout,
  OverlayMode,
  OverlayPreset,
  OverlayResizeStep,
  ShareProtectionState,
} from '@kite/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import type { ResolvedTheme, ThemeChoice } from '@/core/storage/appearancePrefs';
import { OVERLAY_OPACITY, type OverlayPanels } from '@/core/storage/overlayPrefs';
import { ControlBar } from './overlay/ControlBar';
import { DevicePicker } from './overlay/DevicePicker';
import { LiveMenu } from './overlay/LiveMenu';
import { LiveStrip } from './overlay/LiveStrip';
import { OverlayAnswer } from './overlay/OverlayAnswer';
import { pieceClass, type LevelStore } from './overlay/parts';
import { ResizeGrips } from './overlay/ResizeGrips';
import { ScriptBar } from './overlay/ScriptBar';
import { TranscriptPanel } from './overlay/TranscriptPanel';

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
  /** True on macOS (for the shortcut labels). */
  mac?: boolean;
  /** Opacity; undefined where the window cannot do it (a browser). */
  windowSettings?: OverlayWindowSettings;
  /**
   * Tells the window which shape the overlay has (desktop: it changes size): full, collapsed to its
   * controls bar, or the script bar with or without its input (v1.0.2, ADR-0035).
   */
  onMode?: (mode: OverlayMode) => void;
  /** Tells the window which panels are open, so it fits them (desktop 1.1.0+, ADR-0041). */
  onLayout?: (layout: OverlayLayout) => void;
  /** Resizes the window from an edge (desktop 1.0.2+: the see-through window has no frame). */
  onResize?: (step: OverlayResizeStep) => void;
  /** Moves the window to a preset place at its default size (desktop 1.0.2+). */
  onPlace?: (preset: OverlayPreset) => void;
  /** Opens the dashboard, where this app has a separate window for it (desktop 1.1.0+, a browser). */
  onDashboard?: () => void;
  /** Opens Edit session, likewise. */
  onEditSession?: () => void;
  /** Whether Chat's input is open. */
  chatOpen: boolean;
  /** Opens or closes Chat's input (also the Chat shortcut's job). */
  onChatOpen: (open: boolean) => void;
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
}

/**
 * The overlay.
 *
 * @param props See CompactViewProps.
 * @returns The view.
 * Rendered by: CompactLive.tsx
 */
export function CompactView(props: CompactViewProps) {
  const { state, onCommand, mac = false, panels, onPanels } = props;
  const glass = props.glass ?? false;
  const zoom = props.zoom ?? 1;
  const fontScale = props.fontScale ?? 1;
  const [menuOpen, setMenuOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Clear hides the words on screen at once; the live page keeps them out from then on.
  const [clearedChips, setClearedChips] = useState<readonly string[]>([]);
  const [questionCleared, setQuestionCleared] = useState<string | null>(null);
  const [scriptInput, setScriptInput] = useState(false);
  const [popupHeight, setPopupHeight] = useState(0);
  const popup = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  /**
   * Collapses the overlay to bar 1, or opens it again.
   *
   * @param next True to collapse.
   */
  const collapse = (next: boolean) => {
    setCollapsed(next);
    setMenuOpen(false);
    setDevicesOpen(false);
  };

  // The script bar (v1.0.2): the live page holds whether it is on (Ctrl+Alt+S reaches it there).
  const scriptBar = state?.scriptBar ?? false;
  // The window's shape follows the view: the shell resizes it (ADR-0035).
  const mode: OverlayMode = scriptBar
    ? scriptInput
      ? 'script-input'
      : 'script'
    : collapsed
      ? 'collapsed'
      : 'full';
  const onMode = useRef(props.onMode);
  const onLayout = useRef(props.onLayout);
  useEffect(() => {
    onMode.current = props.onMode;
    onLayout.current = props.onLayout;
  });
  useEffect(() => {
    onMode.current?.(mode);
  }, [mode]);

  // A menu needs more room than the bars have: the window grows for as long as it is open. Measured
  // by its content, because its own height is limited by the window it is about to enlarge.
  const anyPopup = menuOpen || devicesOpen;
  useLayoutEffect(() => {
    const element = popup.current;
    setPopupHeight(anyPopup && element ? (element.offsetTop + element.scrollHeight + 8) * zoom : 0);
  }, [anyPopup, zoom, menuOpen, devicesOpen]);

  useEffect(() => {
    onLayout.current?.({
      transcript: panels.transcript,
      answer: panels.answer,
      popupHeight,
      scale: zoom,
    });
  }, [panels.transcript, panels.answer, popupHeight, zoom]);

  // An answer starting opens its panel, without taking focus from the meeting.
  const answerId = state?.answer?.id;
  const answerStreaming = state?.answer?.status === 'streaming';
  const [seenAnswer, setSeenAnswer] = useState(answerId);
  if (answerId !== seenAnswer) {
    // While rendering, as React advises for state that follows a changed value.
    setSeenAnswer(answerId);
    if (answerStreaming) setCollapsed(false);
  }
  // The panels are the live page's state, so they change from an effect.
  const panelSeenAnswer = useRef(answerId);
  useEffect(() => {
    if (answerId === panelSeenAnswer.current) return;
    panelSeenAnswer.current = answerId;
    if (answerStreaming && !panels.answer) onPanels({ ...panels, answer: true });
  }, [answerId, answerStreaming, panels, onPanels]);

  // A press anywhere else closes a menu.
  useEffect(() => {
    if (!anyPopup) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popup.current?.contains(target) || menuButton.current?.contains(target)) return;
      if ((target as Element).closest?.('[aria-label="Choose microphone and audio source"]'))
        return;
      setMenuOpen(false);
      setDevicesOpen(false);
    };
    // Escape closes it too, and focus goes back to where it was opened from.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setDevicesOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [anyPopup]);

  /** Opens the full call window (from ⋮ only since v1.1.0): the live page brings it forward. */
  const openCallWindow = () => {
    setMenuOpen(false);
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

  return (
    // @container: buttons drop their shortcut labels when it is narrow.
    <div
      ref={root}
      className={`${themeClass} k-overlay-root @container relative flex h-screen flex-col gap-1.5 overflow-hidden text-[16px] text-ui-text`}
      // ADR-0033: the see-through panels' background opacity (never the text). The solid
      // picture-in-picture panels ignore it.
      style={
        glass
          ? ({
              '--k-overlay-alpha': props.windowSettings?.panelAlpha ?? OVERLAY_OPACITY.default,
            } as CSSProperties)
          : undefined
      }
    >
      {props.onResize && !collapsed && <ResizeGrips onResize={props.onResize} />}

      <div className={`${piece} shrink-0`}>
        <ControlBar
          state={state}
          onCommand={onCommand}
          mac={mac}
          collapsed={collapsed}
          onCollapse={collapse}
          menuOpen={menuOpen}
          onMenu={(open) => {
            setDevicesOpen(false);
            setMenuOpen(open);
          }}
          devicesOpen={devicesOpen}
          onDevices={(open) => {
            setMenuOpen(false);
            setDevicesOpen(open);
          }}
          chatOpen={props.chatOpen}
          onChatOpen={props.onChatOpen}
          menuButton={menuButton}
        />
      </div>

      {menuOpen && (
        <LiveMenu
          ref={popup}
          state={state}
          onCommand={onCommand}
          protection={props.protection}
          onProtection={props.onProtection}
          theme={props.theme ?? 'system'}
          zoom={zoom}
          fontScale={fontScale}
          opacity={props.windowSettings?.opacity}
          onOpacity={props.windowSettings?.onOpacity}
          onDashboard={
            props.onDashboard
              ? () => {
                  setMenuOpen(false);
                  props.onDashboard?.();
                }
              : undefined
          }
          onEditSession={
            props.onEditSession
              ? () => {
                  setMenuOpen(false);
                  props.onEditSession?.();
                }
              : undefined
          }
          onResetPosition={
            props.onPlace
              ? () => {
                  setMenuOpen(false);
                  props.onPlace?.('top-center');
                }
              : undefined
          }
          onCallWindow={openCallWindow}
        />
      )}
      {devicesOpen && (
        <DevicePicker
          ref={popup}
          state={state}
          onCommand={onCommand}
          onClose={() => setDevicesOpen(false)}
        />
      )}

      {collapsed ? null : state?.ended ? (
        <p className={`${piece} shrink-0 p-3 text-ui-muted`}>The call has ended.</p>
      ) : (
        <>
          {panels.transcript ? (
            <div className={`${piece} flex min-h-0 flex-1 flex-col overflow-hidden`}>
              <TranscriptPanel
                state={state}
                onCommand={onCommand}
                onClear={clearTranscript}
                onCollapse={() => onPanels({ ...panels, transcript: false })}
                mac={mac}
                levels={props.levels}
                fontScale={fontScale}
              />
            </div>
          ) : (
            <div className={`${piece} shrink-0`}>
              <LiveStrip
                state={state}
                chips={chips}
                question={question}
                onCommand={onCommand}
                onClear={clearTranscript}
                onExpand={() => onPanels({ ...panels, transcript: true })}
                mac={mac}
                levels={props.levels}
              />
            </div>
          )}
          {panels.answer && (
            <div className={`${piece} flex min-h-0 flex-1 flex-col overflow-hidden`}>
              <OverlayAnswer
                state={state}
                onCommand={onCommand}
                onCollapse={() => onPanels({ ...panels, answer: false })}
                mac={mac}
                fontScale={fontScale}
                copy={props.copy}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
