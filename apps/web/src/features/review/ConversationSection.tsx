/**
 * File: apps/web/src/features/review/ConversationSection.tsx
 * Purpose: The Transcript section of the session window: the call as a chat (Them on the left, You
 *          on the right) with Kite's answers inline as cards, each with its time, thumbs and
 *          "Report this answer". Also Download (TXT and PDF) and Clear transcript (asks first).
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: src/core/review/conversation.ts, src/core/answer/format.ts (splitAnswer),
 *             src/core/storage/answers.ts (rating, report), src/core/storage/utterances.ts (clear),
 *             src/core/transcript/display.ts (sentenceCase), src/ui (Button, Dialog, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 *
 * All of this stays on this device; reports are stored with the answer and sent nowhere.
 */
'use client';

import { useState } from 'react';
import { splitAnswer } from '@/core/answer/format';
import {
  conversationItems,
  transcriptFileName,
  transcriptPdf,
  transcriptText,
} from '@/core/review/conversation';
import { rateAnswer, reportAnswer } from '@/core/storage/answers';
import type { Session, StoredAnswer, StoredUtterance } from '@/core/storage/types';
import { clearTranscript } from '@/core/storage/utterances';
import { sentenceCase } from '@/core/transcript/display';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { FlagIcon, ThumbDownIcon, ThumbUpIcon } from '@/ui/icons';

/** Clock time of a line or answer, in the user's locale (for example "14:05:32"). */
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

/** How each answer was asked. */
const MODE_LABELS: Record<StoredAnswer['mode'], string> = {
  answer: 'Answer',
  chat: 'Typed question',
  screenshot: 'Screenshot',
};

/** Words for a rating. */
const RATING_LABELS = { up: '👍 Helpful', down: '👎 Not helpful' } as const;

/** Props for ConversationSection. */
export interface ConversationSectionProps {
  /** The session. */
  session: Session;
  /** The saved lines, oldest first. */
  lines: readonly StoredUtterance[];
  /** The saved answers, oldest first. */
  answers: readonly StoredAnswer[];
  /** The session's own spellings to restore in each line (displayTerms()). */
  terms: readonly string[];
  /** Reads the data again after a change. */
  onChanged: () => void;
}

/**
 * Hands a file to the browser as a download.
 *
 * @param name The file's name.
 * @param type Its media type.
 * @param data Its contents.
 * @returns Nothing.
 * Called from: ConversationSection
 */
function download(name: string, type: string, data: BlobPart) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // The download has started; the address is no longer needed.
  URL.revokeObjectURL(url);
}

/**
 * One of Kite's answers in the conversation.
 *
 * @param props.answer    The answer.
 * @param props.onChanged Reads the data again after a change.
 * @returns The card.
 * Rendered by: ConversationSection
 */
