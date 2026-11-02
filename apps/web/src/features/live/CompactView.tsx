/**
 * File: apps/web/src/features/live/CompactView.tsx
 * Purpose: The overlay (the compact live view; architecture §5, ADR-0029): three stacked bars.
 *          Controls: audio status, Answer, Screenshot, Chat, move, collapse, menu (opacity, fade,
 *          screen-share protection), End. Transcript: the latest words as chips, Clear, expand.
 *          Answer card: question, answer line, bullets, closing tip, private note; time, thumbs,
 *          copy and report; history; Clear; expand. One scroll area, readable 16–18 px text.
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
  type ShareProtectionState,
} from '@kite/shared';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
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
  /** The opacity, 0.4–1. */
  opacity: number;
  /** True to fade when the pointer is elsewhere. */
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
  /** Tells the window the overlay collapsed or opened (desktop: it changes size). */
  onCollapsed?: (collapsed: boolean) => void;
  /** Whether the Chat box is open. */
  chatOpen: boolean;
  /** Opens or closes the Chat box (also the Chat shortcut's job). */
  onChatOpen: (open: boolean) => void;
  /** Puts text on the clipboard (tests pass a fake). */
  copy?: (text: string) => Promise<void>;
}

/** Small mono uppercase label style (the "eyebrow" style). */
const EYEBROW = 'font-mono text-[10px] font-medium uppercase tracking-[0.08em]';

/** A bar's look: the dark surface, a thin border, and no shrinking below its content. */
const BAR = 'flex shrink-0 items-center gap-1.5 border border-ui-border bg-ui-surface px-1.5 py-1';

/** A button in a bar: not part of the drag handle, always a clear focus ring. */
const BUTTON_BASE =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 border px-2 text-[13px] font-semibold hover:bg-ui-band disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]';

/** A button in a bar, in the normal colours. */
const BUTTON = `${BUTTON_BASE} border-ui-border text-ui-text`;

/** A square icon button. */
const ICON_BUTTON = `${BUTTON} w-8 px-0 pointer-coarse:min-w-11`;

/** A square button with no border, for the answer footer; the caller adds its colour. */
const FOOTER_BUTTON = `${BUTTON_BASE} w-8 border-transparent px-0 pointer-coarse:min-w-11`;

