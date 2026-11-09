/**
 * File: apps/web/src/features/live/TranscriptBubbles.tsx
 * Purpose: The live transcript as turns, the way an Otter export reads (v1.3.2): "<Speaker name>  <mm:ss
 *          since the call started>" on its own line, the words on the next, a blank line between turns.
 *          One speaker's consecutive bubbles make one turn; a new turn starts when the speaker changes or
 *          after a pause over 8 s (core/transcript/turns.ts). "You" shows the account's display name and
 *          the other person the session's name for them. Words still settling are grey italics; the
 *          other person's questions have a "?" mark and "Answer this". A run of turns whose words look
 *          like noise collapses into "Unclear speech (n)" (ADR-0044), which opens on a click. Before
 *          v1.3.2 these were chat bubbles (You on the right, Them on the left). Presentational: the
 *          caller groups the lines and owns the scroll area and its aria-live.
 * Used by: src/features/live/TranscriptStrip.tsx (main window, browser split view),
 *          src/features/live/overlay/TranscriptPanel.tsx
 * Depends on: src/core/transcript/group.ts (TranscriptGroup), src/core/transcript/turns.ts,
 *             src/core/transcript/unclear.ts, src/features/live/speakers.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip);
 *               docs/design/paramount-ai-ui-spec.md §3 (S15)
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { useMemo, useState } from 'react';
import type { TranscriptGroup } from '@/core/transcript/group';
import {
  DEFAULT_THEM_NAME,
  DEFAULT_YOU_NAME,
  formatElapsed,
  mergeTurns,
  type Turn,
} from '@/core/transcript/turns';
import { collapseUnclear, type BubbleItem } from '@/core/transcript/unclear';
import { SPEAKER_STYLE } from './speakers';

/** The parts of a bubble shown here (a TranscriptGroup, or one the overlay received). */
export type BubbleGroup = Pick<
  TranscriptGroup,
  'id' | 'speaker' | 'finalText' | 'provisionalText' | 'tStart' | 'question'
> & {
  /** When it ended (Unix ms); absent from an older live page. */
  tEnd?: number;
  /** True when its words look like noise; absent means work it out from the words. */
  unclear?: boolean;
};

/** Props for TranscriptBubbles. */
export interface TranscriptBubblesProps<T extends BubbleGroup = BubbleGroup> {
  /** The bubbles, oldest first (groupLines()): merged into turns here. */
  groups: readonly T[];
  /**
   * 'overlay': the call panels' text size (spec S15, 17/600). 'panel' (default): 15 px, for the main
   * window and the browser's call view.
   */
  size?: 'panel' | 'overlay';
  /** The name on the other person's turns ("Them" when the session has none). */
  themName?: string | undefined;
  /** The name on the user's turns: the account's display name ("You" when unknown). */
  youName?: string | null | undefined;
  /** When the call connected (Unix ms), for each turn's mm:ss; absent: from the first turn. */
  startedAt?: number | undefined;
  /** Answers one of the other person's bubbles; when given, their turns offer it. */
  onAnswerThis?: (group: T) => void;
  /** Ids of the bubbles already answered: their turns say so instead of offering the button again. */
  answeredIds?: ReadonlySet<string>;
  /** Shown when there are no bubbles yet. */
  emptyText?: string;
}

/** Text size of each layout (v1.3.0, ADR-0057: the overlay's lines are 17/600). */
const TEXT_SIZE = {
  panel: 'text-[15px] leading-6',
  overlay: 'text-[17px] font-semibold leading-6',
};

/** The speaker and time line above each turn, per layout. */
const META_SIZE = {
  panel: 'text-[13px] leading-5',
  overlay: 'text-[14px] leading-5',
};

/**
 * The bubble a turn's "Answer this" asks about: its latest question, or its latest bubble when none of
 * them is a question (a greeting is answered only when asked for).
 *
 * @param turn The other person's turn.
 * @returns The bubble.
 * Called from: TranscriptBubbles; tests (through the component)
 */
export function answerTarget<T extends BubbleGroup>(turn: Turn<T>): T {
  return turn.parts.findLast((part) => part.question) ?? turn.parts.at(-1)!;
}

/** One turn as the list shows it, with what collapseUnclear() needs. */
interface ShownTurn<T extends BubbleGroup> {
  /** The turn's id (its first bubble's). */
  id: string;
  /** Its finished words. */
  finalText: string;
  /** Words still settling. */
  provisionalText: string;
  /** True when it all looks like noise. */
  unclear: boolean;
  /** The turn. */
  turn: Turn<T>;
}

