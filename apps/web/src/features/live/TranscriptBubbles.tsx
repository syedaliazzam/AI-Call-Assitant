/**
 * File: apps/web/src/features/live/TranscriptBubbles.tsx
 * Purpose: The transcript as chat bubbles: the other person on the left, "You" on the right, each bubble
 *          one speaker's turn, with "Name · time" under it, words still settling in grey italics, a "?"
 *          mark on the other person's questions and "Answer this". Since v1.1.0 (ADR-0041) oldest at the
 *          top, newest at the bottom (reversing ADR-0030's order), and (ADR-0044) a run of bubbles whose
 *          words look like noise collapses into "Unclear speech (n)", which opens on a click.
 *          Presentational: the caller groups the lines and owns the scroll area and its aria-live.
 * Used by: src/features/live/TranscriptStrip.tsx (main window, browser split view),
 *          src/features/live/overlay/TranscriptPanel.tsx
 * Depends on: src/core/transcript/group.ts (TranscriptGroup), src/core/transcript/unclear.ts,
 *             src/features/live/speakers.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { useState } from 'react';
import type { TranscriptGroup } from '@/core/transcript/group';
import { collapseUnclear, type BubbleItem } from '@/core/transcript/unclear';
import { SPEAKER_STYLE } from './speakers';

/** The parts of a bubble shown here (a TranscriptGroup, or one the overlay received). */
export type BubbleGroup = Pick<
  TranscriptGroup,
  'id' | 'speaker' | 'finalText' | 'provisionalText' | 'tStart' | 'question'
> & {
  /** True when its words look like noise; absent means work it out from the words. */
  unclear?: boolean;
};

/** Props for TranscriptBubbles. */
export interface TranscriptBubblesProps<T extends BubbleGroup = BubbleGroup> {
  /** The bubbles, oldest first (groupLines()). */
  groups: readonly T[];
  /** 'overlay': 16 px text for the overlay; 'panel' (default): 15 px for the main window. */
  size?: 'panel' | 'overlay';
  /** True on a see-through panel: the bubbles let the background show through. */
  glassBubbles?: boolean;
  /** The name on the other person's bubbles ("Client 1" when the session has none). */
  themName?: string | undefined;
  /** Answers one of the other person's bubbles; when given, they offer it. */
  onAnswerThis?: (group: T) => void;
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
 * Rendered by: TranscriptStrip.tsx, TranscriptPanel.tsx
 */
export function TranscriptBubbles<T extends BubbleGroup>({
  groups,
  size = 'panel',
  glassBubbles = false,
  themName,
  onAnswerThis,
  answeredIds,
  emptyText = 'Nothing said yet.',
}: TranscriptBubblesProps<T>) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  if (groups.length === 0) return <p className="text-[13px] text-ui-muted">{emptyText}</p>;

  /**
   * One bubble.
   *
   * @param group The bubble.
   * @returns Its list item.
   */
  const bubble = (group: T) => {
    const style = SPEAKER_STYLE[group.speaker];
    const you = group.speaker === 'you';
    const answered = answeredIds?.has(group.id) ?? false;
    const name = you ? style.name : themName?.trim() || 'Client 1';
    return (
      <li
        key={group.id}
        aria-label={you ? 'You said' : 'Them said'}
        className={`group/bubble flex max-w-[85%] flex-col gap-0.5 ${you ? 'items-end self-end' : 'items-start self-start'}`}
      >
        <span
          className={`flex items-start gap-2 rounded-card px-3 py-1.5 text-ui-text ${TEXT_SIZE[size]} ${glassBubbles ? 'bg-ui-overlay-button' : you ? 'bg-ui-pale' : 'bg-ui-band'}`}
        >
          {group.question && (
            <span
              role="img"
              aria-label="Question"
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
        <span className="flex items-center gap-1.5 text-[12px] leading-4 text-ui-muted">
          <span className={`font-medium ${style.label}`}>{name}</span>
          <span aria-hidden="true">·</span>
          <span>{TIME_FORMAT.format(group.tStart)}</span>
          {!you &&
            onAnswerThis &&
            (answered ? (
              <span>· Answered</span>
            ) : (
              // Always shown on a question; on anything else (a greeting) under the pointer or the
              // keyboard: a greeting is answered only when asked for here (item 14).
              <button
                type="button"
                onClick={() => onAnswerThis(group)}
                className={`ml-1 inline-flex h-6 items-center rounded-control border border-ui-border px-1.5 text-[12px] font-medium text-ui-text hover:bg-ui-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag] ${group.question ? '' : 'opacity-0 group-hover/bubble:opacity-100'}`}
              >
                Answer this
              </button>
            ))}
        </span>
      </li>
    );
  };

  /**
   * One item: a bubble, or a run of unclear ones.
   *
   * @param item The item.
   * @returns What to show.
   */
  const item = (item: BubbleItem<T>) => {
    if (item.kind === 'group') return bubble(item.group);
    if (opened.has(item.id)) return item.groups.map(bubble);
    return (
      <li key={item.id} className="self-center">
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

  return <ol className="flex flex-col gap-3">{collapseUnclear(groups).map(item)}</ol>;
}
