/**
 * File: apps/web/src/features/live/TranscriptStrip.tsx
 * Purpose: The live transcript as chat bubbles (v1.0.2), oldest at the top and newest at the bottom
 *          (v1.1.0, ADR-0041): one speaker's lines with short pauses between them make one bubble
 *          (group.ts), "Them" on the left and "You" on the right, words still being spoken in grey; the
 *          other person's questions are marked and can offer "Answer this". It follows the newest line
 *          unless the reader has scrolled up, when "Jump to latest" shows. Shows the speech-to-text
 *          health notice above the bubbles.
 * Used by: src/features/live/LivePage.tsx (live view: desktop main window and browser split view)
 * Depends on: src/core/transcript/transcript.ts (Utterance), src/core/transcript/group.ts,
 *             src/core/transcript/display.ts (DisplayTerm), src/core/stt/health.ts (status),
 *             src/features/live/TranscriptBubbles.tsx, src/features/live/HealthNotice.tsx,
 *             src/features/live/useStickToBottom.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { memo, useMemo } from 'react';
import { answeredGroupIds, type SpeechSpan } from '@/core/answer/repeatGuard';
import type { SttHealthStatus } from '@/core/stt/health';
import type { DisplayTerm } from '@/core/transcript/display';
import { groupLines, type TranscriptGroup } from '@/core/transcript/group';
import type { Utterance } from '@/core/transcript/transcript';
import { HealthNotice } from './HealthNotice';
import { TranscriptBubbles } from './TranscriptBubbles';
import { useStickToBottom } from './useStickToBottom';
import { Button } from '@/ui/Button';

/** Props for TranscriptStrip. */
export interface TranscriptStripProps {
  /** Lines in time order (from transcript.lines()), shown oldest first. */
  lines: readonly Utterance[];
  /** The session's own spellings to restore in each line (displayTerms()); none by default. */
  terms?: readonly DisplayTerm[];
  /** Speech-to-text health. */
  health: SttHealthStatus;
  /** Answers one of the other person's questions ("Answer this" on their question bubbles). */
  onAnswerThis?: (group: TranscriptGroup) => void;
  /**
   * The speech already answered in this call (v1.0.2): bubbles with the same speech show
   * "Answered" instead of the button (answeredGroupIds()).
   */
  answeredSpans?: readonly SpeechSpan[];
  /** The name on the other person's bubbles ("Client 1" when the session has none). */
  themName?: string | undefined;
}

/** No terms: one shared empty list, so the memoised grouping is not redone on every render. */
const NO_TERMS: readonly DisplayTerm[] = [];

/**
 * The transcript strip. Memoised: the live page re-renders about 20 times a second for the
 * meters, and the transcript only needs to re-render when its lines or health change.
 *
 * @param props See TranscriptStripProps.
 * @returns The strip.
 */
export const TranscriptStrip = memo(function TranscriptStrip({
  lines,
  health,
  terms = NO_TERMS,
  onAnswerThis,
  answeredSpans,
  themName,
}: TranscriptStripProps) {
  const groups = useMemo(() => groupLines(lines, { terms }), [lines, terms]);
  const answeredIds = useMemo(
    () => (answeredSpans ? answeredGroupIds(groups, answeredSpans) : undefined),
    [groups, answeredSpans],
  );
  const last = groups.at(-1);
  const { ref, onScroll, paused, jump } = useStickToBottom(
    `${groups.length}:${last?.id}:${last?.finalText.length}:${last?.provisionalText.length}`,
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <HealthNotice status={health} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          onScroll={onScroll}
          className="h-full overflow-y-auto border border-ui-border rounded-card bg-ui-surface shadow-card p-4 sm:p-5"
          aria-live="polite"
          aria-label="Live transcript"
        >
          <TranscriptBubbles
            groups={groups}
            themName={themName}
            emptyText="Listening… Lines appear here as you and the other person speak."
            {...(onAnswerThis ? { onAnswerThis } : {})}
            {...(answeredIds ? { answeredIds } : {})}
          />
        </div>
        {paused && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-ui-bg shadow-modal"
            onClick={jump}
          >
            Jump to latest
          </Button>
        )}
      </div>
    </section>
  );
});
