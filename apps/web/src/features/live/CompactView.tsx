/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The overlay (the compact live view; spec S13–S16, ADR-0029, ADR-0041): separate pieces rather
 *          than one window-sized panel. Bar 1 (status, Answer, Screenshot, Chat, move, compact, timer, ⋮
 *          and Exit), the chat bar under it while open, then bar 2 with the live strip and the Auto answer
 *          pill, or the transcript panel in bar 2's place. The answer panel opens by itself when an
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
 * here calls focus() on its own: updates never take the keyboard from the meeting; opening Chat or
 * clicking into a box does.
 *
 * ADR-0055: the empty space around and between the pieces is marked data-gap; in desktop 1.3.0 clicks
 * there pass through to the app behind the overlay (overlay/useClickThrough.ts).
 *
 * An older desktop shell (1.1.0) has a fixed height for "no panels open" and cannot make an icon. So the
 * page tells every shell how tall its bars are (OverlayLayout.popupHeight, which any shell from 1.1.0
 * honours), and compact collapses to bar 1 where there is no icon.
 */
'use client';

import type {
  OverlayLayout,
  OverlayMode,
  OverlayPreset,
  OverlayResizeStep,
  ShareProtectionState,
} from '@kite/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import {
  THEME_DEFAULTS,
  type ResolvedTheme,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
import { OVERLAY_OPACITY, type OverlayPanels } from '@/core/storage/overlayPrefs';
import { AnswerPreferencesSheet } from './overlay/AnswerPreferencesSheet';
import { ChatBar, type ChatBarHandle } from './overlay/ChatBar';
import { ControlBar, type DeviceList } from './overlay/ControlBar';
import { DevicePicker } from './overlay/DevicePicker';
import { IconMode } from './overlay/IconMode';
import { LiveMenu } from './overlay/LiveMenu';
import { LiveStrip } from './overlay/LiveStrip';
import { OverlayAnswer } from './overlay/OverlayAnswer';
import { AutoAnswerPill, pieceClass, type LevelStore } from './overlay/parts';
import { ResizeGrips } from './overlay/ResizeGrips';
import { ScriptBar } from './overlay/ScriptBar';
import { TranscriptPanel } from './overlay/TranscriptPanel';
import { GAP_ATTRIBUTE, useClickThrough } from './overlay/useClickThrough';

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
  /** Moves the window by a distance; given only where the shell can make the icon (1.2.0). */
  onMove?: ((dx: number, dy: number) => void) | undefined;
  /** Opens the dashboard, where this app has a separate window for it (desktop 1.1.0+, a browser). */
  onDashboard?: () => void;
  /** Opens the user guide, likewise. */
  onHelp?: () => void;
  /** Opens Edit session, likewise. */
  onEditSession?: () => void;
  /** Whether the chat bar is open. */
  chatOpen: boolean;
  /** Opens or closes the chat bar (also the Chat shortcut's job). */
  onChatOpen: (open: boolean) => void;
  /** The chat bar's handle, for its shortcut. */
  chatBar?: RefObject<ChatBarHandle | null>;
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
   * The reference app's bars and chat bar (ADR-0055: accounts with account sync): the Transcript pill,
   * 900-wide bars and the reference chat bar. Otherwise the classic look, unchanged.
   */
  referenceLook?: boolean;
}

/** Which floating list or menu is open. */
type Popup = DeviceList | 'menu' | 'preferences' | 'language';

/**
 * The bars keep their own width; only the panels fill a window wider than this (spec S13): 780, or 900
 * in the reference look (ADR-0055: bar 1 also holds the Transcript pill, and every key-cap shows).
 */
const BARS_WIDTHS = {
  classic: 'mx-auto w-full max-w-[780px]',
  reference: 'mx-auto w-full max-w-[900px]',
} as const;

/**
 * How far an element's bottom is below the top of the overlay, whatever it sits inside.
 *
 * @param element The element.
 * @returns The distance, in the page's own pixels (before the UI scale).
 * Called from: CompactView
 */
