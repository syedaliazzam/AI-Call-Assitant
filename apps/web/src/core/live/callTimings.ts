/**
 * File: apps/web/src/core/live/callTimings.ts
 * Purpose: The device-side call timing log (1.5.1, ADR-0069): ids and times only, for the re-test of the
 *          call-latency fixes with a real call. During a call it records when the other side's lines
 *          arrived (first grey words, final line) against when they were spoken, the speech worker's
 *          backlog each second, what Accurate did with each line, each answer's trigger and timings (key
 *          press or question end → request sent → first word → done), and the call notices. At End the
 *          call is kept in this browser profile's localStorage, per account (the last MAX_CALLS calls) and can be
 *          downloaded from Settings as JSON with a summary (p50 / p95).
 *          Never any text: no words, no questions, no answers, no audio, no device names.
 *          ADR-0076 (investigation T0.1): with Settings → Transcription → "Timing trace" on (this device only,
 *          off by default), each call also keeps a list of timed events (trace): the capture clock, the
 *          speech engine of each line, Deepgram's sockets and turn events, failovers, every key press and
 *          what it decided, the request's phases with the server's timings and cache token counts, and the
 *          page's load. Codes, counts and times only.
 * Used by: src/features/live/LivePage.tsx, src/features/live/useLiveAnswers.ts,
 *          src/features/settings/CallTimingLog.tsx
 * Depends on: localStorage (missing or blocked: the log stays in memory for this page only);
 *             src/core/storage/accountScope.ts (the signed-in account: the log is kept per account)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing); ADR-0069
 */
import type { AnswerModel } from '@kite/shared';
import { currentAccountId } from '../storage/accountScope';
import type { BacklogInfo } from '../stt/protocol';

/**
 * localStorage key prefix of the saved calls. The log is kept per account ('kite.callTimings.<id>'):
 * its call and session ids belong to the account that made the calls (privacy fix of 14 Nov 2026). The
 * old log under this exact key, from before that fix, has no owner recorded: it is never read again
 * (and never deleted).
 */
export const CALL_TIMINGS_KEY = 'kite.callTimings';

/**
 * The localStorage key of one account's saved calls.
 *
 * @param accountId The account's id.
 * @returns 'kite.callTimings.<id>'.
 * Called from: the localStorage store below; tests
 */
export function callTimingsKey(accountId: string): string {
  return `${CALL_TIMINGS_KEY}.${accountId}`;
}

/** How many calls are kept. */
export const MAX_CALLS = 5;

/** ADR-0076: localStorage key of the "Timing trace" switch ('1' = on). */
export const TRACE_KEY = 'kite.trace';

/** ADR-0076: the most trace events kept per call. */
export const MAX_TRACE_EVENTS = 6_000;

/** ADR-0076: one trace value: a number, a short code or a flag (never words). */
export type TraceField = number | string | boolean | null;

/** ADR-0076: one trace event: [Unix ms, kind, fields]. */
export type TraceEvent = [number, string, Record<string, TraceField>];

/**
 * ADR-0076: whether "Timing trace" is on for this device.
 *
 * @returns True when switched on.
 * Called from: createCallTimings() (start), CallTimingLog.tsx
 */
