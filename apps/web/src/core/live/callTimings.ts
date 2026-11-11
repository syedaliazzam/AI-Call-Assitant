/**
 * File: apps/web/src/core/live/callTimings.ts
 * Purpose: The device-side call timing log (1.5.1, ADR-0069): ids and times only, for the re-test of the
 *          call-latency fixes with a real call. During a call it records when the other side's lines
 *          arrived (first grey words, final line) against when they were spoken, the speech worker's
 *          backlog each second, what Accurate did with each line, each answer's trigger and timings (key
 *          press or question end → request sent → first word → done), and the call notices. At End the
 *          call is kept in this browser profile's localStorage (the last MAX_CALLS calls) and can be
 *          downloaded from Settings as JSON with a summary (p50 / p95).
 *          Never any text: no words, no questions, no answers, no audio, no device names.
 * Used by: src/features/live/LivePage.tsx, src/features/live/useLiveAnswers.ts,
 *          src/features/settings/CallTimingLog.tsx
 * Depends on: localStorage (missing or blocked: the log stays in memory for this page only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing); ADR-0069
 */
import type { BacklogInfo } from '../stt/protocol';

/** localStorage key of the saved calls. */
export const CALL_TIMINGS_KEY = 'kite.callTimings';

/** How many calls are kept. */
export const MAX_CALLS = 5;

/** The most entries of each kind kept per call (a long call stays small). */
const MAX_ENTRIES = 2_000;

/** What started an answer. */
export type AnswerTrigger =
  | 'hotkey'
  | 'button'
  | 'auto'
  | 'answer-this'
  | 'chat'
  | 'screenshot-hotkey'
  | 'screenshot-button'
  | 'screenshot-chat'
  | 'reanswer';

/** One line of the other side (times are Unix ms). */
export interface LineTiming {
  /** The live line's id ('u12'). */
  id: string;
  /** "you" or "them". */
  speaker: 'you' | 'them';
  /** When the speech started (capture time). */
  tStart: number;
  /** When the speech ended (capture time). */
  tEnd: number;
  /** When the first grey words of this line reached the page, if seen. */
  partialAt: number | null;
  /** When the final line reached the page. */
  finalAt: number;
}

/** One answer (times are Unix ms). */
export interface AnswerTiming {
  /** The answer's id. */
  answerId: string;
  /** What started it. */
  trigger: AnswerTrigger;
  /** 'answer', 'chat' or 'screenshot'. */
  mode: string;
  /** The key press or click (manual), or the decision (auto). */
  askedAt: number;
  /** End of the speech it answers (capture time), if it answers speech. */
  speechEnd: number | null;
  /** When the request was sent. */
  sentAt: number;
  /** When its first words arrived, or null. */
  firstWordAt: number | null;
  /** When it finished, or null. */
  doneAt: number | null;
  /** 'streaming', 'done', 'error', 'cancelled' or 'none' (nothing to answer). */
  status: string;
  /** How many times it was sent again after a slow start. */
  retries: number;
  /** Request size, bytes as sent. */
  bytes: number;
}

/** One Accurate decision (times are Unix ms). */
export interface RefineTiming {
  /** The line's id. */
  lineId: string;
  /** 'done', 'kept' (engine kept the live words), 'busy', 'replaced' or 'stale'. */
  outcome: string;
  /** When it was decided or finished. */
  at: number;
}

/** One call's log. */
export interface CallTimingLog {
  /** The session's id. */
  sessionId: string;
  /** When the call connected (Unix ms). */
  startedAt: number;
  /** When it ended, or null while running. */
  endedAt: number | null;
  /** 'desktop' or 'browser'. */
  platform: string;
  /** Whether Accurate ran in this call. */
  accurate: boolean;
  /** The recording type: 'off', 'audio' or 'screen'. */
  recording: string;
  /** Characters of documents in the session. */
  documentChars: number;
  /** Lines (finals), oldest first. */
  lines: LineTiming[];
  /** Answers, oldest first. */
  answers: AnswerTiming[];
  /** Accurate decisions. */
  refines: RefineTiming[];
  /** The speech worker's backlog once a second: [Unix ms, worst wait ms, state]. */
  backlog: [number, number, BacklogInfo['state']][];
  /** The other side's audio the worker skipped to catch up, ms (at the end). */
  droppedMs: number;
  /** The user's set-aside audio dropped because too much waited, ms (at the end). */
  deferredDroppedMs: number;
  /** Call notices shown: [Unix ms, kind]. */
  notices: [number, string][];
}