function bottomOf(element: HTMLElement): number {
  let top = 0;
  for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null) {
    top += at.offsetTop;
  }
  return top + element.scrollHeight;
}

/**
 * The overlay.
 *
 * @param props See CompactViewProps.
 * @returns The view.
 * Rendered by: CompactLive.tsx
 */
export function CompactView(props: CompactViewProps) {
  const { state, onCommand, mac = false, panels, onPanels, onMove } = props;
  const { levels, onResize, copy, chatBar } = props;
  const glass = props.glass ?? false;
  const referenceLook = props.referenceLook ?? false;
  const BARS_WIDTH = BARS_WIDTHS[referenceLook ? 'reference' : 'classic'];
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
  const popupElement = useRef<HTMLDivElement>(null);
  const languagesElement = useRef<HTMLUListElement>(null);
  const barsEnd = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  /**
   * Collapses the overlay to bar 1, or opens it again.
   *
   * @param next True to collapse.
   */
  const collapse = (next: boolean) => {
    setCollapsed(next);
    setPopup(null);
  };

  // The Chat shortcut brings the overlay back from the icon (while rendering, as React advises for
  // state that follows a changed value).
  if (icon && props.chatOpen) {
    setIcon(false);
    setCollapsed(false);
  }

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

  // A menu, and on any shell the bars themselves with no panel open, need more room than the shell's
  // fixed heights: the window grows for them. Measured by content, because a menu's own height is
  // limited by the window it is about to enlarge.
  const noPanels = !panels.transcript && !panels.answer;
  const chatOpen = props.chatOpen;
  useLayoutEffect(() => {
    const floating = popupElement.current ?? languagesElement.current;
    const forPopup = floating ? bottomOf(floating) + 8 : 0;
    const forBars = noPanels && barsEnd.current ? bottomOf(barsEnd.current) + 2 : 0;
    setNeededHeight(Math.max(forPopup, forBars) * zoom);
  }, [popup, noPanels, chatOpen, zoom, collapsed, icon, scriptBar]);

  useEffect(() => {
    onLayout.current?.({
      transcript: panels.transcript,
      answer: panels.answer,
      popupHeight: neededHeight,
      scale: zoom,
    });
  }, [panels.transcript, panels.answer, neededHeight, zoom]);

  // An answer starting opens its panel, without taking focus from the meeting.
  const answerId = state?.answer?.id;
  const answerStreaming = state?.answer?.status === 'streaming';
  const [seenAnswer, setSeenAnswer] = useState(answerId);
  if (answerId !== seenAnswer) {
    // While rendering, as React advises for state that follows a changed value.
    setSeenAnswer(answerId);
    if (answerStreaming) {
      setCollapsed(false);
      setIcon(false);
    }
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
    if (!popup) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (popupElement.current?.contains(target) || languagesElement.current?.contains(target)) {
        return;
      }
      // The button that opened it toggles it; another one switches to its own.
      if (target.closest?.('[data-popup-button]')) return;
      setPopup(null);
    };
    // Escape closes it too, and focus goes back to where it was opened from.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPopup(null);
      menuButton.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [popup]);

  // ADR-0055: clicks pass through the gaps, except while a menu or list is open (a click beside it
  // closes it), in the icon and in the script bar.
  const clickThrough = props.onClickThrough;
  useClickThrough(
    clickThrough !== undefined && glass && popup === null && !icon && !scriptBar,
    (through) => clickThrough?.(through),
  );

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
      <div className={`${themeClass} k-overlay-root h-screen text-ui-text`} style={rootStyle}>
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
  /**
   * Opens or closes the language list.
   *
   * @param open True to open it.
   * @returns Nothing.
   */
  const languagesOpen = (open: boolean) => setPopup(open ? 'language' : null);

  return (
    // @container: buttons drop their key-caps when it is narrow, and the panels stack.
    <div
      {...{ [GAP_ATTRIBUTE]: '' }}
      className={`${themeClass} k-overlay-root @container relative flex h-screen flex-col gap-1.5 overflow-hidden text-[16px] text-ui-text`}
      style={rootStyle}
    >
      {onResize && !collapsed && <ResizeGrips onResize={onResize} />}

      {/* Bar 1's lists float from its own edges, so they stay under their buttons in a wide window. */}
      <div {...{ [GAP_ATTRIBUTE]: '' }} className={`relative shrink-0 ${BARS_WIDTH}`}>
        <div className={piece}>
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
                    props.onChatOpen(false);
                    setIcon(true);
                  }
                : undefined
            }
            menuOpen={popup === 'menu' || popup === 'preferences'}
            onMenu={(open) => setPopup(open ? 'menu' : null)}
            deviceList={popup === 'audio' || popup === 'mic' ? popup : null}
            onDeviceList={setPopup}
            chatOpen={props.chatOpen}
            onChatOpen={props.onChatOpen}
            menuButton={menuButton}
            referenceLook={referenceLook}
            {...(referenceLook
              ? {
                  transcriptOpen: panels.transcript,
                  onTranscript: (open: boolean) => onPanels({ ...panels, transcript: open }),
                }
              : {})}
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
            theme={props.theme ?? THEME_DEFAULTS.call}
            zoom={zoom}
            fontScale={fontScale}
            opacity={props.windowSettings?.opacity}
            onOpacity={props.windowSettings?.onOpacity}
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
              props.onPlace
                ? () => {
                    setPopup(null);
                    props.onPlace?.('top-center');
                  }
                : undefined
            }
            onCallWindow={openCallWindow}
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

      {props.chatOpen && !collapsed && (
        <div className={`${piece} shrink-0 ${BARS_WIDTH}`}>
          <ChatBar
            ref={chatBar}
            state={state}
            onCommand={onCommand}
            onClose={() => props.onChatOpen(false)}
            mac={mac}
            look={referenceLook ? 'reference' : 'classic'}
          />
        </div>
      )}

      {collapsed ? null : state?.ended ? (
        <p className={`${piece} shrink-0 p-3 text-ui-muted ${BARS_WIDTH}`}>The call has ended.</p>
      ) : (
        <>
          {!panels.transcript && (
            <div
              ref={barsEnd}
              {...{ [GAP_ATTRIBUTE]: '' }}
              className={`flex shrink-0 items-start gap-1.5 ${BARS_WIDTH}`}
            >
              <div className={`${piece} min-w-0 max-w-[540px] flex-1`}>
                <LiveStrip
                  state={state}
                  chips={chips}
                  question={question}
                  onCommand={onCommand}
                  onClear={clearTranscript}
                  onExpand={() => onPanels({ ...panels, transcript: true })}
                  onCollapse={() => collapse(true)}
                  mac={mac}
                  levels={levels}
                  languagesOpen={popup === 'language'}
                  onLanguagesOpen={languagesOpen}
                  languagesRef={languagesElement}
                />
              </div>
              <div className={`${piece} shrink-0 p-1`}>
                <AutoAnswerPill state={state} onCommand={onCommand} />
              </div>
            </div>
          )}
          {(panels.transcript || panels.answer) && (
            <div
              {...{ [GAP_ATTRIBUTE]: '' }}
              className={`flex min-h-0 flex-1 gap-1.5 ${both ? 'flex-col @min-[900px]:flex-row' : ''}`}
            >
              {panels.transcript && (
                <div
                  className={`${piece} flex min-h-0 flex-1 flex-col overflow-hidden ${both ? '@min-[900px]:max-w-[38%]' : 'max-w-[540px]'}`}
                >
                  <TranscriptPanel
                    state={state}
                    onCommand={onCommand}
                    onClear={clearTranscript}
                    onCollapse={() => onPanels({ ...panels, transcript: false })}
                    mac={mac}
                    levels={levels}
                    fontScale={fontScale}
                    languagesOpen={popup === 'language'}
                    onLanguagesOpen={languagesOpen}
                    languagesRef={languagesElement}
                  />
                </div>
              )}
              {panels.transcript && !panels.answer && (
                <div className={`${piece} shrink-0 self-start p-1`}>
                  <AutoAnswerPill state={state} onCommand={onCommand} />
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
                    showAutoAnswer={both}
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