export function traceEnabled(): boolean {
  try {
    return localStorage.getItem(TRACE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * ADR-0076: switches "Timing trace" on or off for this device (from the next call).
 *
 * @param on True to record the trace.
 * Called from: CallTimingLog.tsx
 */
export function setTraceEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(TRACE_KEY, '1');
    else localStorage.removeItem(TRACE_KEY);
  } catch {
    // Storage blocked: the switch cannot be kept; calls go on without the trace.
  }
}

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
  | 'reanswer'
  // 1.5.2 (ADR-0070): a press's card asked again because the person went on.
  | 'rerun'
  // ADR-0101: a voice question (Ctrl+Shift+Space, Voice mode), and one with a screenshot (Ctrl+Alt+Enter).
  | 'voice'
  | 'voice-screenshot'
  // ADR-0123: the user's own spoken question: Ctrl+Enter on your own, and Ctrl+Shift+Space.
  | 'own-question'
  | 'own-question-key';

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
  /** ADR-0076: which engine wrote it: 'deepgram' or 'local' (absent before ADR-0076). */
  engine?: string;
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
  /** 1.5.2 (ADR-0070): the question's words were still grey when it was asked. */
  grey?: boolean;
  /** 1.5.2: auto-answer asked at the pause, before the line was final (the end-of-turn model). */
  early?: boolean;
  /** 1.5.2: the card this request asked again (a rerun or a continuation), by its answer id. */
  rerunOf?: string;
  /** ADR-0076: the ids of the transcript lines asked (ids only). */
  lineIds?: string[];
  /** ADR-0076: the asked speech's span (capture clock), for the asked-vs-final word count. */
  span?: {
    /** Start (Unix ms). */
    start: number;
    /** End (Unix ms). */
    end: number;
  };
  /** ADR-0076: how many words were asked. */
  askedWords?: number;
  /** ADR-0076: how many words the same speech had by the end of the call. */
  finalWords?: number;
  /** ADR-0076: the press gave up waiting for the other side (the card says "may be incomplete"). */
  incomplete?: boolean;
  /** ADR-0076: the body was ready (after any gzip), Unix ms. */
  bodyReadyAt?: number;
  /** ADR-0076: fetch was called, Unix ms. */
  fetchAt?: number;
  /** ADR-0076: the response headers arrived, Unix ms. */
  headersAt?: number;
  /** ADR-0076: the hidden meta line arrived, Unix ms. */
  metaAt?: number;
  /** ADR-0076: the server's own timings (ms from receiving the request). */
  serverMs?: Record<string, number>;
  /** ADR-0076: prompt cache tokens read. */
  cacheRead?: number;
  /** ADR-0076: prompt cache tokens written. */
  cacheWrite?: number;
  /** ADR-0076: input tokens not from the cache. */
  inputTokens?: number;
  /**
   * Batch C (P1-1): a speculative auto-answer, sent at the end of turn and held hidden first ('cancelled'
   * status: the other person went on within the hold, and nothing was shown).
   */
  speculative?: boolean;
  /** Batch C (P2-1): how many document parts went with the question. */
  documentChunks?: number;
  /**
   * ADR-0094: the model tier that answered: the one asked for when it was sent, replaced by the server's
   * own when it finishes (an admin may have turned the deeper model off). The tier only, never a model name.
   * ADR-0095: 'groq' when Groq answered.
   */
  model?: AnswerModel;
  /**
   * ADR-0095: Groq was asked but Claude Haiku answered ('timeout': no first token within 4 s; 'error';
   * 'empty'). Absent otherwise.
   */
  fallback?: 'timeout' | 'error' | 'empty';
  /**
   * ADR-0099: the model that was asked when the answer fell back to Claude Haiku ('groq', or a Gemini or GPT
   * model). Absent in an older log, where a fallback was always Groq's.
   */
  fallbackFrom?: AnswerModel;
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
  /**
   * 1.5.2 (ADR-0070): the speech worker's echo canceller as it last reported: 'on', 'off' or 'failed'
   * (absent from logs before 1.5.2, or when the worker never reported it).
   */
  echoCancel?: string;
  /** ADR-0076: the speech engine of the call: 'local', 'deepgram' or 'mixed' (absent before ADR-0076). */
  engine?: string;
  /** ADR-0076: the timing trace (only with "Timing trace" on). */
  trace?: TraceEvent[];
}

/** Where saved calls are kept (tests pass a fake). */
export interface TimingStore {
  /** Reads the saved text, or null. */
  read: () => string | null;
  /** Saves the text. */
  write: (text: string) => void;
}

/**
 * localStorage, when it can be used, under the signed-in account's own key. Outside a signed-in page
 * (no account known) nothing is read or written: the log stays in memory for that page.
 */
