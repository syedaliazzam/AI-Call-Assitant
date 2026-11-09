/**
 * File: apps/web/scripts/lib/call-replay.ts
 * Purpose: Replays what the speech worker said during a synthetic test call (its partial and final lines,
 *          with the times they reached the page) through the app's own transcript and auto-answer code,
 *          on a simulated clock, the way LivePage.tsx and useLiveAnswers.ts use them (v1.4, ADR-0062
 *          Phase 2). Works with two versions of that code: the current one (the question window, reruns)
 *          and the one before ADR-0062 (the last line, a 15 s limit), told apart by what the modules
 *          export, so a baseline can be measured with the code it shipped with.
 * Used by: scripts/stt-calls.ts; tests/unit/scripts/call-replay.test.ts
 * Depends on: the app's modules, passed in as CallLogic (bundled from the version measured)
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * No request is sent: an answer is recorded when the app would send it. Text is never printed.
 */
import type { LineConfidence } from '../../src/core/stt/protocol';
import type { MeasuredAnswer, MeasuredLine } from './call-metrics';

/** One message of the speech worker, with when it reached the page. */
export interface CallEvent {
  /**
   * 'partial' (grey text), 'final' (a finished line), 'turn' (an end-of-turn judgment, ADR-0065) or
   * 'refine' (the accurate engine's words for the final line with this tEnd, ADR-0066).
   */
  type: 'partial' | 'final' | 'turn' | 'refine';
  /** Which channel. */
  channel: 'you' | 'them';
  /** Its text. */
  text: string;
  /** Start (Unix ms), or null when a partial was cleared. */
  tStart: number | null;
  /** v1.4: end of speech (Unix ms; finals and turn judgments). */
  speechEnd?: number;
  /** v1.4 (ADR-0065): the end-of-turn model's judgment (turn events; null when it failed). */
  probability?: number | null;
  /** End (Unix ms; finals only). */
  tEnd?: number;
  /** How sure the model was (finals of v1.4 only). */
  confidence?: LineConfidence;
  /** When it reached the page (Unix ms). */
  arrivedAt: number;
}

/** A transcript line as both versions of the code have it (the fields the replay reads). */
interface LogicLine {
  /** Its id. */
  id: string;
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** Its words. */
  text: string;
  /** Start (Unix ms). */
  tStart: number;
  /** End (Unix ms). */
  tEnd: number;
  /** False while still being heard. */
  final: boolean;
  /** True when hidden. */
  echo?: boolean;
  /** True when another language (v1.4). */
  nonEnglish?: boolean;
}

/** The transcript (both versions). */
interface LogicTranscript {
  /** Replaces a speaker's grey line. */
  addPartial(speaker: 'you' | 'them', text: string, tStart: number | null): void;
  /** Adds a finished line. */
  addFinal(line: Record<string, unknown>): LogicLine;
  /** v1.4 (ADR-0065): records an end-of-turn judgment (absent before). */
  setTurnEnd?(id: string, value: number | 'pending' | null): void;
  /** v1.4 (ADR-0062): marks a line as being rewritten by the accurate engine (absent before). */
  setRefining?(id: string, on: boolean): void;
  /** v1.0.1 (ADR-0034): puts the accurate engine's words in place of the live ones. */
  refineFinal?(id: string, heard: string, refined: string): boolean;
  /** The shown lines. */
  lines(): readonly LogicLine[];
  /** Every final line, hidden ones too. */
  allLines(): readonly LogicLine[];
}

/** A question's words and lines. */
interface Selected {
  /** The words. */
  text: string;
  /** The lines' ids. */
  lineIds: string[];
}

/** A picked question (both versions). */
interface Picked {
  /** 'question', 'garbled' or 'none'. */
  kind: 'question' | 'garbled' | 'none';
  /** The question, when there is one. */
  selected: Selected;
  /** True when it was found by looking back. */
  lookedBack?: boolean;
}

/** A guard's decision. */
interface GuardDecision {
  /** Answer, ignore, or show an earlier answer. */
  kind: 'answer' | 'ignore' | 'show';
}

/** A time span. */
interface Span {
  /** Start (Unix ms). */
  start: number;
  /** End (Unix ms). */
  end: number;
}

/** A repeat guard (both versions). */
interface LogicGuard {
  /** Decides a trigger. */
  decide(trigger: Record<string, unknown>): GuardDecision;
  /** Remembers an answered span. */
  remember(span: Span, answerId: string, now: number): void;
}

/**
 * The app's modules the replay drives, as bundled from the version measured. Typed loosely on purpose:
 * the two versions' signatures differ, and the replay calls each in its own way.
 */