/** Where saved calls are kept (tests pass a fake). */
export interface TimingStore {
  /** Reads the saved text, or null. */
  read: () => string | null;
  /** Saves the text. */
  write: (text: string) => void;
}

/** localStorage, when it can be used. */
const LOCAL_STORE: TimingStore = {
  read: () => {
    try {
      return localStorage.getItem(CALL_TIMINGS_KEY);
    } catch {
      return null;
    }
  },
  write: (text) => {
    try {
      localStorage.setItem(CALL_TIMINGS_KEY, text);
    } catch {
      // Storage full or blocked: the log is only for testing; the call is unaffected.
    }
  },
};

/**
 * Keeps a list short by dropping the oldest entries.
 *
 * @param list The list.
 * @param item The new entry.
 */
function capped<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > MAX_ENTRIES) list.shift();
}

/** The recorder (one per page; one call at a time). */
export interface CallTimings {
  /**
   * Starts a call's log.
   *
   * @param info The call's id, platform and settings.
   */
  start: (
    info: Pick<
      CallTimingLog,
      'sessionId' | 'startedAt' | 'platform' | 'accurate' | 'recording' | 'documentChars'
    >,
  ) => void;
  /** Notes the first grey words of a channel's current line. */
  notePartial: (speaker: 'you' | 'them', at?: number) => void;
  /** Notes a final line (its grey-words time is taken from notePartial). */
  noteFinal: (line: Omit<LineTiming, 'partialAt' | 'finalAt'>, at?: number) => void;
  /** Notes the worker's backlog (kept once a second). */
  noteBacklog: (info: BacklogInfo, at?: number) => void;
  /** Notes what Accurate did with a line. */
  noteRefine: (lineId: string, outcome: string, at?: number) => void;
  /** Notes an answer being sent; later calls with the same id update it. */
  noteAnswer: (answer: Partial<AnswerTiming> & { answerId: string }) => void;
  /** Notes a call notice. */
  noteNotice: (kind: string, at?: number) => void;
  /** Ends the call and saves it; nothing happens without a started call. */
  end: (at?: number) => void;
  /** The current call's log, or null. */
  current: () => CallTimingLog | null;
  /** The saved calls, newest first. */
  saved: () => CallTimingLog[];
}

/**
 * Creates a recorder.
 *
 * @param store Where calls are saved (default localStorage).
 * @param clock The clock (default Date.now).
 * @returns The recorder.
 * Called from: this file (callTimings); tests
 */
