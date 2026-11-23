/**
 * File: apps/web/src/features/live/overlay/OverlayAnswer.tsx
 * Purpose: The answer panel (spec S15): ← and → between this call's questions, Stop while an answer
 *          streams, Clear and collapse (1.6.3, ADR-0075: Auto answer is on bar 1); then the question as a title with an accent bar,
 *          "Thinking…" until the first word, the answer (AnswerBody, shared with the call window), and a
 *          footer: copy, thumbs and report on the left; type, how and when on the right. A grip at the
 *          bottom right resizes the window.
 *          ADR-0113: the top strip keeps the same buttons and labels at every width (Clear always shows its
 *          key), and the panel is never narrower than that strip (the answer text below it does not set the
 *          panel's smallest width: it wraps). The corner grip changes the panels' own width sideways and the
 *          window's height up and down; on a right position it sits in the bottom left.
 *          ADR-0115: the question starts with a small, muted "Question:" label (Parakeet's convention).
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys, AnswerType), src/core/answer/format.ts,
 *             src/core/live/liveChannel.ts, src/features/answers (AnswerBody, AnswerTags),
 *             src/ui/icons.tsx, ./parts.tsx, ./ResizeGrips.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S15); ADR-0037, ADR-0040, ADR-0041,
 *               ADR-0115
 *
 * ADR-0082: Clear (and Ctrl+Backspace) clears the answers: they leave the screen until the next one (until
 * 1.6.3 it only stopped a stream and went back to the newest answer). The ← and → buttons show only the
 * arrows; their screen-reader descriptions name the keys (ADR-0107: no visible tooltip, as no `title`
 * tooltips are used: the system draws them outside the protected window). Question and answer text is only rendered, and copied when the user
 * asks.
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
import { BUTTON, FOOTER_BUTTON, ICON_BUTTON, KeyChip, PILL, tipShortcut } from './parts';
import { ResizeCorner, type WidthDrag } from './ResizeGrips';

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
  /** Resizes the window, where the shell can (the see-through window has no frame). */
  onResize?: ((step: OverlayResizeStep) => void) | undefined;
  /** Puts text on the clipboard (tests pass a fake). */
  copy?: ((text: string) => Promise<void>) | undefined;
  /** ADR-0113: changes the panels' own width with the corner grip's sideways drag. */
  onWidthDrag?: WidthDrag | undefined;
  /** ADR-0113: the bottom corner the grip sits in ('left' on a right position). */
  gripSide?: 'left' | 'right' | undefined;
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
  // ADR-0107: the answer the Report box is open on (null: closed). Open only while that answer shows, so
  // it never carries over to another answer (sending it then reported the wrong one).
  const [reportingId, setReportingId] = useState<string | null>(null);
  const reporting = answer !== null && answer !== undefined && reportingId === answer.id;
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
    setReportingId(null);
    setReportNote('');
  };

  const streaming = answer?.status === 'streaming';
  // v1.3.2: room beside the footer for the corner grip; ADR-0113: on its side (left on a right position).
  const gripRoom = props.onResize ? (props.gripSide === 'left' ? 'pl-7' : 'pr-7') : '';
  return (
    <section aria-label="Latest answer" className="relative flex min-h-0 flex-auto flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]">
        <button
          type="button"
          className={PILL}
          aria-label="Previous question"
          disabled={index <= 0}
          onClick={() => onCommand({ type: 'prev' })}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS.prev, mac)}
          // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
          // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
          {...{ 'aria-description': `Previous answer (${tipShortcut(FOCUSED_HOTKEYS.prev, mac)})` }}
        >
          {/* ADR-0082: the arrow only (no Ctrl on the chip). */}
          <span aria-hidden="true" className="px-0.5 text-[15px] leading-none">
            ←
          </span>
        </button>
        <button
          type="button"
          className={PILL}
          aria-label="Next question"
          disabled={index < 0 || index >= total - 1}
          onClick={() => onCommand({ type: 'next' })}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS.next, mac)}
          // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
          // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
          {...{ 'aria-description': `Next answer (${tipShortcut(FOCUSED_HOTKEYS.next, mac)})` }}
        >
          <span aria-hidden="true" className="px-0.5 text-[15px] leading-none">
            →
          </span>
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
        <button
          type="button"
          className={PILL}
          onClick={() => onCommand({ type: 'clear' })}
          disabled={!state}
          aria-label="Clear answers"
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS.clear, mac)}
          // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
          // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
          {...{ 'aria-description': `Clear answers (${tipShortcut(FOCUSED_HOTKEYS.clear, mac)})` }}
        >
          {/* ADR-0113: the key always shows: the strip never changes with the panel's width. */}
          Clear <KeyChip hotkey="clear" />
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

      {/* v1.3.2: as tall as the answer, up to the panel's height; then it scrolls (data-scroll: the overlay
          measures how tall it would be, to fit the window to it). */}
      <div className="flex min-h-0 flex-auto flex-col px-1.5 pb-1.5">
        <div
          ref={scrollArea}
          data-scroll=""
          // ADR-0085: room for the scrollbar is always kept, so the words wrap the same with or without it.
          // Otherwise a scrollbar that appeared once (a smaller zoom) narrowed the text, which then wrapped
          // onto one more line and kept the panel scrolling at its old height.
          // ADR-0107: a long word or link breaks onto the next line (it ran past the panel and the whole
          // answer scrolled sideways); code blocks keep their own sideways scroll.
          // ADR-0113: inline-size containment, so the text (a code block's long line) never sets the panel's
          // smallest width: the strip above does (CompactView gives the panel min-width: min-content).
          className="min-h-0 flex-auto overflow-y-auto rounded-control bg-ui-overlay-button px-3 py-2.5 [contain:inline-size] [overflow-wrap:anywhere] [scrollbar-gutter:stable]"
          style={{ zoom: props.fontScale }}
        >
          {answer ? (
            <>
              {/* Claude's cleaned question once it arrives; the raw words until then. ADR-0115: a muted
                  "Question:" label before it (Parakeet's word), inside the accent bar: smaller, lighter and
                  grey, so the question stays the title. The label is hidden from screen readers (the
                  paragraph is already named "Question") and left out of a text selection (select-none). */}
              <p
                aria-label="Question"
                className="border-l-2 border-ui-accent-fill pl-2.5 text-[15px] font-semibold leading-snug text-ui-heading"
              >
                <span
                  aria-hidden="true"
                  data-question-label=""
                  className="mr-1.5 select-none text-[13px] font-medium text-ui-muted"
                >
                  Question:
                </span>
                {cardQuestion(answer.question, answer.cleanQuestion)}
              </p>
              {/* Batch C (P1-4): the press answered before their last words arrived. */}
              {answer.incomplete && (
                <p className="mt-1 text-[13px] text-ui-muted">
                  The question may be incomplete: their last words were still coming in.
                </p>
              )}
              {/* Batch D (P1-G): their audio was lost around this question; the answer still came. */}
              {answer.audioLost && (
                <p className="mt-1 text-[13px] text-ui-muted">Part of their audio was lost.</p>
              )}
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

              {/* The footer: the actions on the left; type, how and when on the right. v1.3.2: with the
                  panel as tall as the answer, the resize grip sits beside the footer: room is kept for it. */}
              <div
                className={`mt-2.5 flex flex-wrap items-center gap-1 text-[12px] text-ui-muted ${gripRoom}`}
              >
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
                  onClick={() => {
                    // A box opened on another answer starts empty.
                    setReportNote('');
                    setReportingId((open) => (open === answer.id ? null : answer.id));
                  }}
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
                {/* ADR-0107: the "·" wraps together with the label after it (a lone dot ended the line). */}
                {/* The label keeps its own span, so its text still starts with how it was asked. */}
                <span className="whitespace-nowrap">
                  {answer.meta && <span aria-hidden="true">· </span>}
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
                </span>
              </div>
              {reporting && !answer.reported && (
                <div className={`mt-1 flex gap-1.5 ${gripRoom}`}>
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
                      if (event.key === 'Escape') setReportingId(null);
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
              {/* ADR-0082: the overlay has no Answer button any more: the key. */}
              {state?.notice ?? `Press ${mac ? '⌘ Enter' : 'Ctrl+Enter'} when they ask something.`}
            </p>
          )}
        </div>
      </div>
      {props.onResize && (
        <ResizeCorner
          onResize={props.onResize}
          onWidthDrag={props.onWidthDrag}
          side={props.gripSide ?? 'right'}
        />
      )}
    </section>
  );
}
