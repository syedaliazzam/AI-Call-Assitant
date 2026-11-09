/**
 * File: apps/web/src/core/transcript/turns.ts
 * Purpose: The transcript as turns, the way an Otter export reads (v1.3.2): one speaker's consecutive
 *          lines make one turn, shown as "<Speaker name>  <mm:ss since the call started>" with the words
 *          under it. A new turn starts when the speaker changes or after a pause of more than 8 s. Also
 *          the speaker names (the account's display name for "You", the session's renamable name for
 *          "Them") and the mm:ss clock. Display only: stored lines, answers and prompts are unchanged.
 * Used by: src/features/live/TranscriptBubbles.tsx (live panels), src/core/review/conversation.ts
 *          (Review's Conversation tab, TXT and PDF downloads)
 * Depends on: src/core/transcript/group.ts (groupLines: sentence case, question marks, spellings),
 *             src/core/transcript/unclear.ts (isUnclearGroup), src/core/storage/types.ts (Session)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S15, S17 Review); v1.3.2
 *
 * Transcript text is only arranged for the screen and the downloads here; it is never logged.
 */
import type { Session } from '../storage/types';
import { groupLines, type GroupLine, type TranscriptGroup } from './group';
import type { DisplayTerm } from './display';
import { isUnclearGroup } from './unclear';

/** A pause longer than this, in ms, starts a new turn even when the same person keeps talking. */
export const TURN_GAP_MS = 8_000;

/** What the other person is called when the session has no name for them. */
export const DEFAULT_THEM_NAME = 'Them';

/** What the user is called when the account's display name is not known. */
export const DEFAULT_YOU_NAME = 'You';

/** The parts of a bubble that make up a turn (a TranscriptGroup, or one the overlay received). */
export interface TurnPart {
  /** The part's id. */
  id: string;
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** Its finished words, ready to show. */
  finalText: string;
  /** Words that may still change, or ''. */
  provisionalText: string;
  /** When it started (Unix ms). */
  tStart: number;
  /** When it ended (Unix ms); absent from an older live page, then its start counts. */
  tEnd?: number;
  /** True when its words look like noise; absent means work it out from the words. */
  unclear?: boolean;
}

/** One turn: one speaker's consecutive parts with no pause over TURN_GAP_MS between them. */
export interface Turn<T extends TurnPart = TurnPart> {
  /** The first part's id: stays the same as the turn grows. */
  id: string;
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** When the first part started (Unix ms). */
  tStart: number;
  /** When the last part ended (Unix ms). */
  tEnd: number;
  /** The parts, in order. */
  parts: T[];
  /** The finished words of every part, joined with spaces. */
  finalText: string;
  /** Words still settling at the turn's end, or ''. */
  provisionalText: string;
  /** True when every part looks like noise (it collapses into "Unclear speech" in the live panel). */
  unclear: boolean;
}

/** Options for mergeTurns(). */
export interface TurnOptions {
  /** Longest pause inside a turn, in ms (default TURN_GAP_MS). */
  gapMs?: number;
  /**
   * True to keep noise apart from speech (the live panel, where noise collapses into "Unclear speech";
   * ADR-0044). Review and the downloads merge everything a speaker said.
   */
  keepUnclearApart?: boolean;
}

/**
 * Merges consecutive parts of one speaker into turns. A part joins the turn before it when the speaker
 * is the same, the pause since the turn's end is at most gapMs, and the turn has no words still
 * settling (those are always its end); otherwise it starts a new turn. Empty parts are left out.
 *
 * @param parts   The bubbles, oldest first (groupLines(), or the overlay's groups).
 * @param options The longest pause, and whether noise stays apart.
 * @returns The turns, oldest first.
 * Called from: TranscriptBubbles.tsx, lineTurns(); tests
 */
export function mergeTurns<T extends TurnPart>(
  parts: readonly T[],
  options: TurnOptions = {},
): Turn<T>[] {
  const gapMs = options.gapMs ?? TURN_GAP_MS;
  const turns: Turn<T>[] = [];
  for (const part of parts) {
    if (`${part.finalText}${part.provisionalText}`.trim() === '') continue;
    const end = part.tEnd ?? part.tStart;
    const last = turns.at(-1);
    const lastPart = last?.parts.at(-1);
    const joins =
      last !== undefined &&
      lastPart !== undefined &&
      last.speaker === part.speaker &&
      last.provisionalText === '' &&
      part.tStart - last.tEnd <= gapMs &&
      !(options.keepUnclearApart && isUnclearGroup(lastPart) !== isUnclearGroup(part));
    if (!joins || !last) {
      turns.push({
        id: part.id,
        speaker: part.speaker,
        tStart: part.tStart,
        tEnd: end,
        parts: [part],
        finalText: part.finalText.trim(),
        provisionalText: part.provisionalText.trim(),
        unclear: isUnclearGroup(part),
      });
      continue;
    }
    last.parts.push(part);
    last.tEnd = Math.max(last.tEnd, end);
    last.finalText = [last.finalText, part.finalText.trim()].filter(Boolean).join(' ');
    last.provisionalText = part.provisionalText.trim();
    last.unclear = last.unclear && isUnclearGroup(part);
  }
  return turns;
}

/**
 * Saved (final) lines as turns: grouped into sentences and questions first (groupLines(): sentence case,
 * the session's spellings, "?" marks), then merged into turns.
 *
 * @param lines The saved lines, oldest first.
 * @param terms The session's spellings to restore.
 * @returns The turns, oldest first; each part keeps the ids of its lines.
 * Called from: src/core/review/conversation.ts; tests
 */
export function lineTurns(
  lines: readonly Omit<GroupLine, 'final'>[],
  terms: readonly DisplayTerm[] = [],
): Turn<TranscriptGroup>[] {
  const groups = groupLines(
    lines.map((line) => ({ ...line, final: true })),
    { terms, gapMs: TURN_GAP_MS },
  );
  return mergeTurns(groups);
}

/**
 * The time since the call started, as an export writes it: "mm:ss", minutes not capped at 59 (a
 * 75-minute call reads 75:03). Before the start reads 00:00.
 *
 * @param ms Milliseconds since the call started.
 * @returns For example "04:07".
 * Called from: TranscriptBubbles.tsx, src/core/review/conversation.ts,
 *              src/features/review/ConversationSection.tsx; tests
 */
export function formatElapsed(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The names on each side's turns. */
export interface SpeakerNames {
  /** The user: the account's display name. */
  you: string;
  /** The other person: the session's name for them. */
  them: string;
}

/**
 * The names on each side's turns: "You" shows the account's display name, "Them" the name stored on the
 * session (renamable in Review). Each falls back to "You" or "Them".
 *
 * @param session     The session (its contactName is the other person's name).
 * @param accountName The signed-in account's display name, when known.
 * @returns The two names.
 * Called from: TranscriptBubbles.tsx (through its props), conversation.ts, ConversationSection.tsx,
 *              LiveAnswers.tsx; tests
 */
export function speakerNames(
  session: Pick<Session, 'contactName'> | null | undefined,
  accountName?: string | null,
): SpeakerNames {
  return {
    you: accountName?.trim() || DEFAULT_YOU_NAME,
    them: session?.contactName?.trim() || DEFAULT_THEM_NAME,
  };
}