const LOCAL_STORE: TimingStore = {
  read: () => {
    const accountId = currentAccountId();
    if (!accountId) return null;
    try {
      return localStorage.getItem(callTimingsKey(accountId));
    } catch {
      return null;
    }
  },
  write: (text) => {
    const accountId = currentAccountId();
    if (!accountId) return;
    try {
      localStorage.setItem(callTimingsKey(accountId), text);
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
 * @param max  The most entries kept (default MAX_ENTRIES).
 */
function capped<T>(list: T[], item: T, max: number = MAX_ENTRIES): void {
  list.push(item);
  if (list.length > max) list.shift();
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
  /** 1.5.2 (ADR-0070): notes the echo canceller's state ('on', 'off' or 'failed'). */
  noteEchoCancel: (state: string) => void;
  /** Notes what Accurate did with a line. */
  noteRefine: (lineId: string, outcome: string, at?: number) => void;
  /** Notes an answer being sent; later calls with the same id update it. */
  noteAnswer: (answer: Partial<AnswerTiming> & { answerId: string }) => void;
  /** Notes a call notice. */
  noteNotice: (kind: string, at?: number) => void;
  /**
   * ADR-0076: adds a trace event (only while a call runs with "Timing trace" on).
   *
   * @param kind   What happened ('socket-open', 'press', 'failover', …).
   * @param fields Numbers, codes and flags only.
   * @param at     When (default now).
   */
  noteTrace: (kind: string, fields?: Record<string, TraceField>, at?: number) => void;
  /** ADR-0076: whether this call records the trace. */
  tracing: () => boolean;
  /** ADR-0076: notes the call's speech engine ('local', 'deepgram'; a second kind makes it 'mixed'). */
  noteEngine: (engine: 'local' | 'deepgram') => void;
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
        // ADR-0076: the trace only when switched on for this device.
        ...(traceEnabled() ? { trace: [] } : {}),
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
    noteEchoCancel(state) {
      if (log) log.echoCancel = state;
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
      if (log?.trace) capped(log.trace, [at, 'notice', { kind }], MAX_TRACE_EVENTS);
    },
    noteTrace(kind, fields = {}, at = clock()) {
      if (log?.trace) capped(log.trace, [at, kind, fields], MAX_TRACE_EVENTS);
    },
    tracing: () => log?.trace !== undefined,
    noteEngine(engine) {
      if (!log) return;
      log.engine = log.engine === undefined || log.engine === engine ? engine : 'mixed';
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
  /** 1.5.2 (ADR-0070): every card, in order, with its moments and intervals. */
  cards: CardTiming[];
  /** ADR-0076: lines by engine ('deepgram', 'local'; 'unknown' before ADR-0076). */
  lineEngines: Record<string, number>;
  /** ADR-0076: channel switches in the trace (to the on-device engine and back). */
  failovers: number;
  /** ADR-0076: key presses by what they decided (from the trace). */
  pressDecisions: Record<string, number>;
  /** ADR-0076: key press → caught up, ms (from the trace). */
  pressWait: Percentiles;
  /** Batch C (P1-1): speculative auto-answers by what happened: sent, held, shown, cancelled (the trace). */
  speculative: Record<string, number>;
  /** Batch C (P1-6): the recording's frames per second, per 10 s sample (the trace). */
  recordingFps: Percentiles;
  /**
   * Batch D (ADR-0079): re-asks by why and where they went, as "reason/card" ("grew/same", "went-on/new")
   * (the trace).
   */
  reasks: Record<string, number>;
  /** Batch D (P0-A): Flux lines by what their start came from ('words', 'start-of-turn', 'first-words'). */
  fluxStarts: Record<string, number>;
}

/**
 * 1.5.2 (ADR-0070): one card's timings as the download shows them: moments in seconds since the call
 * started, intervals in ms (null when a moment is missing).
 */
export interface CardTiming {
  /** 1, 2, … in the order they were asked. */
  n: number;
  /** What asked: the key, a button, auto-answer, chat, a screenshot, a rerun… */
  trigger: string;
  /** 'grey' (asked on words still grey), 'early' (auto at the pause), 'rerun' (asked again on its card). */
  flags: string[];
  /** 'done', 'error', 'cancelled', 'none' (nothing to answer), or 'streaming' when the call ended first. */
  status: string;
  /** ADR-0094: the model that answered ('fast', 'smart' or, ADR-0095, 'groq'), or null in an older log. */
  model: AnswerModel | null;
  /** The end of the question's speech, s. */
  questionEnd: number | null;
  /** The key press or the decision, s. */
  asked: number;
  /** The request left the device, s. */
  sent: number;
  /** The first words arrived, s. */
  firstWord: number | null;
  /** The card was complete, s. */
  done: number | null;
  /** Question end → request sent. */
  endToSentMs: number | null;
  /** Question end → first word. */
  endToFirstWordMs: number | null;
  /** Key press (or decision) → first word. */
  askedToFirstWordMs: number | null;
  /** Request sent → first word (the network and Claude). */
  sentToFirstWordMs: number | null;
  /** First word → card complete. */
  firstWordToDoneMs: number | null;
}

/**
 * 1.5.2 (ADR-0070): the per-card table of a call.
 *
 * @param log The call's log.
 * @returns One row per request, in order.
 * Called from: summarizeCall(); tests
 */
export function cardTimings(log: CallTimingLog): CardTiming[] {
  const seconds = (at: number | null) =>
    at === null ? null : Math.round((at - log.startedAt) / 100) / 10;
  const between = (from: number | null, to: number | null) =>
    from === null || to === null ? null : Math.round(to - from);
  return log.answers.map((answer, index) => ({
    n: index + 1,
    trigger: answer.trigger,
    flags: [
      ...(answer.grey ? ['grey'] : []),
      ...(answer.early ? ['early'] : []),
      ...(answer.rerunOf ? ['rerun'] : []),
      // Batch C (P1-1): sent at the end of turn and held hidden first.
      ...(answer.speculative ? ['speculative'] : []),
      // ADR-0095: Groq was asked and Claude Haiku answered. ADR-0099: or a Gemini or GPT model.
      ...(answer.fallback ? [`${answer.fallbackFrom ?? 'groq'}-fallback-${answer.fallback}`] : []),
    ],
    status: answer.status,
    model: answer.model ?? null,
    questionEnd: seconds(answer.speechEnd),
    asked: seconds(answer.askedAt)!,
    sent: seconds(answer.sentAt)!,
    firstWord: seconds(answer.firstWordAt),
    done: seconds(answer.doneAt),
    endToSentMs: between(answer.speechEnd, answer.sentAt),
    endToFirstWordMs: between(answer.speechEnd, answer.firstWordAt),
    askedToFirstWordMs: between(answer.askedAt, answer.firstWordAt),
    sentToFirstWordMs: between(answer.sentAt, answer.firstWordAt),
    firstWordToDoneMs: between(answer.firstWordAt, answer.doneAt),
  }));
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
    cards: cardTimings(log),
    lineEngines: count(log.lines.map((line) => line.engine ?? 'unknown')),
    failovers: (log.trace ?? []).filter(([, kind]) => kind === 'failover').length,
    pressDecisions: count(
      (log.trace ?? [])
        .filter(([, kind]) => kind === 'press-decision')
        .map(([, , fields]) => String(fields.decision)),
    ),
    pressWait: percentiles(
      (log.trace ?? [])
        .filter(([, kind, fields]) => kind === 'press-wait' && typeof fields.waitedMs === 'number')
        .map(([, , fields]) => fields.waitedMs as number),
    ),
    speculative: count(
      (log.trace ?? [])
        .filter(([, kind]) => kind === 'speculative')
        .map(([, , fields]) => String(fields.state)),
    ),
    recordingFps: percentiles(
      (log.trace ?? [])
        .filter(([, kind, fields]) => kind === 'rec-frames' && typeof fields.fps === 'number')
        .map(([, , fields]) => fields.fps as number),
    ),
    reasks: count(
      (log.trace ?? [])
        .filter(([, kind]) => kind === 'reask')
        .map(([, , fields]) => `${String(fields.reason)}/${String(fields.card)}`),
    ),
    fluxStarts: count(
      (log.trace ?? [])
        .filter(([, kind]) => kind === 'flux-start')
        .map(([, , fields]) => String(fields.source)),
    ),
  };
}