function AnswerCard({
  answer,
  onChanged,
}: {
  /** The answer. */
  answer: StoredAnswer;
  /** Reads the data again after a change. */
  onChanged: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const parts = splitAnswer(answer.text);

  /**
   * Sets or removes a rating.
   *
   * @param rating The thumb pressed.
   */
  function rate(rating: 'up' | 'down') {
    void rateAnswer(answer.id, answer.rating === rating ? null : rating).then(onChanged);
  }

  /** Stores the report on this device. */
  function sendReport() {
    void reportAnswer(answer.id, reason.trim()).then(onChanged);
    setReporting(false);
  }

  return (
    <li
      aria-label="Saved answer"
      className="my-1 border border-l-[3px] border-ui-border border-l-ui-accent bg-ui-surface p-3 text-sm"
    >
      <p className="text-xs text-ui-muted">
        Kite · {MODE_LABELS[answer.mode]} · Question:{' '}
        <span className="text-ui-text">{answer.question || 'the latest from Them'}</span>
      </p>
      <p className="mt-1 font-semibold text-ui-heading">{parts.headline}</p>
      {parts.bullets.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ui-text">
          {parts.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      )}
      {parts.tip && <p className="mt-1 text-ui-text">{parts.tip}</p>}
      {parts.note && (
        <p aria-label="Private note" className="mt-1 text-xs italic text-ui-muted">
          Just for you: {parts.note}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ui-muted">
        <span>{CLOCK.format(answer.createdAt)}</span>
        <button
          type="button"
          aria-label="Good answer"
          aria-pressed={answer.rating === 'up'}
          onClick={() => rate('up')}
          className={`p-1 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${answer.rating === 'up' ? 'text-ui-success' : ''}`}
        >
          <ThumbUpIcon />
        </button>
        <button
          type="button"
          aria-label="Bad answer"
          aria-pressed={answer.rating === 'down'}
          onClick={() => rate('down')}
          className={`p-1 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${answer.rating === 'down' ? 'text-ui-danger' : ''}`}
        >
          <ThumbDownIcon />
        </button>
        <button
          type="button"
          aria-label={answer.reported ? 'Reported' : 'Report this answer'}
          aria-pressed={answer.reported ?? false}
          onClick={() => setReporting((open) => !open)}
          className={`p-1 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${answer.reported ? 'text-ui-warning' : ''}`}
        >
          <FlagIcon />
        </button>
        {answer.rating && <span aria-label="Rating">{RATING_LABELS[answer.rating]}</span>}
        {answer.reported && <span>Reported</span>}
        {answer.note && <span aria-label="Your note">Your note: {answer.note}</span>}
      </div>
      {reporting && (
        <div className="mt-2 flex items-end gap-2">
          <input
            aria-label="What was wrong?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={2_000}
            placeholder="What was wrong? (optional)"
            className="h-9 min-w-0 flex-1 border border-ui-border bg-ui-input px-2 text-[14px] text-ui-text pointer-coarse:min-h-11"
          />
          <Button size="sm" variant="secondary" onClick={sendReport}>
            Report
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The transcript with answers inline.
 *
 * @param props See ConversationSectionProps.
 * @returns The section.
 * Rendered by: SessionReview.tsx
 */
export function ConversationSection({
  session,
  lines,
  answers,
  terms,
  onChanged,
}: ConversationSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const items = conversationItems(lines, answers);

  /** Downloads the conversation as text. */
  function downloadText() {
    setNotice(null);
    download(
      transcriptFileName(session, 'txt'),
      'text/plain;charset=utf-8',
      transcriptText(session, items, terms),
    );
  }

  /** Downloads the conversation as a PDF, saying so if some letters cannot be shown in it. */
  function downloadPdf() {
    const { bytes, lossy } = transcriptPdf(session, items, terms);
    download(transcriptFileName(session, 'pdf'), 'application/pdf', bytes.slice());
    setNotice(
      lossy
        ? 'Some letters cannot be shown in the PDF and appear as "?". TXT keeps them all.'
        : null,
    );
  }

  /** Clears the saved lines, after the user confirmed. */
  async function confirmClear() {
    await clearTranscript(session.id);
    setConfirming(false);
    onChanged();
  }

  return (
    <section aria-label="Transcript" className="border border-ui-border bg-ui-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[20px] text-ui-subheading">Transcript</h2>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={downloadText}>
              Download TXT
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadPdf}>
              Download PDF
            </Button>
            {lines.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Clear transcript
              </Button>
            )}
          </div>
        )}
      </div>
      {notice && (
        <p role="status" className="mt-2 text-sm text-ui-muted">
          {notice}
        </p>
      )}
      {lines.length === 0 && (
        <p className="mt-2 text-sm text-ui-muted">
          {session.saveTranscript
            ? 'No transcript lines are saved for this session.'
            : 'The transcript was not saved for this session ("Save transcript" was off). Only the answers and the notes were kept.'}
        </p>
      )}
      {items.length > 0 && (
        <ol aria-label="Conversation" className="mt-3 flex flex-col gap-1.5">
          {items.map((item) =>
            item.kind === 'answer' ? (
              <AnswerCard key={item.answer.id} answer={item.answer} onChanged={onChanged} />
            ) : (
              <li
                key={item.line.id}
                aria-label={item.line.speaker === 'you' ? 'You said' : 'Them said'}
                className={`flex max-w-[85%] flex-col ${item.line.speaker === 'you' ? 'items-end self-end' : 'items-start self-start'}`}
              >
                <span
                  className={`px-3 py-1.5 text-[15px] text-ui-text ${item.line.speaker === 'you' ? 'bg-ui-pale' : 'bg-ui-band'}`}
                >
                  {sentenceCase(item.line.text, terms)}
                </span>
                <span className="mt-0.5 font-mono text-[11px] text-ui-muted">
                  {item.line.speaker === 'you' ? 'You' : 'Them'} · {CLOCK.format(item.line.tStart)}
                </span>
              </li>
            ),
          )}
        </ol>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear this transcript?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmClear()}>
              Clear transcript
            </Button>
          </>
        }
      >
        <p>
          The saved transcript of this session is deleted from this computer. Kite&rsquo;s answers
          and the notes stay. This cannot be undone.
        </p>
      </Dialog>
    </section>
  );
}
