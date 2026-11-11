/**
 * File: apps/web/scripts/lib/real-call-replay.ts
 * Purpose: Replays what the speech worker heard during a real call (scripts/real-call.ts) through the app's own
 *          transcript, auto-answer and Answer-press code on a simulated clock, the way LivePage.tsx,
 *          useAutoAnswer.ts and useLiveAnswers.ts use them, with the presses the person really made, and scores
 *          the result against the call's question list (1.5.2, ADR-0070): which question each card answered,
 *          how soon, duplicate and small-talk cards, presses that answered the wrong question, grey-line
 *          delays, and the other side's words shown under "You".
 *          Two versions of the press code: 1.5.1's (rebuilt here from useLiveAnswers.ts ask(), with the app's
 *          own modules) and 1.5.2's (core/answer/pressQuestion.ts, called as it is), told apart by what the
 *          bundle exports, so the version before the fixes is measured with its own rules.
 * Used by: scripts/real-call.ts; tests/unit/scripts/real-call-replay.test.ts
 * Depends on: the app's modules, passed in as CallLogic (bundled from the version measured)
 * Architecture: docs/decisions/ADR-0070-right-question-right-time.md
 *
 * Only numbers leave this module: no line text is returned or printed.
 */
import type { CallEvent, CallLogic } from './call-replay';
import type { PageRun } from './worker-run';

/** One of the other side's lines in the truth file (seconds on the recording's clock). No text. */
export interface TruthLine {
  /** A label ('r1-q2'). */
  id: string;
  /** 'question', 'meta', 'greeting' or 'wrapup'. */
  kind: string;
  /** Start, s. */
  start: number;
  /** End, s. */
  end: number;
}

/** The call's questions and other lines, on the recording's clock (seconds). No text. */
export interface RealCallTruth {
  /** The other side's lines. */
  them: TruthLine[];
  /** The presses the person made. */
  presses: PressPlan;
  /** From when auto-answer was on, s (default: all along). */
  autoFrom?: number;
}

/** Presses: when the key was pressed (seconds on the recording's clock). */
export type PressPlan = { at: number }[];

/** A card the replay put up (or a rerun on one). */
export interface ReplayCard {
  /** Its id. */
  id: string;
  /** 'hotkey' or 'auto'. */
  trigger: 'hotkey' | 'auto';
  /** When it was sent, s on the recording's clock. */
  sentAt: number;
  /** The speech it answered (Them lines, grey or final), s; null when none. */
  span: {
    /**
     *
     */
    start: number; /**
     *
     */
    end: number;
  } | null;
  /** The truth line it answered (most overlap), or null. */
  answers: string | null;
  /** How many times it was asked again on the same card. */
  reruns: number;
  /** For a press: the line it should have answered. */
  expected?: string | null;
}

/** The app's modules the 1.5.2 press code adds (absent in 1.5.1). */
interface PressModule {
  /** core/answer/pressQuestion.ts choosePress(). */
  choosePress: (input: Record<string, unknown>) => Record<string, unknown>;
}

/** The modules this replay needs beyond call-replay.ts's CallLogic. */
interface RealLogic extends CallLogic {
  /** core/transcript/questionKind.ts, whole. */
  questionKind: {
    /**
     *
     */
    lineKind: (text: string) => string;
  };
  /** core/answer/autoAnswer.ts continuationOf (exported with *). */
  continuationOf: (
    lines: readonly unknown[],
    last: Record<string, unknown>,
    withinMs: number,
    from: number,
  ) => { id: string; text: string }[];
  /** core/answer/autoAnswer.ts CONTINUE_WINDOW_MS. */
  CONTINUE_WINDOW_MS: number;
  /** 1.5.2 only. */
  pressQuestion?: PressModule;
}

/** A visible line, as the replay reads it. */
interface Line {
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
  /** True when hidden as an echo. */
  echo?: boolean;
}

/** Words both sides say on any call, left out of the cross-talk count. */
const SHARED_WORDS = new Set(
  'question questions there their about would could should which where these those thing things think really right great thanks'.split(
    ' ',
  ),
);

/** How long a card streams, ms (the real call: send → done 2.5–3.5 s with large documents). */
const STREAM_MS = 2_600;

/** How often auto-answer checks, ms (useAutoAnswer.ts AUTO_TICK_MS). */
const TICK_MS = 250;