/**
 * The live transcript, as turns.
 *
 * @param props See TranscriptBubblesProps.
 * @returns The list, or the empty text.
 * Rendered by: TranscriptStrip.tsx, TranscriptPanel.tsx
 */
export function TranscriptBubbles<T extends BubbleGroup>({
  groups,
  size = 'panel',
  themName,
  youName,
  startedAt,
  onAnswerThis,
  answeredIds,
  emptyText = 'Nothing said yet.',
}: TranscriptBubblesProps<T>) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // Noise stays apart from speech, so it can still collapse (ADR-0044).
  const turns = useMemo(
    () =>
      mergeTurns(groups, { keepUnclearApart: true }).map((turn): ShownTurn<T> => ({
        id: turn.id,
        finalText: turn.finalText,
        provisionalText: turn.provisionalText,
        unclear: turn.unclear,
        turn,
      })),
    [groups],
  );
  if (turns.length === 0) return <p className="text-[13px] text-ui-muted">{emptyText}</p>;
  // Before the call's start is known, the first words count from 00:00.
  const start = startedAt ?? turns[0]!.turn.tStart;

  /**
   * One turn: its speaker and time line, then its words.
   *
   * @param shown The turn.
   * @returns Its list item.
   */
  const row = ({ turn }: ShownTurn<T>) => {
    const style = SPEAKER_STYLE[turn.speaker];
    const you = turn.speaker === 'you';
    const name = you ? youName?.trim() || DEFAULT_YOU_NAME : themName?.trim() || DEFAULT_THEM_NAME;
    const target = you ? null : answerTarget(turn);
    const answered = target ? (answeredIds?.has(target.id) ?? false) : false;
    const question = !you && turn.parts.some((part) => part.question);
    return (
      <li
        key={turn.id}
        aria-label={you ? 'You said' : 'Them said'}
        className="group/bubble flex flex-col gap-0.5"
      >
        <span className={`flex flex-wrap items-center gap-x-2 ${META_SIZE[size]}`}>
          <span className={`font-semibold ${style.label}`}>{name}</span>
          <span className="tabular-nums text-ui-muted">{formatElapsed(turn.tStart - start)}</span>
          {question && (
            <span
              role="img"
              aria-label="Question"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ui-border text-[12px] font-semibold text-ui-accent"
            >
              ?
            </span>
          )}
          {target &&
            onAnswerThis &&
            (answered ? (
              <span className="text-ui-muted">Answered</span>
            ) : (
              // Always shown on a question; on anything else (a greeting) under the pointer or the
              // keyboard: a greeting is answered only when asked for here (item 14).
              <button
                type="button"
                onClick={() => onAnswerThis(target)}
                className={`inline-flex h-6 items-center rounded-control border border-ui-border px-1.5 text-[12px] font-medium text-ui-text hover:bg-ui-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag] ${question ? '' : 'opacity-0 group-hover/bubble:opacity-100'}`}
              >
                Answer this
              </button>
            ))}
        </span>
        <span className={`min-w-0 text-ui-text [overflow-wrap:anywhere] ${TEXT_SIZE[size]}`}>
          {turn.finalText}
          {turn.provisionalText && (
            // Words that may still change: grey italic.
            <span className="italic text-ui-provisional">
              {turn.finalText ? ' ' : ''}
              {turn.provisionalText}
            </span>
          )}
        </span>
      </li>
    );
  };

  /**
   * One item: a turn, or a run of unclear ones.
   *
   * @param item The item.
   * @returns What to show.
   */
  const item = (item: BubbleItem<ShownTurn<T>>) => {
    if (item.kind === 'group') return row(item.group);
    if (opened.has(item.id)) return item.groups.map(row);
    return (
      <li key={item.id}>
        <button
          type="button"
          aria-expanded="false"
          onClick={() => setOpened((was) => new Set(was).add(item.id))}
          className="rounded-full border border-ui-border px-2.5 py-0.5 text-[12px] text-ui-muted hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
        >
          Unclear speech ({item.groups.length})
        </button>
      </li>
    );
  };

  // A blank line between turns, as in an export.
  return (
    <ol className={`flex flex-col ${size === 'overlay' ? 'gap-3' : 'gap-4'}`}>
      {collapseUnclear(turns).map(item)}
    </ol>
  );
}