export interface CallLogic {
  /** core/transcript/transcript.ts */
  createTranscript(clock: () => number, options: { schedule: () => () => void }): LogicTranscript;
  /** core/answer/autoAnswer.ts (state and return differ by version). */
  autoAnswerDue(state: Record<string, unknown>, now: number): Record<string, unknown> | null;
  /** v1.4 only: core/answer/autoAnswer.ts questionWindow (tells the versions apart). */
  questionWindow?: unknown;
  /** core/transcript/questionKind.ts */
  pickQuestion(lines: readonly LogicLine[], options?: Record<string, unknown>): Picked;
  /** core/answer/repeatGuard.ts */
  createRepeatGuard(): LogicGuard;
  /** core/answer/repeatGuard.ts */
  themSpan(
    lines: readonly LogicLine[],
    ids: readonly string[],
  ): { start: number; end: number } | null;
  /** v1.4 only: core/stt/language.ts */
  looksNonEnglish?(line: { text: string; confidence?: unknown }): boolean;
  /** core/transcript/group.ts */
  groupLines(
    lines: readonly (LogicLine & { final: boolean })[],
    options?: Record<string, unknown>,
  ): unknown[];
  /** core/transcript/turns.ts */
  mergeTurns(
    parts: readonly unknown[],
  ): { speaker: 'you' | 'them'; tStart: number; tEnd: number }[];
}

/** Settings of a replay. */
export interface ReplayOptions {
  /** How long an answer streams after it is sent, ms (Day 4 / v1.1.0 measurements: about 1.5–2.5 s). */
  streamMs?: number;
  /** How often auto-answer checks, ms (useAutoAnswer.ts AUTO_TICK_MS). */
  tickMs?: number;
  /** How long to go on after the last message, ms. */
  tailMs?: number;
}

/** What a replay produced. */
export interface ReplayResult {
  /** Every final line (shown and hidden). */
  lines: MeasuredLine[];
  /** The cards. */
  answers: MeasuredAnswer[];
  /** The "Them" turns as the transcript panel shows them. */
  themTurns: { start: number; end: number }[];
}

/**
 * Replays a call's speech messages through the app's logic.
 *
 * @param events  The worker's messages, in any order.
 * @param logic   The app's modules (the version measured).
 * @param options Timings.
 * @returns The lines, the cards and the turns.
 * Called from: stt-calls.ts; tests
 */