/**
 * The p-th percentile of some numbers (nearest rank).
 *
 * @param values The numbers.
 * @param p      0–100.
 * @returns The percentile, or NaN for none.
 * Called from: scoreRealCall(); tests
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

/**
 * The truth line a span of speech belongs to: the one it overlaps most (a little slack for the engine's
 * line ends, which lag the speech).
 *
 * @param truth The truth lines.
 * @param span  The speech, s.
 * @returns The line's id, or null when it overlaps none.
 * Called from: scoreRealCall() (send); tests
 */
export function truthOf(
  truth: readonly TruthLine[],
  span: { start: number; end: number } | null,
): string | null {
  if (!span) return null;
  let best: { id: string; overlap: number } | null = null;
  for (const line of truth) {
    const overlap = Math.min(span.end, line.end + 1.5) - Math.max(span.start, line.start - 0.5);
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { id: line.id, overlap };
  }
  return best?.id ?? null;
}

/**
 * The line a press at a time should answer: the newest real question started before it (being asked or
 * just asked); meta, greetings and wrap-up are passed over (a press on "can you repeat that?" means the
 * question before it).
 *
 * @param truth The truth lines.
 * @param at    The press, s.
 * @returns The line's id, or null.
 * Called from: scoreRealCall() (send); tests
 */
export function expectedFor(truth: readonly TruthLine[], at: number): string | null {
  const before = truth.filter((line) => line.start < at && line.kind === 'question');
  return before.at(-1)?.id ?? null;
}

/**
 * Words of a text, lower case, without punctuation.
 *
 * @param text Any text.
 * @returns The words.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Edit distance between a hypothesis and the best-matching stretch of a reference (free start and end in
 * the reference): how a line read aloud from a longer text is scored.
 *
 * @param hyp The words heard.
 * @param ref The reference words.
 * @returns Errors (substitutions, insertions, deletions) and the length of the stretch matched.
 * Called from: readingWer(); tests
 */
export function substringErrors(
  hyp: readonly string[],
  ref: readonly string[],
): { errors: number; refLength: number } {
  // dp[i][j]: best cost aligning hyp[0..i) with a stretch of ref ending at j (any start).
  const width = ref.length + 1;
  let prev = new Array<number>(width).fill(0);
  let prevLen = new Array<number>(width).fill(0);
  for (let i = 1; i <= hyp.length; i += 1) {
    const cur = new Array<number>(width).fill(0);
    const curLen = new Array<number>(width).fill(0);
    cur[0] = i;
    curLen[0] = 0;
    for (let j = 1; j < width; j += 1) {
      const sub = prev[j - 1]! + (hyp[i - 1] === ref[j - 1] ? 0 : 1);
      const del = cur[j - 1]! + 1; // a reference word not heard
      const ins = prev[j]! + 1; // a word heard that is not in the reference
      if (sub <= del && sub <= ins) {
        cur[j] = sub;
        curLen[j] = prevLen[j - 1]! + 1;
      } else if (ins <= del) {
        cur[j] = ins;
        curLen[j] = prevLen[j]!;
      } else {
        cur[j] = del;
        curLen[j] = curLen[j - 1]! + 1;
      }
    }
    prev = cur;
    prevLen = curLen;
  }
  let best = { errors: hyp.length, refLength: 0 };
  for (let j = 0; j < width; j += 1) {
    if (prev[j]! < best.errors) best = { errors: prev[j]!, refLength: prevLen[j]! };
  }
  return best;
}

/**
 * Word error rate of the user's own lines, against the texts they were reading aloud (the answer cards of
 * the real call): each line is matched to its best stretch of the text read last before it. Lines inside
 * the other side's speech (cross-talk is measured apart) and lines under five words are left out; "next
 * question", which the user said between answers, is not counted either way.
 *
 * @param lines     The user's lines: words and start, s on the recording's clock.
 * @param reference The texts read: words and when they appeared, s.
 * @param them      The other side's lines (truth), to leave out overlapping lines.
 * @returns WER (0–1), the lines scored and the reference words matched.
 * Called from: scoreRealCall(); tests
 */
