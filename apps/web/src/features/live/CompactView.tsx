/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The overlay (the compact live view; architecture §5, ADR-0029): three stacked bars.
 *          Controls: audio status, Answer, Screenshot, Chat, move, collapse, menu (Script bar,
 *          position presets and Reset size and position, answer preferences, opacity, fade,
 *          screen-share protection), End. Transcript: the latest words as chips, Clear, expand
 *          (bubbles, newest first, with "Answer this"). Answer card: "Question:" (Claude's cleaned
 *          question once it arrives), the answer (shared with the main window: AnswerBody), and a
 *          quiet footer with the type and source tags, time, thumbs, copy and report; history,
 *          with the other answers listed newest first; Clear; expand. An expanded view shows
 *          "Back to compact" and Escape returns (v1.0.2). The script bar (v1.0.2) replaces all of
 *          it with one slim bar. Resize grips on the see-through window's edges (ADR-0035).
 *          Presentational: CompactLive.tsx gives it the state.
 * Used by: src/features/live/CompactLive.tsx (desktop overlay window; browser picture-in-picture)
 * Depends on: src/core/live/liveChannel.ts (types), @kite/shared (hotkeys), src/ui/icons.tsx,
 *             src/core/storage/overlayPrefs.ts (the opacity range)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §4 (protection);
 *               docs/design/parakeet-parity.md (structure); ADR-0029
 *
 * The controls bar is the window's drag handle (the desktop window has no frame); its buttons opt
 * out. Nothing here calls focus() on its own: updates never take the keyboard from the meeting;
 * opening Chat or clicking into a box does.
 */
'use client';