/**
 * A shortcut shown on a button; hidden when the overlay is narrow and from screen readers (the
 * title still says it, and the button keeps its plain name).
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
      className="hidden font-mono text-[10px] font-normal opacity-75 @min-[640px]:inline"
    >
      {children}
    </kbd>
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
      className={`relative inline-flex h-8 w-7 shrink-0 items-center justify-center ${on ? 'text-ui-success' : 'text-ui-danger'}`}
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
}) {
  return (
    <div
      role="group"
      aria-label="Overlay settings"
      data-menu="overlay"
      // Kept inside the window at its smallest size: the menu scrolls rather than being cut off.
      className="absolute right-1 top-11 z-10 flex max-h-[calc(100vh-3rem)] w-64 flex-col gap-3 overflow-y-auto border border-ui-border bg-ui-surface p-3 text-[13px] [-webkit-app-region:no-drag]"
    >
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
                className="w-36 border border-ui-border bg-ui-input px-1 py-0.5 text-[14px] text-ui-text"
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
            Fade when the pointer is elsewhere
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
    props.onCollapsed?.(next);
  };

  /** Sends the report, with what the user wrote. */
  const sendReport = () => {
    if (answer) onCommand({ type: 'report', id: answer.id, note: reportNote });
    setReporting(false);
    setReportNote('');
  };

  const answer = state?.answer ?? null;
  const chips = (state?.chips ?? []).filter((chip) => !clearedChips.includes(chip.id));
  const hasHistory = (state?.total ?? 0) > 1;

  return (
    // Theme §6: the dark tokens. @container: buttons drop their shortcut labels when it is narrow.
    <div className="k-dark @container flex h-screen flex-col gap-1 bg-ui-bg p-1 text-[16px] text-ui-text">
      <div
        role="toolbar"
        aria-label="Overlay controls"
        className={`${BAR} relative [-webkit-app-region:drag]`}
      >
        <AudioStatus on={state?.audio.you ?? false} label="Your microphone" icon={<MicIcon />} />
        <AudioStatus
          on={state?.audio.them ?? false}
          label="The other side's audio"
          icon={<SpeakerIcon />}
        />
        <button
          type="button"
          className={`${BUTTON_BASE} border-ui-primary bg-ui-primary text-ui-on-primary hover:bg-ui-primary`}
          onClick={() => onCommand({ type: 'answer' })}
          disabled={!state || state.ended}
          title={`Answer the latest question (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.answer, mac)})`}
        >
          Answer <Keys>{hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.answer, mac)}</Keys>
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => onCommand({ type: 'screenshot' })}
          disabled={!state || state.ended || state.capturing}
          title={`Answer from a screenshot (${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)})`}
        >
          {state?.capturing ? 'Screenshot…' : 'Screenshot'}{' '}
          <Keys>{hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS.screenshot, mac)}</Keys>
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
          Chat <Keys>{hotkeyLabel(FOCUSED_HOTKEYS.chat, mac)}</Keys>
        </button>
        <span className="min-w-1 flex-1" />
        {/* The whole bar drags the window; this is where people look for it (hidden when narrow). */}
        <span
          role="img"
          aria-label="Drag here to move"
          title="Drag to move"
          className="hidden h-8 w-7 shrink-0 cursor-move items-center justify-center text-ui-muted @min-[520px]:inline-flex"
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
          className={`${BUTTON_BASE} border-ui-danger text-ui-danger`}
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
          />
        )}
      </div>

      {collapsed ? null : state?.ended ? (
        <p className="p-3 text-ui-muted">The call has ended.</p>
      ) : (
        <>
          {!answerOnly && (
            <section aria-label="Live transcript bar" className={BAR}>
              <div
                aria-label="Latest words"
                className="flex h-8 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden"
              >
                {chips.length > 0 ? (
                  chips.map((chip) => (
                    <span
                      key={chip.id}
                      className={`shrink-0 border px-2 py-0.5 text-[13px] leading-5 ${chip.speaker === 'you' ? 'border-ui-you text-ui-you' : 'border-ui-border text-ui-text'}`}
                    >
                      {chip.text}
                    </span>
                  ))
                ) : (
                  <span className="truncate text-[13px] text-ui-muted">
                    {state ? 'Nothing said yet.' : 'Connecting to the call…'}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={BUTTON}
                onClick={() => setClearedChips((state?.chips ?? []).map((chip) => chip.id))}
                title="Clear these words from view (the transcript is kept)"
              >
                Clear
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label={transcriptOpen ? 'Show the answer' : 'Expand the transcript'}
                aria-pressed={transcriptOpen}
                title={transcriptOpen ? 'Show the answer' : 'Expand the transcript'}
                onClick={() => setTranscriptOpen((open) => !open)}
              >
                <ExpandIcon />
              </button>
            </section>
          )}

          <section
            aria-label={transcriptOpen ? 'Transcript' : 'Latest answer'}
            className="flex min-h-0 flex-1 flex-col border border-ui-border border-l-[3px] border-l-ui-accent bg-ui-surface"
          >
            {transcriptOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[16px] leading-relaxed">
                {(state?.lines ?? []).length === 0 && (
                  <p className="text-ui-muted">Nothing said yet.</p>
                )}
                {(state?.lines ?? []).map((line) => (
                  <p key={line.id} className="mb-1.5">
                    <span
                      className={`${EYEBROW} mr-2 ${line.speaker === 'you' ? 'text-ui-you' : 'text-ui-them'}`}
                    >
                      {line.speaker === 'you' ? 'You' : 'Them'}
                    </span>
                    <span className={line.final ? '' : 'italic text-ui-provisional'}>
                      {line.text}
                    </span>
                  </p>
                ))}
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-1.5 border-b border-ui-border px-1.5 py-1">
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label="Previous answer"
                    disabled={!hasHistory || (state?.index ?? 0) <= 0}
                    onClick={() => onCommand({ type: 'prev' })}
                    title={`Previous answer (${hotkeyLabel(FOCUSED_HOTKEYS.prev, mac)})`}
                  >
                    ← <Keys>{hotkeyLabel(FOCUSED_HOTKEYS.prev, mac)}</Keys>
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label="Next answer"
                    disabled={!hasHistory || (state?.index ?? 0) >= (state?.total ?? 0) - 1}
                    onClick={() => onCommand({ type: 'next' })}
                    title={`Next answer (${hotkeyLabel(FOCUSED_HOTKEYS.next, mac)})`}
                  >
                    → <Keys>{hotkeyLabel(FOCUSED_HOTKEYS.next, mac)}</Keys>
                  </button>
                  {hasHistory && (
                    <span className={`${EYEBROW} text-ui-muted`}>
                      {(state?.index ?? 0) + 1} of {state?.total}
                    </span>
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() => onCommand({ type: 'clear' })}
                    disabled={!state}
                    title={`Clear the answer (${hotkeyLabel(FOCUSED_HOTKEYS.clear, mac)})`}
                  >
                    Clear <Keys>{hotkeyLabel(FOCUSED_HOTKEYS.clear, mac)}</Keys>
                  </button>
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={answerOnly ? 'Show the transcript bar' : 'Expand the answer'}
                    aria-pressed={answerOnly}
                    title={answerOnly ? 'Show the transcript bar' : 'Expand the answer'}
                    onClick={() => setAnswerOnly((only) => !only)}
                  >
                    <ExpandIcon />
                  </button>
                </div>

                {props.chatOpen && (
                  <div className="shrink-0 border-b border-ui-border p-1.5">
                    <input
                      autoFocus
                      aria-label="Type a question"
                      className="h-9 w-full border border-ui-border bg-ui-input px-2 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
                      placeholder="Type a question, then Enter"
                      value={question}
                      maxLength={2_000}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                )}

                {/* The one scroll area. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                  {answer ? (
                    <>
                      <p aria-label="Question" className="text-[15px] text-ui-muted">
                        <strong className="font-semibold text-ui-text">Question:</strong>{' '}
                        {answer.question || 'the latest from Them'}
                      </p>
                      <h2
                        aria-label="Answer line"
                        className="mt-2 text-[18px] font-bold leading-snug text-ui-heading"
                      >
                        {answer.headline || '…'}
                      </h2>
                      {answer.bullets.length > 0 && (
                        <ul
                          aria-label="Answer details"
                          className="mt-2 list-disc space-y-1 pl-5 text-[16px] leading-relaxed"
                        >
                          {answer.bullets.map((bullet, i) => (
                            <li key={i}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                      {answer.tip && (
                        <p aria-label="Tip" className="mt-2 text-[16px] leading-relaxed">
                          {answer.tip}
                        </p>
                      )}
                      {answer.note && (
                        <p
                          aria-label="Private note"
                          className="mt-2 border-t border-ui-border pt-1.5 text-[13px] italic text-ui-muted"
                        >
                          <span className={`${EYEBROW} mr-1 not-italic`}>Just for you</span>
                          {answer.note}
                        </p>
                      )}
                      {answer.status === 'streaming' && (
                        <p className={`${EYEBROW} mt-2 text-ui-muted`}>Answering…</p>
                      )}
                      {answer.status === 'error' && (
                        <p
                          role="alert"
                          className={
                            answer.unavailable
                              ? 'mt-2 border-l-[3px] border-ui-warning bg-ui-warning-bg px-2 py-1 text-[14px]'
                              : 'mt-2 text-[14px] text-ui-danger'
                          }
                        >
                          {answer.error ?? 'The answer failed.'}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-1 text-[13px] text-ui-muted">
                        <span className="mr-1">
                          {answer.auto ? 'Auto' : answer.mode === 'answer' ? 'Answer' : answer.mode}{' '}
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
                            const text = [
                              answer.headline,
                              ...answer.bullets.map((bullet) => `- ${bullet}`),
                              ...(answer.tip ? [answer.tip] : []),
                            ].join('\n');
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
                            className="h-8 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-[14px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
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
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