export function readingWer(
  lines: readonly { text: string; start: number; end: number }[],
  reference: readonly { text: string; at: number }[],
  them: readonly TruthLine[],
): { wer: number; lines: number; refWords: number } {
  const strip = (list: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < list.length; i += 1) {
      if (list[i] === 'next' && list[i + 1] === 'question') {
        i += 1;
        continue;
      }
      out.push(list[i]!);
    }
    return out;
  };
  let errors = 0;
  let refWords = 0;
  let scored = 0;
  for (const line of lines) {
    if (them.some((t) => line.start < t.end + 0.5 && line.end > t.start - 0.5)) continue;
    const hyp = strip(words(line.text));
    if (hyp.length < 5) continue;
    // The text being read: the newest card that appeared before the line started (and the one before it,
    // in case the person was still finishing it).
    const shown = reference.filter((ref) => ref.at <= line.start + 1).slice(-2);
    if (shown.length === 0) continue;
    const ref = strip(shown.flatMap((item) => words(item.text)));
    const best = substringErrors(hyp, ref);
    errors += best.errors;
    refWords += Math.max(best.refLength, 1);
    scored += 1;
  }
  return { wer: errors / Math.max(1, refWords), lines: scored, refWords };
}

/**
 * Replays the call and scores it.
 *
 * @param run     The worker's messages (playThroughWorker()).
 * @param truth   The call's lines.
 * @param presses The presses (seconds on the recording's clock).
 * @param logic   The app's modules (the version measured).
 * @param reference The texts the user read aloud, with when they appeared (the "You" WER reference).
 * @returns The cards, the numbers and a printable report (numbers only).
 * Called from: scripts/real-call.ts; tests
 */