export function createCallTimings(
  store: TimingStore = LOCAL_STORE,
  clock: () => number = Date.now,
): CallTimings {
  let log: CallTimingLog | null = null;
  const partialAt: Record<'you' | 'them', number | null> = { you: null, them: null };
  let lastBacklogSecond = 0;

  const saved = (): CallTimingLog[] => {
    try {
      const parsed = JSON.parse(store.read() ?? '[]') as unknown;
      return Array.isArray(parsed) ? (parsed as CallTimingLog[]) : [];
    } catch {
      return [];
    }
  };

  return {
    start(info) {
      log = {
        ...info,
        endedAt: null,
        lines: [],
        answers: [],
        refines: [],
        backlog: [],
        droppedMs: 0,
        deferredDroppedMs: 0,
        notices: [],
      };
      partialAt.you = null;
      partialAt.them = null;
      lastBacklogSecond = 0;
    },
    notePartial(speaker, at = clock()) {
      // The first grey words of the line only; cleared when the line becomes final.
      if (log && partialAt[speaker] === null) partialAt[speaker] = at;
    },
    noteFinal(line, at = clock()) {
      if (!log) return;
      capped(log.lines, { ...line, partialAt: partialAt[line.speaker], finalAt: at });
      partialAt[line.speaker] = null;
    },
    noteBacklog(info, at = clock()) {
      if (!log) return;
      log.droppedMs = info.droppedMs;
      log.deferredDroppedMs = info.deferredDroppedMs;
      const second = Math.floor(at / 1000);
      if (second === lastBacklogSecond) return;
      lastBacklogSecond = second;
      capped(log.backlog, [at, Math.max(info.lagMs, info.maxLagMs), info.state]);
    },
    noteRefine(lineId, outcome, at = clock()) {
      if (log) capped(log.refines, { lineId, outcome, at });
    },
    noteAnswer(answer) {
      if (!log) return;
      const existing = log.answers.find((item) => item.answerId === answer.answerId);
      if (existing) {
        Object.assign(existing, answer);
        return;
      }
      capped(log.answers, {
        trigger: 'hotkey',
        mode: 'answer',
        askedAt: clock(),
        speechEnd: null,
        sentAt: clock(),
        firstWordAt: null,
        doneAt: null,
        status: 'streaming',
        retries: 0,
        bytes: 0,
        ...answer,
      });
    },
    noteNotice(kind, at = clock()) {
      if (log) capped(log.notices, [at, kind]);
    },
    end(at = clock()) {
      if (!log) return;
      log.endedAt = at;
      const calls = [log, ...saved().filter((call) => call.startedAt !== log!.startedAt)].slice(
        0,
        MAX_CALLS,
      );
      store.write(JSON.stringify(calls));
      log = null;
    },
    current: () => log,
    saved,
  };
}

/** This page's recorder. */
export const callTimings = createCallTimings();

/** p50 and p95 of a list. */
export interface Percentiles {
  /** How many values. */
  n: number;
  /** Median, or null. */
  p50: number | null;
  /** 95th percentile, or null. */
  p95: number | null;
}

/**
 * The p50 and p95 of some numbers.
 *
 * @param values The numbers.
 * @returns n, p50, p95.
 * Called from: summarizeCall(); tests
 */
export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { n: 0, p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { n: values.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

/** The re-test numbers of one call (ms). */
export interface CallSummary {
  /** Them speech start → first grey words. */
  themFirstWords: Percentiles;
  /** Them speech end → final line. */
  themFinal: Percentiles;
  /** Key press → first word (manual answers to speech). */
  pressToFirstWord: Percentiles;
  /** Question end → first word (auto-answers). */
  autoToFirstWord: Percentiles;
  /** Key press → request sent. */
  pressToSent: Percentiles;
  /** The worker's worst wait each second. */
  backlog: Percentiles;
  /** Answers by trigger. */
  triggers: Record<string, number>;
  /** Notices shown, by kind. */
  notices: Record<string, number>;
}

/**
 * The re-test numbers of a call.
 *
 * @param log The call's log.
 * @returns The summary.
 * Called from: CallTimingLog.tsx (download); tests
 */
export function summarizeCall(log: CallTimingLog): CallSummary {
  const them = log.lines.filter((line) => line.speaker === 'them');
  const manual = log.answers.filter((a) => a.trigger !== 'auto' && a.firstWordAt !== null);
  const auto = log.answers.filter(
    (a) => a.trigger === 'auto' && a.firstWordAt !== null && a.speechEnd !== null,
  );
  const count = (keys: string[]) =>
    keys.reduce<Record<string, number>>((all, key) => ({ ...all, [key]: (all[key] ?? 0) + 1 }), {});
  return {
    themFirstWords: percentiles(
      them.filter((line) => line.partialAt !== null).map((line) => line.partialAt! - line.tStart),
    ),
    themFinal: percentiles(them.map((line) => line.finalAt - line.tEnd)),
    pressToFirstWord: percentiles(manual.map((a) => a.firstWordAt! - a.askedAt)),
    autoToFirstWord: percentiles(auto.map((a) => a.firstWordAt! - a.speechEnd!)),
    pressToSent: percentiles(
      log.answers.filter((a) => a.trigger !== 'auto').map((a) => a.sentAt - a.askedAt),
    ),
    backlog: percentiles(log.backlog.map(([, lag]) => lag)),
    triggers: count(log.answers.map((a) => a.trigger)),
    notices: count(log.notices.map(([, kind]) => kind)),
  };
}