import {
  DEFAULT_GLOBAL_HOTKEYS,
  FOCUSED_HOTKEYS,
  hotkeyLabel,
  type AnswerType,
  type OverlayEdge,
  type OverlayMode,
  type OverlayPreset,
  type OverlayResizeStep,
  type ShareProtectionState,
  type TargetChoice,
} from '@kite/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { answerText, cardQuestion, splitAnswer } from '@/core/answer/format';
import { groupLines } from '@/core/transcript/group';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { TARGET_OPTIONS } from './ChatBox';
import { TranscriptBubbles } from './TranscriptBubbles';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import type { AnswerStyle } from '@/core/storage/types';
import { FORMAT_OPTIONS, LENGTH_OPTIONS, TONE_OPTIONS } from '@/features/session-setup/labels';
import { OVERLAY_OPACITY } from '@/core/storage/overlayPrefs';
import {
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  FlagIcon,
  MenuIcon,
  MicIcon,
  MoveIcon,
  SpeakerIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from '@/ui/icons';

/** The overlay's window-level settings (desktop app; a browser window cannot do these). */
export interface OverlayWindowSettings {
  /** The chosen panel-background opacity, 0.4–1 (the slider's value and label; ADR-0033). */
  opacity: number;
  /** The opacity to paint right now: the chosen value, or 1 under the pointer when fading is on. */
  panelAlpha: number;
  /** True to make the panel more see-through when the pointer is elsewhere. */
  fade: boolean;
  /** Sets the opacity. */
  onOpacity: (value: number) => void;
  /** Turns fading on or off. */
  onFade: (on: boolean) => void;
}

/** Props for CompactView. */
export interface CompactViewProps {
  /** What to show (null until the live page answers). */
  state: CompactState | null;
  /** Protection of this window (null where it does not apply, for example a browser). */
  protection: ShareProtectionState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Turns protection on or off (desktop). */
  onProtection?: (on: boolean) => void;
  /** True on macOS (for the shortcut labels). */
  mac?: boolean;
  /** Opacity and fade; undefined where the window cannot do them (a browser). */
  windowSettings?: OverlayWindowSettings;
  /**
   * Tells the window which shape the overlay has (desktop: it changes size): full, collapsed to
   * its controls bar, or the script bar with or without its input (v1.0.2, ADR-0035).
   */
  onMode?: (mode: OverlayMode) => void;
  /** Resizes the window from an edge (desktop 1.0.2+: the see-through window has no frame). */
  onResize?: (step: OverlayResizeStep) => void;
  /** Moves the window to a preset place at its default size (desktop 1.0.2+). */
  onPlace?: (preset: OverlayPreset) => void;
  /** Whether the Chat box is open. */
  chatOpen: boolean;
  /** Opens or closes the Chat box (also the Chat shortcut's job). */
  onChatOpen: (open: boolean) => void;
  /** True for the see-through panel (the desktop window); otherwise the panel is solid. */
  glass?: boolean;
  /** Puts text on the clipboard (tests pass a fake). */
  copy?: (text: string) => Promise<void>;
}

/** Small label style. */
const EYEBROW = 'text-[13px] font-medium';

/** The overlay's preset places, in the order the menu lists them (ADR-0035). */
const PRESETS: readonly { value: OverlayPreset; label: string }[] = [
  { value: 'top-center', label: 'Top centre (default)' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-center', label: 'Bottom centre' },
];

/** The resize grips: each edge and corner, with where it sits and its cursor. */
const GRIPS: readonly { edge: OverlayEdge; className: string }[] = [
  { edge: 'n', className: 'left-3 right-3 top-0 h-1.5 cursor-ns-resize' },
  { edge: 's', className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { edge: 'e', className: 'bottom-3 right-0 top-3 w-1.5 cursor-ew-resize' },
  { edge: 'w', className: 'bottom-3 left-0 top-3 w-1.5 cursor-ew-resize' },
  { edge: 'ne', className: 'right-0 top-0 h-3 w-3 cursor-nesw-resize' },
  { edge: 'nw', className: 'left-0 top-0 h-3 w-3 cursor-nwse-resize' },
  { edge: 'se', className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
];

/**
 * The see-through window's resize grips (desktop 1.0.2+). A pointer drag on an edge sends the
 * distance moved since the drag started; the shell applies it to the bounds it had then.
 *
 * @param props.onResize Sends each step to the shell.
 * @returns The grips (invisible, over the panel's edges).
 */
function ResizeGrips({
  onResize,
}: {
  /** Sends each step to the shell. */
  onResize: (step: OverlayResizeStep) => void;
}) {
  const start = useRef<{ x: number; y: number; edge: OverlayEdge } | null>(null);
  /**
   * One step of a drag.
   *
   * @param event The pointer event.
   * @param phase 'start', 'move' or 'end'.
   */
  const step = (event: PointerEvent<HTMLSpanElement>, phase: OverlayResizeStep['phase']) => {
    const from = start.current;
    if (!from) return;
    // Screen coordinates: the window moves under the pointer while it resizes.
    onResize({ phase, edge: from.edge, dx: event.screenX - from.x, dy: event.screenY - from.y });
    if (phase === 'end') start.current = null;
  };
  return (
    <>
      {GRIPS.map(({ edge, className }) => (
        <span
          key={edge}
          aria-hidden="true"
          data-grip={edge}
          className={`absolute z-20 [-webkit-app-region:no-drag] ${className}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { x: event.screenX, y: event.screenY, edge };
            step(event, 'start');
          }}
          onPointerMove={(event) => step(event, 'move')}
          onPointerUp={(event) => step(event, 'end')}
          onPointerCancel={(event) => step(event, 'end')}
        />
      ))}
    </>
  );
}

/**
 * A bar's look: part of the one panel, split by a thin line, with no shrinking below its content.
 * v1.0.3: tighter (py-1), so a typical answer fits the default size without scrolling.
 */
const BAR = 'flex shrink-0 items-center gap-1.5 border-b border-ui-border px-2 py-1';

/** A button in a bar: not part of the drag handle, always a clear focus ring. */
const BUTTON_BASE =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-control px-2 text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]';

/** A button in a bar, in the normal colours. */
const BUTTON = `${BUTTON_BASE} bg-ui-overlay-button text-ui-text hover:bg-ui-overlay-button-hover`;

/** An icon button, as wide as it is tall. */
const ICON_BUTTON = `${BUTTON} w-8 px-0 pointer-coarse:min-w-11`;

/** A quiet icon button for the answer footer; the caller adds its colour. */
const FOOTER_BUTTON = `${BUTTON_BASE} w-8 px-0 hover:bg-ui-overlay-button pointer-coarse:min-w-11`;

/**
 * A shortcut shown on a button, hidden from screen readers (the title still says it, and the button
 * keeps its plain name). v1.0.3: shown at every width the window allows (its minimum is 560 DIPs);
 * hidden only below that, for example in a browser picture-in-picture window made narrower.
 *
 * @param props.children The keys.
 * @returns The label.
 */
function Keys({
  children,
}: {
  /** The keys. */
  children: ReactNode;
}) {
  return (
    <kbd
      aria-hidden="true"
      className="hidden whitespace-nowrap rounded-full bg-ui-overlay-button px-1 text-[12px] font-normal @min-[540px]:inline"
    >
      {children}
    </kbd>
  );
}

/**
 * A shortcut in the short form the reference shows on its buttons: "Ctrl↵", "Ctrl⇧↵", "Ctrl⇧⌫"
 * (⌘↵, ⌘⇧↵, ⌘⇧⌫ on macOS).
 *
 * @param accelerator An Electron accelerator, for example 'CommandOrControl+Shift+Enter'.
 * @param mac         True on macOS.
 * @returns The short label.
 * Called from: CompactView; tests
 */
export function shortKeys(accelerator: string, mac: boolean): string {
  const glyphs: Record<string, string> = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    Shift: '⇧',
    Alt: mac ? '⌥' : 'Alt',
    Enter: '↵',
    Backspace: '⌫',
    Left: '←',
    Right: '→',
  };
  const parts = accelerator.split('+').map((part) => glyphs[part] ?? part);
  // No spaces, as the reference writes them (⌘⇧↵): they must fit the 560 px top bar.
  return parts.join('');
}

/**
 * The call's running time (v1.0.3), from when the call connected.
 *
 * @param props.startedAt When the call connected (Unix ms).
 * @returns The timer.
 */
function CallTimer({
  startedAt,
}: {
  /** When the call connected (Unix ms). */
  startedAt: number;
}) {
  // The clock is a state the interval advances (no setState in the effect body).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return (
    <span
      role="timer"
      aria-label="Call time"
      className="shrink-0 px-1 font-mono text-[13px] tabular-nums text-ui-muted"
    >
      {h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`}
    </span>
  );
}

/**
 * The level bars at the start of the live-words row (reference layout): green while the other
 * side's audio comes through, red when it does not. They show the channel's state, not a live level.
 *
 * @param props.on True while the other side's audio comes through.
 * @returns The bars.
 */
function LevelBars({
  on,
}: {
  /** True while the other side's audio comes through. */
  on: boolean;
}) {
  return (
    <span
      role="img"
      aria-label={
        on ? "The other side's audio: connected" : "The other side's audio: not connected"
      }
      className={`inline-flex h-7 w-7 shrink-0 items-end justify-center gap-[3px] pb-1.5 ${on ? 'text-ui-success' : 'text-ui-danger'}`}
    >
      {[8, 14, 10, 16].map((height, i) => (
        <span key={i} className="w-[3px] rounded-full bg-current" style={{ height }} />
      ))}
    </span>
  );
}

/**
 * One side's audio status.
 *
 * @param props.on    True when it is coming through.
 * @param props.label Which side.
 * @param props.icon  Its icon.
 * @returns The status.
 */
function AudioStatus({
  on,
  label,
  icon,
}: {
  /** True when it is coming through. */
  on: boolean;
  /** Which side. */
  label: string;
  /** Its icon. */
  icon: ReactNode;
}) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${on ? 'connected' : 'not connected'}`}
      title={`${label}: ${on ? 'connected' : 'not connected'}`}
      className={`relative inline-flex h-8 w-6 shrink-0 items-center justify-center ${on ? 'text-ui-success' : 'text-ui-danger'}`}
    >
      {icon}
    </span>
  );
}

/**
 * The menu's contents: answer preferences, opacity and fade (desktop), and what a screen share
 * can see.
 *
 * @param props.windowSettings Opacity and fade, where the window can do them.
 * @param props.protection     Protection of this window.
 * @param props.onProtection   Turns protection on or off.
 * @returns The menu.
 */
function OverlayMenu({
  style,
  onStyle,
  windowSettings,
  protection,
  onProtection,
  onScriptBar,
  onPlace,
}: {
  /** How answers are written now (absent until the live page has said). */
  style: AnswerStyle | undefined;
  /** Changes how the next answers are written. */
  onStyle: (style: AnswerStyle) => void;
  /** Opacity and fade, where the window can do them. */
  windowSettings?: OverlayWindowSettings;
  /** Protection of this window. */
  protection: ShareProtectionState | null;
  /** Turns protection on or off. */
  onProtection?: (on: boolean) => void;
  /** Switches to the script bar (desktop 1.0.2+). */
  onScriptBar?: () => void;
  /** Moves the window to a preset place at its default size (desktop 1.0.2+). */
  onPlace?: (preset: OverlayPreset) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Overlay settings"
      data-menu="overlay"
      // Kept inside the window at its smallest size: the menu scrolls rather than being cut off.
      className="k-overlay-menu absolute right-1 top-11 z-30 flex max-h-[calc(100vh-3rem)] w-64 flex-col gap-3 overflow-y-auto rounded-control border border-ui-border p-3 text-[13px] text-ui-text shadow-modal [-webkit-app-region:no-drag]"
    >
      {(onScriptBar || onPlace) && (
        <div className="flex flex-col gap-2">
          {onScriptBar && (
            <button
              type="button"
              className="rounded-control border border-ui-border px-2 py-1.5 text-left hover:bg-ui-overlay-button focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
              onClick={onScriptBar}
              title="A slim bar at the top with the answer line (Ctrl+Alt+S)"
            >
              Script bar
            </button>
          )}
          {onPlace && (
            <>
              <label className="flex items-center justify-between gap-2">
                Position
                <select
                  aria-label="Overlay position"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) onPlace(event.target.value as OverlayPreset);
                    event.target.value = '';
                  }}
                  className="w-40 border border-ui-border bg-ui-input px-2 py-1 text-[13px] text-ui-text"
                >
                  <option value="" disabled>
                    Move to…
                  </option>
                  {PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounded-control border border-ui-border px-2 py-1.5 text-left hover:bg-ui-overlay-button focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
                onClick={() => onPlace('top-center')}
              >
                Reset size and position
              </button>
            </>
          )}
        </div>
      )}
      {style && (
        <div className="flex flex-col gap-2">
          <span className={`${EYEBROW} text-ui-muted`}>Answer preferences</span>
          {(
            [
              ['format', 'Format', FORMAT_OPTIONS],
              ['length', 'Length', LENGTH_OPTIONS],
              ['tone', 'Tone', TONE_OPTIONS],
            ] as const
          ).map(([field, name, options]) => (
            <label key={field} className="flex items-center justify-between gap-2">
              {name}
              <select
                value={style[field]}
                onChange={(event) => onStyle({ ...style, [field]: event.target.value })}
                className="w-36 border border-ui-border bg-ui-input px-2 py-1 text-[13px] text-ui-text"
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {windowSettings ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={`${EYEBROW} text-ui-muted`}>
              Opacity {Math.round(windowSettings.opacity * 100)}%
            </span>
            <input
              type="range"
              aria-label="Overlay opacity"
              min={OVERLAY_OPACITY.min}
              max={OVERLAY_OPACITY.max}
              step={0.05}
              value={windowSettings.opacity}
              onChange={(event) => windowSettings.onOpacity(Number(event.target.value))}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={windowSettings.fade}
              onChange={(event) => windowSettings.onFade(event.target.checked)}
            />
            More see-through when the pointer is elsewhere
          </label>
        </>
      ) : (
        <p className="text-ui-muted">Opacity works in the desktop app.</p>
      )}
      {protection?.supported ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Hide this window from screen share"
            checked={protection.on}
            onChange={(event) => onProtection?.(event.target.checked)}
          />
          {protection.on ? 'Hidden from screen share' : 'Visible in screen share'}
        </label>
      ) : (
        <p className="text-ui-muted">Visible in screen share.</p>
      )}
    </div>
  );
}

/** Props for ScriptBar. */
interface ScriptBarProps {
  /** What the live page shows. */
  state: CompactState;
  /** True for the see-through panel (the desktop window). */
  glass: boolean;
  /** The panel's background opacity (ADR-0033), when the window can change it. */
  panelAlpha: number | undefined;
  /** Whether the one-line input is open. */
  inputOpen: boolean;
  /** Opens or closes the input (the window grows by one row for it). */
  onInputOpen: (open: boolean) => void;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
}

/**
 * The script bar (v1.0.2, item 7): a slim bar at the top centre with the answer line and its first
 * bullet, to read while looking at the camera. A microphone and a one-line input talk or type to
 * the current chat mode; Escape closes the input; clicking the words goes back to the full overlay.
 * The whole bar drags the window, like the overlay's controls bar.
 *
 * @param props See ScriptBarProps.
 * @returns The bar.
 * Rendered by: CompactView (when state.scriptBar is on)
 */
function ScriptBar({
  state,
  glass,
  panelAlpha,
  inputOpen,
  onInputOpen,
  onCommand,
}: ScriptBarProps) {
  const [text, setText] = useState('');
  const answer = state.answer;
  const parts = answer ? splitAnswer(answer.text) : null;
  const line = parts?.headline || (answer?.status === 'streaming' ? 'Answering…' : '');
  const first = parts?.bullets[0] ?? '';
  /** Back to the full overlay. */
  const full = () => {
    onCommand({ type: 'script-bar', on: false });
  };

  return (
    <div
      className={`k-dark k-overlay ${glass ? 'k-glass' : ''} flex h-screen flex-col overflow-hidden rounded-card border border-ui-border text-ui-text`}
      style={
        glass
          ? ({ '--k-overlay-alpha': panelAlpha ?? OVERLAY_OPACITY.default } as CSSProperties)
          : undefined
      }
    >
      <div
        role="toolbar"
        aria-label="Script bar"
        className="flex h-16 shrink-0 items-center gap-2 px-3 [-webkit-app-region:drag]"
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left [-webkit-app-region:no-drag] focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
          onClick={full}
          title="Back to the full overlay"
        >
          <span aria-label="Answer line" className="block truncate text-[17px] font-bold leading-6">
            {line || state.notice || 'Press Answer when they ask something.'}
          </span>
          {first && (
            <span className="block truncate text-[14px] leading-5 text-ui-muted">{first}</span>
          )}
        </button>
        {state.dictationSupported && (
          <button
            type="button"
            className={`${ICON_BUTTON} ${state.dictating ? 'text-ui-danger' : ''}`}
            aria-label={state.dictating ? 'Stop listening' : 'Speak a question'}
            aria-pressed={state.dictating ?? false}
            onClick={() => onCommand({ type: 'dictate', on: !state.dictating })}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="button"
          className={BUTTON}
          aria-pressed={inputOpen}
          onClick={() => onInputOpen(!inputOpen)}
          title="Type to Kite"
        >
          Type
        </button>
        <button
          type="button"
          className={`${BUTTON_BASE} bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover`}
          onClick={() => onCommand({ type: 'answer' })}
          disabled={state.ended || state.answering}
        >
          Answer
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Full overlay"
          title="Back to the full overlay"
          onClick={full}
        >
          <ExpandIcon />
        </button>
      </div>
      {inputOpen && (
        <form
          className="flex shrink-0 gap-1 border-t border-ui-border px-2 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const question = text.trim();
            if (!question) return;
            onCommand({ type: 'chat', question });
            setText('');
            onInputOpen(false);
          }}
        >
          <input
            autoFocus
            aria-label="Type a question"
            className="h-9 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)]"
            placeholder={`Type to Kite (${TARGET_OPTIONS.find((option) => option.value === (state.chatTarget ?? 'auto'))?.label ?? 'Auto'}), then Enter`}
            value={text}
            maxLength={2_000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setText('');
                onInputOpen(false);
              }
            }}
          />
        </form>
      )}
    </div>
  );
}

/**
 * The overlay.
 *
 * @param props See CompactViewProps.
 * @returns The view.
 * Rendered by: CompactLive.tsx
 */
export function CompactView(props: CompactViewProps) {
  const { state, onCommand, mac = false } = props;
  const [question, setQuestion] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Expanding the transcript shows its lines where the answer is; expanding the answer hides the
  // transcript bar. Either way there is one scroll area.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [answerOnly, setAnswerOnly] = useState(false);
  // Clear hides the words on screen; newer words still appear.
  const [clearedChips, setClearedChips] = useState<readonly string[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [copied, setCopied] = useState(false);
  const copy = props.copy ?? ((text: string) => navigator.clipboard.writeText(text));

  /**
   * Enter sends the typed question; Escape closes the box.
   *
   * @param event The key press in the box.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && question.trim()) {
      event.preventDefault();
      onCommand({ type: 'chat', question: question.trim() });
      setQuestion('');
      props.onChatOpen(false);
    } else if (event.key === 'Escape') {
      setQuestion('');
      props.onChatOpen(false);
    }
  };

  /**
   * Collapses the overlay to its controls bar, or opens it again.
   *
   * @param next True to collapse.
   */
  const collapse = (next: boolean) => {
    setCollapsed(next);
    setMenuOpen(false);
  };

  // The script bar (v1.0.2): the live page holds whether it is on (Ctrl+Alt+S reaches it there).
  const scriptBar = state?.scriptBar ?? false;
  const [scriptInput, setScriptInput] = useState(false);
  // The window's shape follows the view: the shell resizes it (ADR-0035).
  const mode: OverlayMode = scriptBar
    ? scriptInput
      ? 'script-input'
      : 'script'
    : collapsed
      ? 'collapsed'
      : answerOnly
        ? 'expanded'
        : 'full';
  const onMode = useRef(props.onMode);
  useEffect(() => {
    onMode.current = props.onMode;
  });
  useEffect(() => {
    onMode.current?.(mode);
  }, [mode]);

  /**
   * Expands the answer: the newest one is shown (v1.0.2), and since v1.0.3 the window itself grows
   * (mode 'expanded'), so ⛶ visibly opens the answer large.
   *
   * @param next True to expand.
   */
  const expandAnswer = (next: boolean) => {
    setAnswerOnly(next);
    if (next) {
      setTranscriptOpen(false);
      onCommand({ type: 'latest' });
    }
  };

  /** Back to the compact view from either expanded view (the button and Escape). */
  const backToCompact = () => {
    setAnswerOnly(false);
    setTranscriptOpen(false);
  };

  /** Sends the report, with what the user wrote. */
  const sendReport = () => {
    if (answer) onCommand({ type: 'report', id: answer.id, note: reportNote });
    setReporting(false);
    setReportNote('');
  };

  const answer = state?.answer ?? null;
  // A new answer starts at the top of the one scroll area, wherever the last one was scrolled to.
  const scrollArea = useRef<HTMLDivElement>(null);
  const answerId = answer?.id;
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [answerId]);
  const chips = (state?.chips ?? []).filter((chip) => !clearedChips.includes(chip.id));
  const hasHistory = (state?.total ?? 0) > 1;
  const index = state?.index ?? -1;
  const expanded = answerOnly || transcriptOpen;
  // The expanded transcript as bubbles (v1.0.2); lines from an older live page have no times and
  // then each stays its own bubble.
  const groups = useMemo(() => {
    const lines = state?.lines ?? [];
    const timed = lines.every((line) => line.tStart !== undefined && line.tEnd !== undefined);
    return groupLines(
      lines.map((line) => ({ ...line, tStart: line.tStart ?? 0, tEnd: line.tEnd ?? 0 })),
      timed ? {} : { gapMs: -1 },
    );
  }, [state?.lines]);

  if (scriptBar && state && !state.ended) {
    return (
      <ScriptBar
        state={state}
        glass={props.glass ?? false}
        panelAlpha={props.windowSettings?.panelAlpha}
        inputOpen={scriptInput}
        onInputOpen={setScriptInput}
        onCommand={onCommand}
      />
    );
  }

  return (
    // Theme §6: one rounded panel, in the dark tokens; see-through in the desktop app (k-glass).
    // @container: buttons drop their shortcut labels when it is narrow.
    <div
      className={`k-dark k-overlay ${props.glass ? 'k-glass' : ''} @container relative flex h-screen flex-col overflow-hidden rounded-card border border-ui-border text-[16px] text-ui-text`}
      // Escape goes back from an expanded view to the compact one (v1.0.2); a box that takes text
      // handles its own Escape first.
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded || event.defaultPrevented) return;
        const tag = (event.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        backToCompact();
      }}
      // ADR-0033: the glass panel's background opacity (never the text). Only the see-through panel
      // uses it; the solid picture-in-picture panel ignores it.
      style={
        props.glass
          ? ({
              '--k-overlay-alpha': props.windowSettings?.panelAlpha ?? OVERLAY_OPACITY.default,
            } as CSSProperties)
          : undefined
      }
    >
      {props.onResize && !collapsed && <ResizeGrips onResize={props.onResize} />}
      <div
        role="toolbar"
        aria-label="Overlay controls"
        // gap-1 (v1.0.3): Answer, Screenshot and Chat with their keys, the timer and End fit 560 DIPs.
        className="relative flex shrink-0 items-center gap-1 border-b border-ui-border px-2 py-1 [-webkit-app-region:drag]"
      >
        {state?.dictationSupported ? (
          // v1.0.3: the microphone at the start of the bar is a real button (it was only a status
          // icon, so pressing it did nothing): speak a question to the current chat mode; it is
          // sent when you pause. Red while listening; the box below says why it stopped.
          <button
            type="button"
            className={`${BUTTON_BASE} w-8 px-0 ${state.dictating ? 'animate-pulse bg-ui-danger-bg text-ui-danger' : 'text-ui-success hover:bg-ui-overlay-button'}`}
            aria-label={state.dictating ? 'Stop listening' : 'Speak a question'}
            aria-pressed={state.dictating ?? false}
            title={
              state.dictating
                ? 'Listening… speak your question (press to stop)'
                : (state.dictationNotice ??
                  'Speak a question: it is sent when you pause (it becomes text only)')
            }
            onClick={() => onCommand({ type: 'dictate', on: !state.dictating })}
          >
            <MicIcon />
          </button>
        ) : (
          <AudioStatus on={state?.audio.you ?? false} label="Your microphone" icon={<MicIcon />} />
        )}
        {/* Hidden below 620 px (v1.0.3): the level bars on the words row show the same, and at the
            560 px minimum the key hints, the timer and End must still fit. */}
        <span className="hidden @min-[620px]:inline-flex">
          <AudioStatus
            on={state?.audio.them ?? false}
            label="The other side's audio"
            icon={<SpeakerIcon />}
          />
        </span>
        <button
          type="button"
          className={`${BUTTON_BASE} bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover`}
          onClick={() => onCommand({ type: 'answer' })}
          disabled={!state || state.ended}
          title={`Answer the latest question (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.answer, mac)})`}
        >
          Answer <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.answer, mac)}</Keys>
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => onCommand({ type: 'screenshot' })}
          disabled={!state || state.ended || state.capturing}
          title={`Answer from a screenshot (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)})`}
        >
          {state?.capturing ? 'Screenshot…' : 'Screenshot'}{' '}
          <Keys>{shortKeys(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)}</Keys>
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-pressed={props.chatOpen}
          onClick={() => {
            if (collapsed) collapse(false);
            props.onChatOpen(!props.chatOpen);
          }}
          disabled={!state || state.ended}
          title={`Type a question (${hotkeyLabel(FOCUSED_HOTKEYS.chat, mac)})`}
        >
          Chat <Keys>{shortKeys(FOCUSED_HOTKEYS.chat, mac)}</Keys>
        </button>
        {/* The call timer (v1.0.3, reference layout). */}
        {state?.startedAt !== undefined && !state.ended && (
          <CallTimer startedAt={state.startedAt} />
        )}
        <span className="min-w-1 flex-1" />
        {/* The whole bar drags the window; this is where people look for it (hidden when narrow). */}
        <span
          role="img"
          aria-label="Drag here to move"
          title="Drag to move"
          className="hidden h-8 w-7 shrink-0 cursor-move items-center justify-center text-ui-muted @min-[700px]:inline-flex"
        >
          <MoveIcon />
        </span>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={collapsed ? 'Open the overlay' : 'Collapse the overlay'}
          aria-pressed={collapsed}
          title={collapsed ? 'Open the overlay' : 'Collapse to this bar'}
          onClick={() => collapse(!collapsed)}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Overlay menu"
          aria-expanded={menuOpen}
          disabled={collapsed}
          title="Answer preferences, opacity and screen share"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          className={`${BUTTON_BASE} bg-ui-end text-ui-on-end`}
          onClick={() => onCommand({ type: 'end' })}
          disabled={!state || state.ended}
        >
          End
        </button>
        {menuOpen && (
          <OverlayMenu
            style={state?.style}
            onStyle={(style) => onCommand({ type: 'style', style })}
            protection={props.protection}
            {...(props.windowSettings ? { windowSettings: props.windowSettings } : {})}
            {...(props.onProtection ? { onProtection: props.onProtection } : {})}
            {...(props.onPlace
              ? {
                  onPlace: (preset: OverlayPreset) => {
                    setMenuOpen(false);
                    props.onPlace?.(preset);
                  },
                  onScriptBar: () => {
                    setMenuOpen(false);
                    onCommand({ type: 'script-bar', on: true });
                  },
                }
              : {})}
          />
        )}
      </div>

      {collapsed ? null : state?.ended ? (
        <p className="p-3 text-ui-muted">The call has ended.</p>
      ) : (
        <>
          {!answerOnly && (
            // v1.0.3 (reference layout): only the level bars and the latest words. One Clear and one
            // ⛶ live on the answer row; clicking the words opens the transcript.
            <section aria-label="Live transcript bar" className={BAR}>
              <LevelBars on={state?.audio.them ?? false} />
              <button
                type="button"
                aria-label="Latest words: show the transcript"
                title="Show the transcript"
                onClick={() => {
                  setAnswerOnly(false);
                  setTranscriptOpen((open) => !open);
                }}
                className="flex h-8 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden rounded-control focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
              >
                {chips.length > 0 ? (
                  chips.map((chip) => (
                    <span
                      key={chip.id}
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[13px] leading-5 ${chip.speaker === 'you' ? 'border-ui-you text-ui-you' : 'border-ui-border text-ui-text'}`}
                    >
                      {chip.text}
                    </span>
                  ))
                ) : (
                  <span className="truncate text-[13px] text-ui-muted">
                    {state ? 'Nothing said yet.' : 'Connecting to the call…'}
                  </span>
                )}
              </button>
            </section>
          )}

          <section
            aria-label={transcriptOpen ? 'Transcript' : 'Latest answer'}
            className="flex min-h-0 flex-1 flex-col"
          >
            {transcriptOpen ? (
              <>
                <div className="flex shrink-0 items-center gap-1.5 border-b border-ui-border px-2 py-1">
                  <span className={`${EYEBROW} px-1 text-ui-muted`}>Transcript</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={backToCompact}
                    title="Back to the compact view (Esc)"
                  >
                    Back to compact
                  </button>
                </div>
                <div
                  aria-live="polite"
                  className="min-h-0 flex-1 overflow-y-auto p-3 text-[16px] leading-relaxed"
                >
                  {/* Bubbles, newest first (ADR-0030, v1.0.2): Them left, You right. "Answer this"
                    goes through the live page's guarded ask, so it never duplicates an answer. */}
                  <TranscriptBubbles
                    groups={groups}
                    size="overlay"
                    emptyText="Nothing said yet."
                    onAnswerThis={(group) =>
                      onCommand({
                        type: 'answer-this',
                        question: group.finalText.slice(0, 2_000),
                        start: group.tStart,
                        end: group.tEnd,
                      })
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-1.5 border-b border-ui-border px-2 py-1">
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label="Previous answer"
                    // After Clear (nothing shown), Previous brings back the newest answer.
                    disabled={
                      index === 0 ||
                      (state?.total ?? 0) === 0 ||
                      (hasHistory === false && index >= 0)
                    }
                    onClick={() => onCommand({ type: 'prev' })}
                    title={`Previous answer (${hotkeyLabel(FOCUSED_HOTKEYS.prev, mac)})`}
                  >
                    ← <Keys>{shortKeys(FOCUSED_HOTKEYS.prev, mac)}</Keys>
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label="Next answer"
                    // Nothing shown (after Clear): Next has nowhere to go (v1.0.2: it did nothing).
                    disabled={!hasHistory || index < 0 || index >= (state?.total ?? 0) - 1}
                    onClick={() => onCommand({ type: 'next' })}
                    title={`Next answer (${hotkeyLabel(FOCUSED_HOTKEYS.next, mac)})`}
                  >
                    → <Keys>{shortKeys(FOCUSED_HOTKEYS.next, mac)}</Keys>
                  </button>
                  {/* Only when an answer is shown: "0 of N" after Clear meant nothing (v1.0.2). */}
                  {hasHistory && index >= 0 && (
                    <span className={`${EYEBROW} text-ui-muted`}>
                      {index + 1} of {state?.total}
                    </span>
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    className={BUTTON}
                    // The one Clear (v1.0.3): the answer and the latest words on screen.
                    onClick={() => {
                      setClearedChips((state?.chips ?? []).map((chip) => chip.id));
                      onCommand({ type: 'clear' });
                    }}
                    disabled={!state}
                    title={`Clear the answer and the latest words (${hotkeyLabel(FOCUSED_HOTKEYS.clear, mac)})`}
                  >
                    Clear <Keys>{shortKeys(FOCUSED_HOTKEYS.clear, mac)}</Keys>
                  </button>
                  {answerOnly ? (
                    // A clear toggle back (v1.0.2), also Escape.
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={backToCompact}
                      title="Back to the compact view (Esc)"
                    >
                      Back to compact
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={ICON_BUTTON}
                      aria-label="Expand the answer"
                      title="Expand the answer (shows the newest)"
                      onClick={() => expandAnswer(true)}
                    >
                      <ExpandIcon />
                    </button>
                  )}
                </div>

                {(state?.dictating || state?.dictationNotice) && (
                  // The microphone's state in words (v1.0.3): listening, or why it stopped.
                  <p
                    role="status"
                    className={`shrink-0 border-b border-ui-border px-3 py-1 text-[13px] ${state.dictating ? 'text-ui-danger' : 'text-ui-warning'}`}
                  >
                    {state.dictating
                      ? 'Listening… speak your question; it is sent when you pause.'
                      : state.dictationNotice}
                  </p>
                )}
                {props.chatOpen && (
                  <div className="flex shrink-0 gap-1 border-b border-ui-border p-1.5">
                    <select
                      aria-label="Who the answer is for"
                      title="Auto decides for each question. For the call: words to say. Ask Kite: a private answer on any topic."
                      value={state?.chatTarget ?? 'auto'}
                      onChange={(event) =>
                        onCommand({
                          type: 'chat-target',
                          target: event.target.value as TargetChoice,
                        })
                      }
                      className="h-9 shrink-0 border border-ui-border bg-ui-input px-1 text-[13px] text-ui-text focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                    >
                      {TARGET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      autoFocus
                      aria-label="Type a question"
                      className="h-9 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                      placeholder="Type a question, then Enter"
                      value={question}
                      maxLength={2_000}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={onKeyDown}
                    />
                    {state?.dictationSupported && (
                      // Speak the question (ADR-0038): it becomes text only, sent on a pause.
                      <button
                        type="button"
                        className={`${ICON_BUTTON} ${state.dictating ? 'text-ui-danger' : ''}`}
                        aria-label={state.dictating ? 'Stop listening' : 'Speak a question'}
                        aria-pressed={state.dictating ?? false}
                        onClick={() => onCommand({ type: 'dictate', on: !state.dictating })}
                      >
                        <MicIcon />
                      </button>
                    )}
                  </div>
                )}

                {/* The one scroll area. */}
                <div ref={scrollArea} className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
                  {answer ? (
                    <>
                      <p aria-label="Question" className="text-[15px] leading-snug text-ui-text">
                        {/* v1.0.3: readable, in the normal text colour (it was faint grey). */}
                        <strong className="font-semibold">Question:</strong>{' '}
                        {/* Claude's cleaned question once it arrives; the raw words on hover. */}
                        <span title={answer.question || undefined}>
                          {cardQuestion(answer.question, answer.cleanQuestion)}
                        </span>
                      </p>
                      <div className="mt-1.5">
                        <AnswerBody
                          text={answer.text}
                          size="overlay"
                          answerLabel
                          headlineLabel="Answer line"
                          claims={answer.claims}
                          {...(answer.meta?.target ? { target: answer.meta.target } : {})}
                          {...(props.copy ? { copy: props.copy } : {})}
                        />
                      </div>
                      {answer.status === 'streaming' && (
                        <p className={`${EYEBROW} mt-2 text-ui-muted`}>Answering…</p>
                      )}
                      {answer.status === 'error' && (
                        <p
                          role="alert"
                          className={
                            answer.unavailable
                              ? 'mt-2 rounded-control border border-ui-warning bg-ui-warning-bg px-2 py-1 text-[15px]'
                              : 'mt-2 text-[15px] text-ui-danger'
                          }
                        >
                          {answer.error ?? 'The answer failed.'}
                        </p>
                      )}

                      {/* The quiet footer (v1.0.2): tags, how and when, then the actions. */}
                      <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-ui-muted">
                        <AnswerTags
                          compact
                          meta={answer.meta}
                          {...(state?.sessionType ? { sessionType: state.sessionType } : {})}
                          {...(answer.status !== 'streaming'
                            ? {
                                onChangeType: (answerType: AnswerType) =>
                                  onCommand({ type: 'reanswer', id: answer.id, answerType }),
                              }
                            : {})}
                        />
                        {answer.meta && <span aria-hidden="true">·</span>}
                        <span className="mr-1">
                          {answer.auto
                            ? 'Auto'
                            : answer.mode === 'answer'
                              ? 'Answer'
                              : answer.mode === 'chat'
                                ? 'Typed'
                                : 'Screenshot'}{' '}
                          ·{' '}
                          {new Date(answer.askedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <button
                          type="button"
                          className={`${FOOTER_BUTTON} ${answer.rating === 'up' ? 'text-ui-success' : 'text-ui-muted'}`}
                          aria-label="Good answer"
                          aria-pressed={answer.rating === 'up'}
                          onClick={() =>
                            onCommand({
                              type: 'rate',
                              id: answer.id,
                              rating: answer.rating === 'up' ? null : 'up',
                            })
                          }
                        >
                          <ThumbUpIcon />
                        </button>
                        <button
                          type="button"
                          className={`${FOOTER_BUTTON} ${answer.rating === 'down' ? 'text-ui-danger' : 'text-ui-muted'}`}
                          aria-label="Bad answer"
                          aria-pressed={answer.rating === 'down'}
                          onClick={() =>
                            onCommand({
                              type: 'rate',
                              id: answer.id,
                              rating: answer.rating === 'down' ? null : 'down',
                            })
                          }
                        >
                          <ThumbDownIcon />
                        </button>
                        <button
                          type="button"
                          className={`${FOOTER_BUTTON} text-ui-muted`}
                          aria-label={copied ? 'Copied' : 'Copy the answer'}
                          onClick={() => {
                            // A private answer is read as written; for the call, Copy leaves out
                            // the private note.
                            const text =
                              answer.meta?.target === 'kite'
                                ? answer.text
                                : answerText(answer.text);
                            void copy(text).then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1_500);
                            });
                          }}
                        >
                          <CopyIcon />
                        </button>
                        <button
                          type="button"
                          className={`${FOOTER_BUTTON} ${answer.reported ? 'text-ui-warning' : 'text-ui-muted'}`}
                          aria-label={answer.reported ? 'Reported' : 'Report this answer'}
                          aria-pressed={reporting}
                          disabled={answer.reported}
                          onClick={() => setReporting((open) => !open)}
                        >
                          <FlagIcon />
                        </button>
                      </div>
                      {reporting && !answer.reported && (
                        <div className="mt-1 flex gap-1.5">
                          <input
                            autoFocus
                            aria-label="What was wrong?"
                            className="h-8 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-[15px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                            placeholder="What was wrong? (optional)"
                            value={reportNote}
                            maxLength={2_000}
                            onChange={(event) => setReportNote(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') sendReport();
                              if (event.key === 'Escape') setReporting(false);
                            }}
                          />
                          <button type="button" className={BUTTON} onClick={sendReport}>
                            Report
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-ui-muted">
                      {state?.notice ?? 'Press Answer when they ask something.'}
                    </p>
                  )}
                  {(state?.earlier ?? []).length > 0 && (
                    <div className="mt-3 border-t border-ui-border pt-2">
                      <p className={`${EYEBROW} text-ui-muted`}>Other answers, newest first</p>
                      <ul aria-label="Other answers" className="mt-1">
                        {(state?.earlier ?? []).map((other) => (
                          <li key={other.id}>
                            <button
                              type="button"
                              className="w-full truncate py-0.5 text-left text-[15px] text-ui-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                              onClick={() => onCommand({ type: 'show', id: other.id })}
                            >
                              {other.question || other.headline}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
