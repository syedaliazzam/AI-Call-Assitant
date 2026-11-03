/**
 * File: apps/web/src/features/live/TranscriptBubbles.tsx
 * Purpose: The transcript as chat bubbles (v1.0.2): "Them" on the left, "You" on the right, each
 *          bubble one speaker's turn (lines grouped by core/transcript/group.ts), with the
 *          speaker's name and a quiet time, words still settling in grey italics, a "?" mark on
 *          the other person's questions and, where the screen offers it, an "Answer this"
 *          button. Newest bubble at the top (ADR-0030). Presentational: the caller groups the
 *          lines and owns the scroll area and its aria-live.
 * Used by: src/features/live/TranscriptStrip.tsx (main window, browser split view),
 *          src/features/live/CompactView.tsx (the overlay's expanded transcript)
 * Depends on: src/core/transcript/group.ts (TranscriptGroup), src/features/live/speakers.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import type { TranscriptGroup } from '@/core/transcript/group';
import { SPEAKER_STYLE } from './speakers';

/** Props for TranscriptBubbles. */
export interface TranscriptBubblesProps {
  /** The bubbles, oldest first (groupLines()); shown newest first. */
  groups: readonly TranscriptGroup[];
  /** 'overlay': 16 px text for the overlay; 'panel' (default): 15 px for the main window. */
  size?: 'panel' | 'overlay';
  /** Answers one of the other person's questions; when given, their question bubbles offer it. */
  onAnswerThis?: (group: TranscriptGroup) => void;
  /** Ids of the bubbles already answered: they say so instead of offering the button again. */
  answeredIds?: ReadonlySet<string>;
  /** Shown when there are no bubbles yet. */
  emptyText?: string;
}

/** A bubble's time of day without seconds, for example "14:05". */
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Text size of each layout. */
const TEXT_SIZE = { panel: 'text-[15px] leading-6', overlay: 'text-[16px] leading-relaxed' };

/**
 * The transcript bubbles.
 *
 * @param props See TranscriptBubblesProps.
 * @returns The list, or the empty text.
 * Rendered by: TranscriptStrip.tsx, CompactView.tsx
 */
export function TranscriptBubbles({
  groups,
  size = 'panel',
  onAnswerThis,
  answeredIds,
  emptyText = 'Nothing said yet.',
}: TranscriptBubblesProps) {
  if (groups.length === 0) return <p className="text-[13px] text-ui-muted">{emptyText}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {[...groups].reverse().map((group) => {
        const style = SPEAKER_STYLE[group.speaker];
        const you = group.speaker === 'you';
        const answered = answeredIds?.has(group.id) ?? false;
        return (
          <li
            key={group.id}
            aria-label={you ? 'You said' : 'Them said'}
            className={`flex max-w-[85%] flex-col gap-0.5 ${you ? 'items-end self-end' : 'items-start self-start'}`}
          >
            {/* Name and a quiet time of day: which side is clear without reading colours. */}
            <span className="flex items-center gap-1.5 text-[12px] leading-4">
              <span className={`font-medium ${style.label}`}>{style.name}</span>
              <span className="text-ui-muted">{TIME_FORMAT.format(group.tStart)}</span>
            </span>
            <span
              className={`flex items-start gap-2 rounded-card px-3 py-1.5 text-ui-text ${TEXT_SIZE[size]} ${you ? 'bg-ui-pale' : 'bg-ui-band'}`}
            >
              {group.question && (
                <span
                  role="img"
                  aria-label="Question"
                  title="A question from the other person"
                  className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ui-border text-[12px] font-semibold text-ui-accent"
                >
                  ?
                </span>
              )}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {group.finalText}
                {group.provisionalText && (
                  // Words that may still change: grey italic.
                  <span className="italic text-ui-provisional">
                    {group.finalText ? ' ' : ''}
                    {group.provisionalText}
                  </span>
                )}
              </span>
            </span>
            {group.question &&
              onAnswerThis &&
              (answered ? (
                <span className="text-[12px] text-ui-muted">Answered</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAnswerThis(group)}
                  title="Answer this question"
                  className="inline-flex h-7 items-center rounded-control border border-ui-border px-2 text-[13px] font-medium text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]"
                >
                  Answer this
                </button>
              ))}
          </li>
        );
      })}
    </ol>
  );
}