export function scoreRealCall(
  run: PageRun,
  truth: RealCallTruth,
  presses: PressPlan,
  logic: CallLogic,
  reference: readonly { text: string; at: number }[] = [],
): { report: string; cards: ReplayCard[]; metrics: Record<string, number | string> } {
  const app = logic as RealLogic;
  const t0 = run.startedAt;
  const toSec = (unix: number) => (unix - t0) / 1000;
  const events: CallEvent[] = [...run.events].sort((a, b) => a.arrivedAt - b.arrivedAt);
  let now = t0;
  const transcript = app.createTranscript(() => now, { schedule: () => () => undefined });
  const guard = app.createRepeatGuard();
  const answered = new Set<string>();
  const cards: ReplayCard[] = [];
  let streamingUntil = 0;
  let last: Record<string, unknown> | null = null;
  const acted = new Set<string>();
  const refining = new Map<number, { id: string; heard: string }>();
  const judging = new Map<number, string>();
  let nextId = 1;
  // 1.5.2 (ADR-0070): a press waiting for the question, and when the last answer stopped streaming.
  const waiting: {
    current: {
      /**
       *
       */
      since: number;
    } | null;
  } = { current: null };
  let idleSince: number | null = null;
  const autoFrom = t0 + (truth.autoFrom ?? 0) * 1000;
  const pressTimes = presses.map((press) => t0 + press.at * 1000).sort((a, b) => a - b);
  let pressIndex = 0;

  /**
   * Records a card (or a rerun on one).
   *
   * @param trigger  What asked.
   * @param lines    The visible lines now.
   * @param lineIds  The lines of its question.
   * @param replaces The card it replaces, if any.
   * @returns The card's id.
   */
  const send = (
    trigger: 'hotkey' | 'auto',
    lines: readonly Line[],
    lineIds: readonly string[],
    replaces?: string,
  ): string => {
    const span = app.themSpan(lines, lineIds);
    const spanSec = span ? { start: toSec(span.start), end: toSec(span.end) } : null;
    const existing = replaces ? cards.find((card) => card.id === replaces) : undefined;
    if (existing) {
      existing.reruns += 1;
      existing.span = spanSec;
      existing.answers = truthOf(truth.them, spanSec);
      streamingUntil = now + STREAM_MS;
      return existing.id;
    }
    const id = `c${nextId++}`;
    cards.push({
      id,
      trigger,
      sentAt: toSec(now),
      span: spanSec,
      answers: truthOf(truth.them, spanSec),
      reruns: 0,
      ...(trigger === 'hotkey' ? { expected: expectedFor(truth.them, toSec(now)) } : {}),
    });
    streamingUntil = now + STREAM_MS;
    return id;
  };

  /**
   * One Answer, as useLiveAnswers.ts ask('answer') does it (1.5.1, rebuilt; or 1.5.2's choosePress()).
   *
   * @param options.auto     Auto-answer's decision, when it asks.
   * @param options.lineIds  Auto-answer's lines.
   * @param options.replaces The card a rerun replaces.
   */
  const ask = (
    options: { auto?: boolean; lineIds?: string[]; replaces?: string; waitingSince?: number } = {},
  ) => {
    const lines = transcript.lines() as unknown as Line[];
    const streaming = now < streamingUntil;
    const trigger = options.auto ? 'auto' : 'hotkey';
    let pickedIds: string[] | null = null;
    let replaces = options.replaces;
    let lookedBack = false;
    let grey = false;
    const resolved = resolvedState();
    if (app.pressQuestion && !options.lineIds) {
      // 1.5.2: the press decision is the app's own pure function.
      const choice = app.pressQuestion.choosePress({
        lines,
        answeredLineIds: resolved.answeredLineIds,
        last: resolved.last,
        now,
        waitingSince: options.waitingSince ?? null,
      }) as {
        kind: string;
        lineIds?: string[];
        replaces?: string;
        lookedBack?: boolean;
        grey?: boolean;
      };
      // REAL_CALL_DEBUG=1: each press's decision (kinds and times only).
      if (process.env.REAL_CALL_DEBUG && options.waitingSince === undefined) {
        console.log(
          `press ${toSec(now).toFixed(1)}: ${choice.kind}${choice.lookedBack ? ' (looked back)' : ''}`,
        );
      }
      if (choice.kind === 'wait') {
        waiting.current = { since: options.waitingSince ?? now };
        return;
      }
      waiting.current = null;
      if (choice.kind !== 'answer') return;
      pickedIds = choice.lineIds ?? [];
      replaces = choice.replaces;
      lookedBack = choice.lookedBack ?? false;
      grey = Boolean(choice.grey);
    } else if (options.lineIds) {
      pickedIds = lines.filter((line) => options.lineIds!.includes(line.id)).map((l) => l.id);
      if (pickedIds.length === 0) return;
    } else {
      if (!lines.some((line) => line.speaker === 'them')) return;
      const more = last
        ? app.continuationOf(lines, last, app.CONTINUE_WINDOW_MS, last.end as number)
        : [];
      if (
        last &&
        more.length > 0 &&
        app.questionKind.lineKind(more.map((line) => line.text.trim()).join(' ')) === 'statement'
      ) {
        const lastIds = last.lineIds as string[];
        pickedIds = lines
          .filter((line) => lastIds.includes(line.id) || more.some((m) => m.id === line.id))
          .map((line) => line.id);
        replaces = last.answerId as string;
      } else {
        const fresh = lines.filter((line) => !answered.has(line.id));
        let partOfLines = fresh.length !== lines.length;
        let picked = app.pickQuestion(fresh, { allowStatement: !partOfLines });
        if (picked.kind === 'none' && partOfLines) {
          picked = app.pickQuestion(lines);
          partOfLines = false;
        }
        // A first garbled press only shows a notice (a second one on the same words would send them).
        if (picked.kind !== 'question') return;
        pickedIds = picked.selected.lineIds;
        lookedBack = picked.lookedBack ?? false;
      }
    }
    const span = app.themSpan(lines, pickedIds);
    const text = lines
      .filter((line) => pickedIds!.includes(line.id))
      .map((line) => line.text)
      .join(' ');
    if (!replaces) {
      const decision = guard.decide({
        question: text,
        streaming,
        now,
        ...(span ? { span } : {}),
        ...(options.auto ? { auto: true } : {}),
        ...(lookedBack ? { lookedBack: true } : {}),
      });
      if (process.env.REAL_CALL_DEBUG && decision.kind !== 'answer') {
        console.log(`  ${trigger} at ${toSec(now).toFixed(1)}: guard ${decision.kind}`);
      }
      if (decision.kind !== 'answer') return;
    }
    const id = send(trigger, lines, pickedIds, replaces);
    for (const lineId of pickedIds) answered.add(lineId);
    if (span) {
      guard.remember(span, id, now);
      last = {
        answerId: id,
        lineIds: pickedIds,
        end: span.end,
        askedAt: now,
        auto: Boolean(options.auto),
        ...(grey && !options.auto ? { grey: true } : {}),
        words: text.trim().split(/\s+/).filter(Boolean).length,
      };
    }
  };

  /**
   * What was answered, by the ids the lines have now (1.5.2 transcripts resolve a grey line's id).
   *
   * @returns The answered ids and the latest answered question.
   */
  function resolvedState(): { answeredLineIds: Set<string>; last: Record<string, unknown> | null } {
    const resolve = (id: string) =>
      (transcript as unknown as { resolveId?: (id: string) => string }).resolveId?.(id) ?? id;
    const ids = new Set<string>();
    for (const id of answered) {
      ids.add(id);
      ids.add(resolve(id));
    }
    return {
      answeredLineIds: ids,
      last: last
        ? { ...last, lineIds: [...new Set((last.lineIds as string[]).map(resolve))] }
        : null,
    };
  }

  const endAt = (events.at(-1)?.arrivedAt ?? t0) + 15_000;
  let index = 0;
  let nextTick = t0;
  while (now <= endAt) {
    const eventsBefore = index;
    while (index < events.length && events[index]!.arrivedAt <= now) {
      const event = events[index]!;
      index += 1;
      if (event.type === 'partial') {
        transcript.addPartial(event.channel, event.text, event.tStart);
        continue;
      }
      // 1.5.2 (ADR-0070): the pause and its early judgment go on the grey line, as LivePage.tsx does.
      const withPauses = transcript as unknown as {
        notePause?: (speaker: string, speechEnd: number) => void;
        setPauseTurn?: (speaker: string, speechEnd: number, value: number | null) => void;
      };
      if (event.type === 'pause') {
        if (event.speechEnd !== undefined) withPauses.notePause?.('them', event.speechEnd);
        continue;
      }
      if (event.type === 'resume') {
        if (event.channel === 'them') {
          (transcript as unknown as { clearPause?: (speaker: string) => void }).clearPause?.(
            'them',
          );
        }
        continue;
      }
      if (event.type === 'punct') {
        // As LivePage.tsx: the punctuation model's reading of a line that still has those words.
        const target = (transcript.lines() as unknown as Line[]).findLast(
          (line) => line.speaker === 'them' && line.text === event.words,
        );
        const marked = transcript as unknown as {
          setPunctuated?: (id: string, words: string, punctuated: string) => void;
        };
        if (target && event.words) marked.setPunctuated?.(target.id, event.words, event.text);
        continue;
      }
      if (event.type === 'turn-early') {
        if (event.speechEnd !== undefined) {
          withPauses.setPauseTurn?.('them', event.speechEnd, event.probability ?? null);
        }
        continue;
      }
      if (event.type === 'refine') {
        const target = event.tEnd === undefined ? undefined : refining.get(event.tEnd);
        if (target && event.channel === 'them') {
          transcript.refineFinal?.(target.id, target.heard, event.text);
          transcript.setRefining?.(target.id, false);
        }
        continue;
      }
      if (event.type === 'turn') {
        const lineId = event.speechEnd === undefined ? undefined : judging.get(event.speechEnd);
        if (lineId) transcript.setTurnEnd?.(lineId, event.probability ?? null);
        continue;
      }
      const nonEnglish =
        app.looksNonEnglish?.({
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
      if (event.channel === 'them' && event.tEnd !== undefined) {
        const refined = events.some(
          (other) =>
            other.type === 'refine' && other.channel === 'them' && other.tEnd === event.tEnd,
        );
        if (refined) {
          refining.set(event.tEnd, { id: added.id, heard: event.text });
          transcript.setRefining?.(added.id, true);
        }
      }
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
    while (pressIndex < pressTimes.length && pressTimes[pressIndex]! <= now) {
      pressIndex += 1;
      ask();
    }
    // A press waiting for the question is tried again as the transcript changes (here: every step).
    if (waiting.current) ask({ waitingSince: waiting.current.since });
    if (
      streamingUntil > 0 &&
      now >= streamingUntil &&
      (idleSince === null || idleSince < streamingUntil)
    ) {
      idleSince = streamingUntil;
    }
    // 1.5.2 (useAutoAnswer.ts): checked on a tick and whenever the transcript changed (1.5.1: tick only).
    const changedNow = index > eventsBefore && Boolean(app.pressQuestion);
    if (now >= nextTick || changedNow) {
      if (now >= nextTick) nextTick += TICK_MS;
      // 1.5.2: the check runs with auto-answer off too (a press on grey words is asked again on its card).
      if (now >= autoFrom || app.pressQuestion) {
        const lines = transcript.lines();
        const resolved = resolvedState();
        const due = app.autoAnswerDue(
          {
            enabled: now >= autoFrom,
            streaming: now < streamingUntil,
            lines,
            answeredLineIds: resolved.answeredLineIds,
            last: resolved.last,
            idleSince,
          },
          now,
        ) as {
          kind: 'answer' | 'rerun';
          lineIds: string[];
          tEnd: number;
          replaces?: string;
        } | null;
        if (due) {
          const key = `${due.kind}:${due.lineIds.join(',')}:${due.tEnd}`;
          if (!acted.has(key)) {
            acted.add(key);
            // A rerun of a press on grey words stays a press (useLiveAnswers.ts autoAnswer).
            const latest = resolvedState().last;
            const pressRerun = due.kind === 'rerun' && latest !== null && latest.auto === false;
            ask({
              ...(pressRerun ? {} : { auto: true }),
              lineIds: due.lineIds,
              ...(due.kind === 'rerun' && due.replaces ? { replaces: due.replaces } : {}),
            });
          }
        }
      }
    }
    now += 50;
  }

  // ---- Scores (numbers only) ----
  const questions = truth.them.filter((line) => line.kind === 'question');
  const byQuestion = new Map<string, ReplayCard[]>();
  for (const card of cards) {
    if (!card.answers) continue;
    byQuestion.set(card.answers, [...(byQuestion.get(card.answers) ?? []), card]);
  }
  const autoDelays: number[] = [];
  const anyDelays: number[] = [];
  let unanswered = 0;
  const perQuestion: string[] = [];
  for (const question of questions) {
    const got = byQuestion.get(question.id) ?? [];
    const first = got[0];
    if (!first) {
      unanswered += 1;
      perQuestion.push(`${question.id}: none`);
      continue;
    }
    const delay = first.sentAt - question.end;
    anyDelays.push(delay);
    if (first.trigger === 'auto') autoDelays.push(delay);
    perQuestion.push(
      `${question.id}: ${first.trigger} +${delay.toFixed(1)} s${got.length > 1 ? ` (${got.length} cards)` : ''}`,
    );
  }
  const duplicates = [...byQuestion.values()].reduce(
    (sum, list) => sum + Math.max(0, list.length - 1),
    0,
  );
  const nonQuestionCards = cards.filter((card) => {
    const kind = truth.them.find((line) => line.id === card.answers)?.kind;
    return kind !== undefined && kind !== 'question';
  }).length;
  const pressCards = cards.filter((card) => card.trigger === 'hotkey');
  const rightPresses = pressCards.filter((card) => card.answers === card.expected).length;

  // Grey lines: first "them" partial for each truth line, after its start.
  const greyDelays: number[] = [];
  const finalDelays: number[] = [];
  for (const line of truth.them) {
    const startUnix = t0 + line.start * 1000;
    const endUnix = t0 + line.end * 1000;
    const grey = events.find(
      (event) =>
        event.type === 'partial' &&
        event.channel === 'them' &&
        event.text.trim() !== '' &&
        event.arrivedAt >= startUnix &&
        event.arrivedAt <= endUnix + 3_000,
    );
    if (grey) greyDelays.push((grey.arrivedAt - startUnix) / 1000);
    const final = events.find(
      (event) =>
        event.type === 'final' &&
        event.channel === 'them' &&
        (event.tEnd ?? 0) >= startUnix &&
        event.arrivedAt >= endUnix - 500,
    );
    if (final) finalDelays.push((final.arrivedAt - endUnix) / 1000);
  }

  // The other side's words under "You": shown "you" words that the other side said within ±1.5 s.
  const all = transcript.allLines() as unknown as Line[];
  const themLines = all.filter((line) => line.speaker === 'them');
  let youWords = 0;
  let crossWords = 0;
  let crossLines = 0;
  for (const line of all.filter((l) => l.speaker === 'you' && !l.echo)) {
    // Words of the card being read aloud then are the user's own, even when the question had them too.
    const reading = new Set(
      reference
        .filter((ref) => ref.at <= toSec(line.tStart) + 1)
        .slice(-2)
        .flatMap((ref) => words(ref.text)),
    );
    // Content words only: "next question" is said by both people on this call, and short common words
    // match by chance.
    const lineWords = words(line.text).filter(
      (word) => word.length >= 5 && !reading.has(word) && !SHARED_WORDS.has(word),
    );
    youWords += lineWords.length;
    const near = new Set(
      themLines
        .filter((them) => them.tStart <= line.tEnd + 1_500 && them.tEnd >= line.tStart - 1_500)
        .flatMap((them) => words(them.text)),
    );
    // A word counts only when it is not a common short word and the other side said it then.
    const matched = lineWords.filter((word) => near.has(word)).length;
    const longWords = lineWords.length;
    if (longWords > 0 && matched / longWords >= 0.5) crossLines += 1;
    crossWords += matched;
  }

  // The user's own words: the live engine's lines, and the accurate engine's rewrite after the call.
  const youFinals = events.filter((event) => event.type === 'final' && event.channel === 'you');
  const liveYou = youFinals.map((event) => ({
    text: event.text,
    start: toSec(event.tStart ?? event.arrivedAt),
    end: toSec(event.tEnd ?? event.arrivedAt),
  }));
  const accurateYou = events
    .filter((event) => event.type === 'refine' && event.channel === 'you')
    .flatMap((event) => {
      const final = youFinals.find((f) => f.tEnd === event.tEnd);
      return final
        ? [
            {
              text: event.text,
              start: toSec(final.tStart ?? final.arrivedAt),
              end: toSec(final.tEnd ?? final.arrivedAt),
            },
          ]
        : [];
    });
  const werLive = readingWer(liveYou, reference, truth.them);
  const werAccurate = readingWer(accurateYou, reference, truth.them);

  const fmt = (value: number) => (Number.isNaN(value) ? '—' : value.toFixed(1));
  const metrics: Record<string, number | string> = {
    questions: questions.length,
    unanswered,
    duplicates,
    nonQuestionCards,
    cards: cards.length,
    presses: pressCards.length,
    rightPresses,
    autoSentP50: percentile(autoDelays, 50),
    autoSentP95: percentile(autoDelays, 95),
    anySentP50: percentile(anyDelays, 50),
    greyP50: percentile(greyDelays, 50),
    greyP95: percentile(greyDelays, 95),
    finalP50: percentile(finalDelays, 50),
    finalP95: percentile(finalDelays, 95),
    youWords,
    crossWords,
    crossLines,
    youWerLive: werLive.wer,
    youWerAccurate: werAccurate.wer,
    youWerLines: werLive.lines,
  };
  const report = [
    `| Measure | Value |`,
    `|---|---|`,
    `| Questions without a card | ${unanswered} of ${questions.length} |`,
    `| Duplicate cards / cards for non-questions | ${duplicates} / ${nonQuestionCards} |`,
    `| Presses that answered the right question | ${rightPresses} of ${pressCards.length} |`,
    `| Question end → auto-answer sent p50 / p95 | ${fmt(percentile(autoDelays, 50))} / ${fmt(percentile(autoDelays, 95))} s (${autoDelays.length}) |`,
    `| Them speech → first grey words p50 / p95 | ${fmt(percentile(greyDelays, 50))} / ${fmt(percentile(greyDelays, 95))} s |`,
    `| Them speech end → final line p50 / p95 | ${fmt(percentile(finalDelays, 50))} / ${fmt(percentile(finalDelays, 95))} s |`,
    `| "You" WER while reading answers aloud: live / Accurate after the call | ${reference.length === 0 ? '—' : `${(100 * werLive.wer).toFixed(1)}% (${werLive.lines} lines) / ${(100 * werAccurate.wer).toFixed(1)}% (${werAccurate.lines} lines)`} |`,
    `| "You" words that the other side said (cross-talk) | ${crossWords} of ${youWords} (${((100 * crossWords) / Math.max(1, youWords)).toFixed(1)}%); lines mostly theirs: ${crossLines} |`,
    '',
    perQuestion.join('\n'),
  ].join('\n');
  return { report, cards, metrics };
}
