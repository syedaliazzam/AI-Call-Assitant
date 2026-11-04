/**
 * File: apps/web/src/core/transcript/unclear.ts
 * Purpose: Collapses transcript bubbles whose words look like noise into one "Unclear speech (n)" item
 *          (v1.1.0, ADR-0044). Display only: the saved lines, and what Claude receives, keep every word.
 * Used by: src/features/live/TranscriptBubbles.tsx
 * Depends on: src/core/transcript/questionKind.ts (looksGarbled)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0044
 *
 * Pure. Transcript text is never logged.
 */
import { looksGarbled } from './questionKind';

/** One thing to show: a bubble, or a run of unclear ones. */
export type BubbleItem<T> =
  | {
      /** A normal bubble. */
      kind: 'group';
      /** The bubble. */
      group: T;
    }
  | {
      /** Unclear bubbles in a row. */
      kind: 'unclear';
      /** Stable id: the run's first bubble. */
      id: string;
      /** The bubbles. */
      groups: T[];
    };

/** The parts of a bubble read here. */
interface UnclearInput {
  /** Its id. */
  id: string;
  /** Its finished words. */
  finalText: string;
  /** Words that may still change. */
  provisionalText: string;
  /** True when its words look like noise; absent means work it out from the words. */
  unclear?: boolean;
}

/**
 * Whether a bubble collapses. Words still being heard never do: they may turn into something.
 *
 * @param group The bubble.
 * @returns True when it is finished and its words look like noise.
 * Called from: collapseUnclear(); LiveAnswers.tsx (the overlay's state); tests
 */
export function isUnclearGroup(group: UnclearInput): boolean {
  if (group.provisionalText !== '') return false;
  return group.unclear ?? looksGarbled(group.finalText);
}

/**
 * Puts unclear bubbles in a row into one item.
 *
 * @param groups The bubbles, oldest first.
 * @returns What to show, in the same order.
 * Called from: TranscriptBubbles.tsx; tests
 */
export function collapseUnclear<T extends UnclearInput>(groups: readonly T[]): BubbleItem<T>[] {
  const items: BubbleItem<T>[] = [];
  for (const group of groups) {
    const last = items.at(-1);
    if (!isUnclearGroup(group)) items.push({ kind: 'group', group });
    else if (last?.kind === 'unclear') last.groups.push(group);
    else items.push({ kind: 'unclear', id: group.id, groups: [group] });
  }
  return items;
}