export function replayCall(
  events: readonly CallEvent[],
  logic: CallLogic,
  options: ReplayOptions = {},
): ReplayResult {
  const streamMs = options.streamMs ?? 2_000;
  const tickMs = options.tickMs ?? 250;
  const sorted = [...events].sort((a, b) => a.arrivedAt - b.arrivedAt);
  if (sorted.length === 0) return { lines: [], answers: [], themTurns: [] };
  let now = sorted[0]!.arrivedAt;
  const transcript = logic.createTranscript(() => now, { schedule: () => () => undefined });
  const v14 = typeof logic.questionWindow === 'function';
  const guard = logic.createRepeatGuard();
  const answered = new Set<string>();
  const answers: MeasuredAnswer[] = [];
  let streamingUntil = 0;
  // v1.4 state (useLiveAnswers.ts lastAnsweredRef; useAutoAnswer.ts acted).
  let last: Record<string, unknown> | null = null;
  const acted = new Set<string>();
  // v1.3 state (useAutoAnswer.ts before ADR-0062).
  let lastAuto: { at: number | null; lineEnd: number | null } = { at: null, lineEnd: null };
  let nextId = 1;
  // v1.4: the line each end-of-turn judgment is for, by its end of speech.
  const judging = new Map<number, string>();
  // ADR-0066: the final line each accurate rewrite is for, by its end (with the words it replaces).
  const refining = new Map<number, { id: string; heard: string }>();

  /**
   * Records a new card, or a rerun on an existing one.
   *
   * @param lineIds  The lines of its question.
   * @param replaces The card it replaces, if any.
   * @returns The card's id.
   */
  const send = (lineIds: string[], replaces?: string): string => {
    const id = replaces ?? `a${nextId++}`;
    const existing = answers.find((answer) => answer.id === id);
    if (existing) {
      existing.sentAt = now;
      existing.lineIds = lineIds;
      existing.reruns += 1;
    } else {
      answers.push({ id, sentAt: now, lineIds, reruns: 0 });
    }
    for (const lineId of lineIds) answered.add(lineId);
    streamingUntil = now + streamMs;
    return id;
  };

  /** One auto-answer check, as useAutoAnswer.ts and useLiveAnswers.ts (ask) do it. */
  const tick = () => {
    const lines = transcript.lines();
    const streaming = now < streamingUntil;
    if (v14) {
      const due = logic.autoAnswerDue(
        { enabled: true, streaming, lines, answeredLineIds: answered, last },
        now,
      ) as { kind: 'answer' | 'rerun'; lineIds: string[]; tEnd: number; replaces?: string } | null;
      if (!due) return;
      const key = `${due.kind}:${due.lineIds.join(',')}:${due.tEnd}`;
      if (acted.has(key)) return;
      acted.add(key);
      const chosen = lines.filter((line) => due.lineIds.includes(line.id));
      if (chosen.length === 0) return;
      const span = logic.themSpan(lines, due.lineIds);
      if (due.kind === 'answer') {
        const text = chosen.map((line) => line.text.trim()).join(' ');
        const decision = guard.decide({
          question: text,
          streaming,
          now,
          ...(span ? { span } : {}),
          auto: true,
        });
        if (decision.kind !== 'answer') return;
      }
      const id = send(
        chosen.map((line) => line.id),
        due.kind === 'rerun' ? due.replaces : undefined,
      );
      if (span) {
        guard.remember(span, id, now);
        last = {
          answerId: id,
          lineIds: chosen.map((line) => line.id),
          end: span.end,
          askedAt: now,
          auto: true,
        };
      }
      return;
    }
    // Before ADR-0062: the last line, 1.2 s, at most one per 15 s; then Answer's own question picking.
    const due = logic.autoAnswerDue(
      {
        enabled: true,
        streaming,
        lines,
        lastAutoAt: lastAuto.at,
        lastAutoLineEnd: lastAuto.lineEnd,
      },
      now,
    ) as { id: string; tEnd: number } | null;
    if (!due) return;
    lastAuto = { at: now, lineEnd: due.tEnd };
    const fresh = lines.filter((line) => !answered.has(line.id));
    let picked = logic.pickQuestion(fresh);
    let partOfLines = fresh.length !== lines.length;
    if (picked.kind === 'none' && partOfLines) {
      picked = logic.pickQuestion(lines);
      partOfLines = false;
    }
    if (picked.kind !== 'question') return;
    const span = logic.themSpan(lines, picked.selected.lineIds);
    const decision = guard.decide({
      question: picked.selected.text,
      streaming,
      now,
      ...(span ? { span } : {}),
      auto: true,
      ...(picked.lookedBack ? { lookedBack: true } : {}),
    });
    if (decision.kind !== 'answer') return;
    const id = send(picked.selected.lineIds);
    if (span) guard.remember(span, id, now);
  };

  const end = sorted.at(-1)!.arrivedAt + (options.tailMs ?? 15_000);
  let index = 0;
  let nextTick = now;
  while (now <= end) {
    while (index < sorted.length && sorted[index]!.arrivedAt <= now) {
      const event = sorted[index]!;
      index += 1;
      if (event.type === 'partial') {
        transcript.addPartial(event.channel, event.text, event.tStart);
        continue;
      }
      if (event.type === 'refine') {
        // As refine.ts: the new words replace the live ones, and the line is no longer being rewritten.
        const target = event.tEnd === undefined ? undefined : refining.get(event.tEnd);
        if (target) {
          transcript.refineFinal?.(target.id, target.heard, event.text);
          transcript.setRefining?.(target.id, false);
        }
        continue;
      }
      if (event.type === 'turn') {
        // As LivePage.tsx: the judgment reaches the line it was made for.
        const lineId = event.speechEnd === undefined ? undefined : judging.get(event.speechEnd);
        if (lineId) transcript.setTurnEnd?.(lineId, event.probability ?? null);
        continue;
      }
      // As LivePage.tsx onFinal: v1.4 marks another language before adding the line.
      const nonEnglish =
        logic.looksNonEnglish?.({
          text: event.text,
          ...(event.confidence ? { confidence: event.confidence } : {}),
        }) ?? false;
      const added = transcript.addFinal({
        speaker: event.channel,
        text: event.text,
        tStart: event.tStart ?? event.arrivedAt,
        tEnd: event.tEnd ?? event.arrivedAt,
        ...(nonEnglish ? { nonEnglish: true } : {}),
      });
      // ADR-0066: as LivePage.tsx, a line the accurate engine will rewrite is marked meanwhile.
      if (
        event.tEnd !== undefined &&
        events.some((other) => other.type === 'refine' && other.tEnd === event.tEnd)
      ) {
        refining.set(event.tEnd, { id: added.id, heard: event.text });
        if (event.channel === 'them') transcript.setRefining?.(added.id, true);
      }
      // v1.4 (ADR-0065): a judgment is coming for this line (the page asks for every "them" final).
      if (
        event.channel === 'them' &&
        !nonEnglish &&
        event.speechEnd !== undefined &&
        transcript.setTurnEnd &&
        events.some((other) => other.type === 'turn' && other.speechEnd === event.speechEnd)
      ) {
        transcript.setTurnEnd(added.id, 'pending');
        judging.set(event.speechEnd, added.id);
      }
    }
    if (now >= nextTick) {
      tick();
      nextTick += tickMs;
    }
    now += 50;
  }

  const finals = transcript.allLines();
  const lines: MeasuredLine[] = finals.map((line) => ({
    id: line.id,
    speaker: line.speaker,
    text: line.text,
    tStart: line.tStart,
    tEnd: line.tEnd,
    hidden: Boolean(line.echo),
    nonEnglish: Boolean(line.nonEnglish),
  }));
  const shown = finals.filter((line) => !line.echo).map((line) => ({ ...line, final: true }));
  const turns = logic.mergeTurns(logic.groupLines(shown));
  return {
    lines,
    answers,
    themTurns: turns
      .filter((turn) => turn.speaker === 'them')
      .map((turn) => ({ start: turn.tStart, end: turn.tEnd })),
  };
}
