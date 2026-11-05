/**
 * File: apps/web/src/features/live/overlay/OverlayAnswer.tsx
 * Purpose: The answer panel (spec S15): ← and → between this call's questions, Stop while an answer
 *          streams, Auto answer, Clear and collapse; then the question as a title with an accent bar,
 *          "Thinking…" until the first word, the answer (AnswerBody, shared with the call window), and a
 *          footer: copy, thumbs and report on the left; type, how and when on the right. A grip at the
 *          bottom right resizes the window.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys, AnswerType), src/core/answer/format.ts,
 *             src/core/live/liveChannel.ts, src/features/answers (AnswerBody, AnswerTags),
 *             src/ui/icons.tsx, ./parts.tsx, ./ResizeGrips.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S15); ADR-0037, ADR-0040, ADR-0041
 *
 * Clear never empties the card while answers exist (item 15): it stops a stream and goes back to the
 * newest answer. Question and answer text is only rendered, and copied when the user asks.
 */
'use client';

import {
  FOCUSED_HOTKEYS,
  hotkeyLabel,
  type AnswerType,
  type OverlayResizeStep,
} from '@kite/shared';
import { useEffect, useRef, useState } from 'react';
import { answerText, cardQuestion } from '@/core/answer/format';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import { AnswerBody } from '@/features/answers/AnswerBody';
import { AnswerTags } from '@/features/answers/AnswerTags';
import { CollapseIcon, CopyIcon, FlagIcon, StopIcon, ThumbDownIcon, ThumbUpIcon } from '@/ui/icons';
import { AutoAnswerPill, BUTTON, FOOTER_BUTTON, ICON_BUTTON, KeyChip, PILL } from './parts';
import { ResizeCorner } from './ResizeGrips';

/** Props for OverlayAnswer. */
export interface OverlayAnswerProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Closes the panel. */
  onCollapse: () => void;
  /** True on macOS (for the shortcuts' spoken names). */
  mac: boolean;
  /** The text size chosen in the menu. */
  fontScale: number;
  /** True to show Auto answer here: the panel is beside the transcript, so bar 2 has gone. */
  showAutoAnswer?: boolean;
  /** Resizes the window, where the shell can (the see-through window has no frame). */
  onResize?: ((step: OverlayResizeStep) => void) | undefined;
  /** Puts text on the clipboard (tests pass a fake). */
  copy?: ((text: string) => Promise<void>) | undefined;
}

/**
 * The panel.
 *
 * @param props See OverlayAnswerProps.
 * @returns The panel's contents.
 * Rendered by: CompactView.tsx
 */
export function OverlayAnswer(props: OverlayAnswerProps) {
  const { state, onCommand, mac } = props;
  const answer = state?.answer ?? null;
  const total = state?.total ?? 0;
  const index = state?.index ?? -1;
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [copied, setCopied] = useState(false);
  const copy = props.copy ?? ((text: string) => navigator.clipboard.writeText(text));

  // A new answer starts at the top of the one scroll area, wherever the last one was scrolled to.
  const scrollArea = useRef<HTMLDivElement>(null);
  const answerId = answer?.id;
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [answerId]);

  /** Sends the report, with what the user wrote. */
  const sendReport = () => {
    if (answer) onCommand({ type: 'report', id: answer.id, note: reportNote });
    setReporting(false);
    setReportNote('');
  };

  const streaming = answer?.status === 'streaming';
  return (
    <section aria-label="Latest answer" className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]">
        <button
          type="button"
          className={PILL}
          aria-label="Previous question"
          disabled={index <= 0}
          onClick={() => onCommand({ type: 'prev' })}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS.prev, mac)}
        >
          <KeyChip hotkey="prev" />
        </button>
        <button
          type="button"
          className={PILL}
          aria-label="Next question"
          disabled={index < 0 || index >= total - 1}
          onClick={() => onCommand({ type: 'next' })}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS.next, mac)}
        >
          <KeyChip hotkey="next" />
        </button>
        {total > 1 && index >= 0 && (
          <span className="text-[13px] font-medium text-ui-muted">
            {index + 1} of {total}
          </span>
        )}
        <span className="flex-1" />
        {streaming && (
          <button type="button" className={BUTTON} onClick={() => onCommand({ type: 'stop' })}>
            <StopIcon /> Stop
          </button>
        )}
        {props.showAutoAnswer && <AutoAnswerPill state={state} onCommand={onCommand} />}
        <button
          type="button"
          className={PILL}
          onClick={() => onCommand({ type: 'clear' })}
          disabled={!state}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS.clear, mac)}
        >
          Clear <KeyChip hotkey="clear" visibleAt="@min-[620px]:inline-flex" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Close the answer"
          onClick={props.onCollapse}
        >
          <CollapseIcon />
        </button>
      </div>

      <div className="min-h-0 flex-1 px-1.5 pb-1.5">
        <div
          ref={scrollArea}
          className="h-full overflow-y-auto rounded-control bg-ui-overlay-button px-3 py-2.5"
          style={{ zoom: props.fontScale }}
        >
          {answer ? (
            <>
              {/* Claude's cleaned question once it arrives; the raw words until then. */}
              <p
                aria-label="Question"
                className="border-l-2 border-ui-accent-fill pl-2.5 text-[15px] font-semibold leading-snug text-ui-heading"
              >
                {cardQuestion(answer.question, answer.cleanQuestion)}
              </p>
              {streaming && answer.text.trim() === '' ? (
                <p role="status" className="mt-2 text-[15px] text-ui-muted">
                  Thinking…
                </p>
              ) : (
                <div className="mt-2">
                  <AnswerBody
                    text={answer.text}
                    finished={answer.status !== 'streaming'}
                    size="overlay"
                    headlineLabel="Answer line"
                    hideEmptyHeadline={answer.status === 'cancelled' || answer.status === 'error'}
                    claims={answer.claims}
                    {...(answer.meta?.target ? { target: answer.meta.target } : {})}
                    {...(props.copy ? { copy: props.copy } : {})}
                  />
                </div>
              )}
              {answer.status === 'cancelled' && !answer.text.trim() && (
                <p className="mt-1 text-[15px] text-ui-muted">
                  Stopped before any words arrived. Press Answer to ask again.
                </p>
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

              {/* The footer: the actions on the left; type, how and when on the right. */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1 text-[12px] text-ui-muted">
                {answer.text.trim() !== '' && (
                  <button
                    type="button"
                    className={`${FOOTER_BUTTON} text-ui-muted`}
                    aria-label={copied ? 'Copied' : 'Copy the answer'}
                    onClick={() => {
                      // A private answer is read as written; for the call, Copy leaves out the note.
                      const text =
                        answer.meta?.target === 'kite' ? answer.text : answerText(answer.text);
                      void copy(text).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1_500);
                      });
                    }}
                  >
                    <CopyIcon />
                  </button>
                )}
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
                  className={`${FOOTER_BUTTON} ${answer.reported ? 'text-ui-warning' : 'text-ui-muted'}`}
                  aria-label={answer.reported ? 'Reported' : 'Report this answer'}
                  aria-pressed={reporting}
                  disabled={answer.reported}
                  onClick={() => setReporting((open) => !open)}
                >
                  <FlagIcon />
                </button>
                <span className="min-w-2 flex-1" />
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
                <span>
                  {answer.auto
                    ? 'Auto'
                    : answer.mode === 'answer'
                      ? 'Answer'
                      : answer.mode === 'chat'
                        ? 'Chat'
                        : 'Screenshot'}{' '}
                  ·{' '}
                  {new Date(answer.askedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {reporting && !answer.reported && (
                <div className="mt-1 flex gap-1.5">
                  <input
                    autoFocus
                    aria-label="What was wrong?"
                    className="h-8 min-w-0 flex-1 rounded-control border border-ui-border bg-ui-input px-2 text-[15px] text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
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
      </div>
      {props.onResize && <ResizeCorner onResize={props.onResize} />}
    </section>
  );
}
