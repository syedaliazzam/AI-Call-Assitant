/**
 * File: apps/web/src/features/live/useLiveAnswers.ts
 * Purpose: React state for the answers of a live call: Answer (question from the transcript)
 *          and Chat (typed question) build a request from the session, the transcript and the
 *          earlier answers (core/answer/context.ts) and stream it (one at a time); Clear
 *          cancels; Previous/Next move through this call's answers, one entry per question
 *          (core/answer/history.ts, v1.0.4); the newest is selected unless another is chosen. Each
 *          finished answer is saved on this device with its rating and note (Stage 7). While the
 *          call runs, the idle re-warm keeps Claude's cache warm (core/answer/keepWarm.ts). v1.1.0
 *          (ADR-0043): Answer answers only real questions (core/transcript/questionKind.ts); this call's
 *          answers only (a session's earlier calls are in Review).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer (context.ts, answerClient.ts, history.ts, warm.ts, keepWarm.ts,
 *             unavailable.ts),
 *             src/core/transcript/transcript.ts, src/core/storage (answers.ts, types.ts)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §6.3; day-04-answers.md
 *               Stages 6–7
 *
 * Logs only ids, timings and token counts; never the question or answer text.
 */
'use client';

import {
  DEFAULT_SCREENSHOT_QUESTION,
  type AnswerMeta,
  type AnswerType,
  type AnswerUsage,
  type ModelTier,
  type TargetChoice,
} from '@kite/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAnswerRunner, type AnswerTimeline } from '@/core/answer/answerClient';
import { type AnsweredQuestion, type AutoDecision, wordCount } from '@/core/answer/autoAnswer';
import { settleAnswerType, type LabelledQuestion } from '@/core/answer/answerType';
import { mergeAnswers, stoppedEmpty } from '@/core/answer/history';
import { createRepeatGuard, themSpan, type SpeechSpan } from '@/core/answer/repeatGuard';
import { buildClaimCorpus, checkClaims, needsClaimCheck } from '@/core/answer/claimCheck';
import { buildAnswerRequest, emptyLog, type CallAnswer } from '@/core/answer/context';
import { startKeepWarm, type KeepWarm } from '@/core/answer/keepWarm';
import { warmSession } from '@/core/answer/warm';
import { answerFailureText, OFFLINE_TEXT, type AnswerProblem } from '@/core/answer/unavailable';
import { choosePress, PRESS_WAIT_MS } from '@/core/answer/pressQuestion';
import { pickQuestion, type PickedQuestion } from '@/core/transcript/questionKind';
import { isOnline } from '@/core/net/online';
import { prepareScreenshot } from '@/core/screenshot/prepare';
import { rateAnswer, reportAnswer, saveAnswer, setAnswerNote } from '@/core/storage/answers';
import type { AnswerRating, Session, StoredAnswer, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { callTimings, type AnswerTrigger } from '@/core/live/callTimings';
import { CaptureError } from '@/platform/errors';

/** Where answers are saved on this device (core/storage/answers.ts; tests may replace it). */
export interface AnswerStore {
  /** Saves a finished answer. */
  save: (answer: StoredAnswer) => Promise<void>;
  /** Sets an answer's rating. */
  rate: (id: string, rating: AnswerRating) => Promise<void>;
  /** Reports an answer, with what was wrong. */
  report: (id: string, note: string) => Promise<void>;
  /** Sets an answer's note. */
  note: (id: string, note: string) => Promise<void>;
}

/** The real store (IndexedDB through core/storage). */
const DEFAULT_STORE: AnswerStore = {
  save: saveAnswer,
  rate: rateAnswer,
  report: reportAnswer,
  note: setAnswerNote,
};

/** What to say when the latest words look like noise (v1.1.0, ADR-0043). */
export const GARBLED_NOTICE = "Didn't catch the question clearly — press Answer again or type it.";

/**
 * What to say when Claude found the words ask nothing (v1.4, ADR-0065), after a press of Answer.
 */
export const NOTHING_TO_ANSWER_NOTICE =
  "That wasn't a question — press Answer when they ask one, or type it.";

/**
 * Whether a reply's type means there is no answer to show: noise (garbled) or nothing asked (none).
 *
 * @param type The type from the reply's hidden first line, if any.
 * @returns True for garbled and none.
 * Called from: useLiveAnswers() (ask)
 */
function isNoAnswer(type: AnswerType | undefined): boolean {
  return type === 'garbled' || type === 'none';
}

/**
 * 1.5.2 (ADR-0070): shown while a press waits for the question the other person is still asking
 * (core/answer/pressQuestion.ts 'wait').
 */
export const WAITING_NOTICE = 'Listening for the question…';

/** What to say when nothing so far is a question to answer (v1.1.0, ADR-0043). */
export const NO_QUESTION_NOTICE =
  'No question to answer yet. Press Answer this on what they said, or type it.';

/**
 * How long after the other person asked something a screenshot still counts as being about it, in ms
 * (v1.1.0, ADR-0043).
 */
const RECENT_QUESTION_MS = 120_000;

/** One answer of this call, as the panel shows it. */
export interface AnswerEntry {
  /** Answer id (crypto.randomUUID()). */
  id: string;
  /** 'answer' (from the transcript), 'chat' (typed) or 'screenshot' (Day 5). */
  mode: 'answer' | 'chat' | 'screenshot';
  /** True when Kite answered by itself (auto-answer, Day 6 Stage 4f); shown as "Auto". */
  auto?: boolean;
  /**
   * The screenshot a screenshot answer was made from, as a JPEG data URL, for the thumbnail.
   * In memory only: never saved (toStored() leaves it out) and never logged.
   */
  thumbnail?: string;
  /** The question answered ('' when Claude was asked to answer the latest "Them" lines). */
  question: string;
  /**
   * The question as Claude cleaned it up (the hidden last line, v1.0.2, ADR-0037), once it has
   * arrived; the card shows it instead of `question`, which stays the raw words on hover.
   */
  cleanQuestion?: string;
  /** How many transcript lines the question came from (0 for chat). */
  fromLines: number;
  /** v1.3.2: the live transcript line the question ended on (answers to speech only). */
  sourceLineId?: string;
  /** The answer text so far. */
  text: string;
  /** Streaming, finished, failed, or cancelled by Clear (or a newer answer). */
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  /** What to show when it failed (core/answer/unavailable.ts answerFailureText()). */
  error?: string;
  /** True when it failed because Claude is unavailable for everyone (usage limit or overload). */
  unavailable?: boolean;
  /** A failure the user can act on: signed out, or no connection (Day 6 Stage 4e). */
  problem?: AnswerProblem;
  /** When the user asked (Unix ms). */
  askedAt: number;
  /** The model tier used. */
  model: ModelTier;
  /** Where the time went (set when it finished). */
  timeline?: AnswerTimeline;
  /** Token counts (set when it finished). */
  usage?: AnswerUsage;
  /** The user's rating. */
  rating: AnswerRating;
  /** The user's note ('' when none). */
  note: string;
  /** True once the user has reported it (ADR-0029). */
  reported?: boolean;
  /** Its question type, who it is for and its source, once they arrive (ADR-0030). */
  meta?: AnswerMeta;
  /** Words the claim check could not find in the documents or the call (ADR-0030). */
  claims?: string[];
}

/**
 * Turns a finished entry into the row saved on this device.
 *
 * @param entry         The finished entry.
 * @param sessionId     Its session.
 * @param callStartedAt When its call connected (Unix ms).
 * @returns The row.
 * Called from: useLiveAnswers() (when an answer finishes)
 */
function toStored(entry: AnswerEntry, sessionId: string, callStartedAt: number): StoredAnswer {
  return {
    id: entry.id,
    sessionId,
    callStartedAt,
    mode: entry.mode,
    question: entry.question,
    ...(entry.cleanQuestion ? { cleanQuestion: entry.cleanQuestion } : {}),
    text: entry.text,
    model: entry.model,
    msFirstToken: entry.timeline && entry.text ? entry.timeline.toFirstWord : null,
    msTotal: entry.timeline?.toDone ?? 0,
    createdAt: entry.askedAt,
    rating: entry.rating,
    note: entry.note,
    ...(entry.reported ? { reported: true } : {}),
    ...(entry.meta ? { meta: entry.meta } : {}),
    ...(entry.claims?.length ? { claims: entry.claims } : {}),
    ...(entry.sourceLineId ? { sourceLineId: entry.sourceLineId } : {}),
  };
}

/**
 * The line a question to speech ended on (v1.3.2): the latest of the lines it was picked from, or for
 * "Answer this" the latest line of the other person inside the bubble's span.
 *
 * @param lines The call's lines.
 * @param ids   The ids of the lines the question was picked from, if known.
 * @param span  The bubble's span ("Answer this"), if any.
 * @returns The line's id, or undefined when none is known.
 * Called from: useLiveAnswers() (ask); tests
 */
export function sourceLineOf(
  lines: readonly { id: string; speaker: string; tStart: number; tEnd: number }[],
  ids: readonly string[] | null | undefined,
  span?: SpeechSpan,
): string | undefined {
  const used = ids?.length
    ? lines.filter((line) => ids.includes(line.id))
    : span
      ? lines.filter(
          (line) => line.speaker === 'them' && line.tStart >= span.start && line.tStart <= span.end,
        )
      : [];
  return used.reduce<(typeof used)[number] | undefined>(
    (latest, line) => (latest === undefined || line.tStart >= latest.tStart ? line : latest),
    undefined,
  )?.id;
}

/**
 * Finds what the claim check compares an answer with: the session's details, its documents, and
 * everything said in the call. Earlier answers are left out on purpose: repeating an invented figure
 * does not make it true.
 *
 * @param session   The session.
 * @param documents Its documents.
 * @param lines     The call's lines.
 * @param question  The question.
 * @returns The source texts.
 * Called from: useLiveAnswers() (when an answer finishes); tests
 */
export function claimSources(
  session: Session,
  documents: readonly StoredDocument[],
  lines: readonly { text: string }[],
  question: string,
): string[] {
  return [
    session.company,
    session.role,
    session.description,
    session.instructions,
    session.preferences.keyTerms,
    question,
    ...documents.map((document) => document.text),
    ...lines.map((line) => line.text),
  ];
}

/**
 * Lines as one question: their words joined, with their ids (v1.4).
 *
 * @param lines The lines, oldest first.
 * @returns The question as selectQuestion() would give it.
 * Called from: useLiveAnswers() (ask)
 */
function asSelected(lines: readonly { id: string; text: string }[]): {
  text: string;
  lineIds: string[];
} {
  return {
    text: lines.map((line) => line.text.trim()).join(' '),
    lineIds: lines.map((line) => line.id),
  };
}

/** No lessons: one shared empty list, so hook dependencies stay stable between renders. */
const NO_LESSONS: readonly string[] = [];

/** Inputs of useLiveAnswers(). */
export interface LiveAnswersInput {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /**
   * The approved lessons for this session type (Day 5 Stage 7), sent with every warm-up and
   * answer so the cached rules block is the same for all of them. None when omitted.
   */
  lessons?: readonly string[];
  /** The live transcript. */
  transcript: Transcript;
  /** When this call connected (Unix ms); a new value starts a new conversation. */
  callStartedAt: number;
  /** Where answers are saved (default: this device's IndexedDB). */
  store?: AnswerStore;
  /** The chat box's switch: who typed and screenshot questions are for (ADR-0030). */
  chatTarget?: TargetChoice;
  /** True while listening is paused (ADR-0044): nothing is being said, so no paid warm-ups. */
  paused?: boolean;
}

/** What useLiveAnswers() returns. */
export interface LiveAnswers {
  /** This call's answers, oldest first: one entry per question (v1.0.4, ADR-0040). */
  entries: AnswerEntry[];
  /** Index of the answer shown: the newest unless another is chosen; -1 only with no answers. */
  index: number;
  /** A short notice for the user (for example "nothing to answer yet"), or null. */
  notice: string | null;
  /**
   * Answers the latest question from the transcript.
   *
   * @param trigger 1.5.1: what asked (the call timing log): the key (default) or a button.
   */
  answer: (trigger?: AnswerTrigger) => void;
  /**
   * Answers by itself (auto-answer, Day 6 Stage 4f; marked "Auto"). v1.4: with the lines the rule chose,
   * or asks again with the whole question on the card it replaces (a rerun).
   *
   * @param decision What core/answer/autoAnswer.ts decided (absent: pick the question as Answer does).
   */
  autoAnswer: (decision?: AutoDecision) => void;
  /** v1.4: what auto-answer needs to know: the lines answered so far and the latest answered question. */
  answeredState: () => { answeredLineIds: ReadonlySet<string>; last: AnsweredQuestion | null };
  /** Answers a typed question. */
  chat: (question: string) => void;
  /**
   * Answers one transcript bubble's question (its "Answer this" button, v1.0.2). Guarded like
   * Answer: speech already answered shows its answer instead of asking again.
   *
   * @param question The bubble's words.
   * @param span     The time span of the bubble's lines.
   */
  answerThis: (question: string, span: SpeechSpan) => void;
  /**
   * The ids of answers already given for some speech, with that speech's span (so a transcript
   * bubble can show it was answered).
   */
  answeredSpans: readonly { span: SpeechSpan; answerId: string }[];
  /** Cancels a streaming answer, and goes back to the newest answer. */
  clear: () => void;
  /** Stops a streaming answer, keeping what arrived on the card (v1.1.0). */
  stop: () => void;
  /** Shows the previous answer. */
  prev: () => void;
  /** Shows the next answer. */
  next: () => void;
  /** Shows one answer of the call (clicking a collapsed card, v1.0.4). */
  show: (id: string) => void;
  /** Goes back to the newest answer (opening the call window, v1.0.4). */
  showLatest: () => void;
  /** Answers again in another shape (the answer card's menu, ADR-0030). */
  reanswer: (id: string, answerType: AnswerType) => void;
  /** Rates an answer (saved at once). */
  rate: (id: string, rating: AnswerRating) => void;
  /** Saves an answer's note. */
  saveNote: (id: string, note: string) => void;
  /** Reports an answer, with what was wrong (ADR-0029; stays on this device). */
  report: (id: string, note: string) => void;
  /** True when a rating or note could not be saved on this device. */
  saveFailed: boolean;
  /**
   * Takes a screenshot and answers from it (Day 5).
   *
   * @param question A typed question about the screen (default: what is on screen and how to
   *                 respond).
   * @param trigger  1.5.1: what asked (the call timing log); default the key.
   */
  screenshot: (question?: string, trigger?: AnswerTrigger) => void;
  /** True while a screenshot is being taken and prepared. */
  capturing: boolean;
}

/**
 * The answers of a live call.
 *
 * @param input Session, documents, transcript, call start, and the answer store.
 * @returns The answers and the actions.
 * Called from: LiveAnswers.tsx
 */
export function useLiveAnswers(input: LiveAnswersInput): LiveAnswers {
  const { session, documents, transcript, callStartedAt } = input;
  const lessons = input.lessons ?? NO_LESSONS;
  const store = input.store ?? DEFAULT_STORE;
  const [entries, setEntries] = useState<AnswerEntry[]>([]);
  // The answer shown, by id (null after Clear).
  const [shownId, setShownId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [runner] = useState(() => createAnswerRunner());
  // Ignores a repeat Answer for the same question (core/answer/repeatGuard.ts, v1.0.1), and
  // speech already answered (v1.0.2).
  const [repeatGuard] = useState(() => createRepeatGuard());
  const [answeredSpans, setAnsweredSpans] = useState<{ span: SpeechSpan; answerId: string }[]>([]);
  // The garbled words last reported: pressing Answer again on the same words sends them (ADR-0043).
  const garbledRef = useRef<string | null>(null);
  // Lines Claude said were noise (v1.1.0): left out of what later questions are picked from.
  const noiseLinesRef = useRef(new Set<string>());
  // Lines Answer has already answered in this call (v1.1.0).
  const answeredLinesRef = useRef(new Set<string>());
  // v1.4 (ADR-0062): the latest answer to speech, which a rerun or a continuation replaces.
  const lastAnsweredRef = useRef<AnsweredQuestion | null>(null);
  // 1.5.2 (ADR-0070): a press waiting for the question the other person is still asking.
  const pendingPressRef = useRef<{
    since: number;
    pressedAt: number;
    trigger: AnswerTrigger;
  } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Retries the waiting press (set after ask is made, below).
  const retryPendingRef = useRef<() => void>(() => undefined);
  // 1.5.2: when the last answer stopped streaming (auto-answer answers a question that came due meanwhile).
  const idleSinceRef = useRef<number | null>(null);

  /**
   * What was answered, by the ids the lines have now (1.5.2, ADR-0070): a grey line's words may have
   * joined an earlier line, which then counts as answered too.
   *
   * @returns The answered line ids and the latest answered question.
   */
  const resolvedAnswered = useCallback((): {
    answeredLineIds: ReadonlySet<string>;
    last: AnsweredQuestion | null;
  } => {
    const resolve = (id: string) => transcript.resolveId(id);
    const answered = new Set<string>();
    for (const id of answeredLinesRef.current) {
      answered.add(id);
      answered.add(resolve(id));
    }
    const last = lastAnsweredRef.current;
    return {
      answeredLineIds: answered,
      last: last ? { ...last, lineIds: [...new Set(last.lineIds.map(resolve))] } : null,
    };
  }, [transcript]);
  // What the conversation has sent so far, and the finished answers (refs: read when asked).
  const logRef = useRef(emptyLog());
  const finishedRef = useRef<CallAnswer[]>([]);
  // This call's questions with the type each was shown with (core/answer/answerType.ts).
  const labelsRef = useRef<LabelledQuestion[]>([]);
  const keepWarmRef = useRef<KeepWarm | null>(null);
  const storeRef = useRef(store);
  // The chat switch, read when a question is sent: changing it must not rebuild the actions.
  const chatTargetRef = useRef<TargetChoice>(input.chatTarget ?? 'auto');
  // The latest session, documents and lessons for the idle re-warm. Refs, so the call's lifecycle
  // below depends only on what makes a new call (session id, call start): a caller passing a
  // fresh but equal session object on each render must not cancel the answer in flight (v1.0.0).
  const warmInputRef = useRef({ session, documents, lessons });
  useEffect(() => {
    storeRef.current = store;
    chatTargetRef.current = input.chatTarget ?? 'auto';
    warmInputRef.current = { session, documents, lessons };
  });

  // A new call: a new conversation; End (unmount) stops any answer still streaming.
  const sessionId = session.id;
  useEffect(() => {
    logRef.current = emptyLog();
    finishedRef.current = [];
    labelsRef.current = [];
    lastAnsweredRef.current = null;
    return () => {
      runner.cancel();
      // Fail safe: an answer stopped here must not stay "streaming" (its card would show "…" for
      // ever, as when a re-render cancelled every answer before the v1.0.0 fix in LivePage).
      setEntries((current) =>
        current.map((entry) =>
          entry.status === 'streaming' ? { ...entry, status: 'cancelled' as const } : entry,
        ),
      );
    };
  }, [callStartedAt, sessionId, runner]);

  // The idle re-warm, for as long as listening is not paused (ADR-0044: nobody is on the call, so
  // keeping Claude's cache warm would only spend money).
  const paused = input.paused ?? false;
  useEffect(() => {
    if (paused) return;
    const keepWarm = startKeepWarm({
      warm: () => {
        const latest = warmInputRef.current;
        return warmSession(latest.session, latest.documents, {
          conversation: logRef.current.chunks,
          lessons: latest.lessons,
        });
      },
    });
    keepWarmRef.current = keepWarm;
    return () => {
      keepWarm.stop();
      keepWarmRef.current = null;
    };
  }, [callStartedAt, sessionId, paused]);

  /**
   * Replaces one entry's fields.
   *
   * @param id     The entry's id.
   * @param fields Fields to change.
   */
  const update = useCallback((id: string, fields: Partial<AnswerEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry)),
    );
  }, []);

  /**
   * Builds and streams an answer.
   *
   * @param mode               'answer', 'chat' or 'screenshot'.
   * @param options.typed      The typed question (chat, or about a screenshot).
   * @param options.image      The prepared screenshot (mode 'screenshot').
   * @param options.pressedAt  When the user pressed the key (default now; a screenshot passes the
   *                           time before it was taken, so the capture counts in the timings).
   * @param options.auto       True when Kite answers by itself (auto-answer); marked "Auto".
   * @param options.answerType The question type chosen on the answer card (a re-answer).
   * @param options.question   A re-answer's question, used instead of picking one.
   */
  const ask = useCallback(
    (
      mode: AnswerEntry['mode'],
      options: {
        /** The typed question. */
        typed?: string;
        /** The prepared screenshot. */
        image?: string;
        /** When the user pressed the key. */
        pressedAt?: number;
        /** True when Kite answers by itself. */
        auto?: boolean;
        /** The question type chosen on the answer card. */
        answerType?: AnswerType;
        /** A re-answer's question, or a transcript bubble's words ("Answer this"). */
        question?: string;
        /** The speech a bubble's question came from ("Answer this"): guarded like Answer. */
        span?: SpeechSpan;
        /** v1.4: the transcript lines that make the question (auto-answer's choice, a rerun). */
        lineIds?: readonly string[];
        /** v1.4: the answer this one replaces, on the same card (a rerun or a continuation). */
        replaces?: string;
        /** 1.5.1: what asked, for the call timing log (default: the key, or auto). */
        trigger?: AnswerTrigger;
        /**
         * 1.5.1 (ADR-0069): the transcript lines a screenshot's question came from: marked answered and
         * remembered by the repeat guard, so Answer does not ask the same speech again.
         */
        coveredLines?: readonly string[];
        /** 1.5.2 (ADR-0070): when a press that is waiting for the question began waiting (Unix ms). */
        waitingSince?: number;
      } = {},
    ): boolean => {
      const { typed, image, auto = false, answerType } = options;
      const keyPressAt = options.pressedAt ?? performance.now();
      // Offline: answers are paused (the banner says so); the transcript keeps going.
      if (!isOnline()) {
        setNotice(OFFLINE_TEXT);
        return false;
      }
      // Lines Claude found to be noise are not part of any later question (ADR-0043).
      const lines = transcript.lines().filter((line) => !noiseLinesRef.current.has(line.id));
      // 1.5.2 (ADR-0070): what was answered, by the ids the lines have now (a grey line's words may have
      // joined an earlier line).
      const { answeredLineIds, last: lastAnswered } = resolvedAnswered();
      if (
        mode === 'answer' &&
        !options.question &&
        !options.lineIds &&
        !lines.some((line) => line.speaker === 'them')
      ) {
        setNotice('Nothing from the other person yet. Type a question in Chat instead.');
        return false;
      }
      // v1.1.0 (ADR-0043): only real questions. A greeting or an instruction looks back to the last
      // real question; noise is reported once, and a second press on the same words sends them.
      // None of this spends a request. A bubble's "Answer this" and a typed question are always sent.
      let picked: PickedQuestion | null = null;
      // Whether the question comes from only part of the lines, so it must be passed on as it is.
      let partOfLines = false;
      // v1.4: the answer this one replaces on the same card (a rerun or a continuation), if any.
      let replaces = options.replaces;
      // 1.5.2: a press that answered words still grey (asked again on its card if the person goes on).
      let greyPress = false;
      if (mode === 'answer' && options.lineIds && !options.question) {
        // Auto-answer chose the lines (core/answer/autoAnswer.ts): asked as they are.
        const chosen = lines.filter((line) => options.lineIds!.includes(line.id));
        if (chosen.length === 0) return false;
        picked = { kind: 'question', selected: asSelected(chosen), lookedBack: false };
        partOfLines = true;
      } else if (mode === 'answer' && !options.question) {
        // 1.5.2 (ADR-0070): the press rules live in core/answer/pressQuestion.ts (the newest question,
        // grey words included; a continuation on its card; talk about the call looks back).
        const choice = choosePress({
          lines,
          answeredLineIds,
          last: lastAnswered,
          now: Date.now(),
          waitingSince: options.waitingSince ?? null,
        });
        if (choice.kind === 'wait') {
          // The other person is still asking: answer it as soon as it is a question (or after
          // PRESS_WAIT_MS with what there is). Tried again on each transcript change (the effect below).
          const since = options.waitingSince ?? Date.now();
          pendingPressRef.current = {
            since,
            pressedAt: keyPressAt,
            trigger: options.trigger ?? 'hotkey',
          };
          if (!pendingTimerRef.current) {
            pendingTimerRef.current = setTimeout(
              () => {
                pendingTimerRef.current = null;
                retryPendingRef.current();
              },
              Math.max(0, since + PRESS_WAIT_MS - Date.now()) + 50,
            );
          }
          setNotice(WAITING_NOTICE);
          return false;
        }
        pendingPressRef.current = null;
        picked =
          choice.kind === 'answer'
            ? {
                kind: 'question',
                selected: { text: choice.text, lineIds: choice.lineIds },
                lookedBack: choice.lookedBack,
              }
            : choice.kind === 'garbled'
              ? { kind: 'garbled', selected: { text: choice.text, lineIds: choice.lineIds } }
              : { kind: 'none' };
        if (choice.kind === 'answer') {
          partOfLines = choice.partOfLines;
          replaces = choice.replaces;
          greyPress = choice.grey;
        }
        if (picked.kind === 'none') {
          setNotice(NO_QUESTION_NOTICE);
          return false;
        }
        if (picked.kind === 'garbled') {
          if (garbledRef.current !== picked.selected.text) {
            garbledRef.current = picked.selected.text;
            setNotice(GARBLED_NOTICE);
            return false;
          }
        }
      }
      garbledRef.current = null;
      setNotice(null);
      // A question from Them is always for the call; the switch is for what the user types or
      // screenshots.
      const choice = mode === 'answer' ? 'auto' : chatTargetRef.current;
      const built = buildAnswerRequest({
        session,
        documents,
        lines,
        answers: finishedRef.current,
        mode,
        typedQuestion: typed,
        ...(image ? { image } : {}),
        now: Date.now(),
        callStartedAt,
        log: logRef.current,
        lessons,
        ...(choice !== 'auto' ? { target: choice } : {}),
        ...(answerType ? { answerType } : {}),
        ...(options.question ? { question: options.question } : {}),
        // Found by looking back past a greeting or an instruction: asked as it is.
        ...(picked?.kind === 'question' && (picked.lookedBack || partOfLines)
          ? { question: picked.selected.text }
          : {}),
      });
      // Answer is idempotent (v1.0.1): the shortcut, the overlay, auto-answer and a bubble's
      // "Answer this" can all fire for one question. Decided before anything changes (the log,
      // the cards). A re-answer with a chosen type (a question without a span) is a deliberate
      // new request and is not guarded.
      const pickedLines = picked ? picked.selected.lineIds : null;
      const span =
        options.span ??
        ((pickedLines ?? built.selected?.lineIds)
          ? themSpan(lines, pickedLines ?? built.selected?.lineIds ?? [])
          : null);
      // v1.4: a rerun or a continuation is a deliberate new request for a longer question: not guarded.
      const guarded =
        mode === 'answer' && !replaces && (!options.question || options.span !== undefined);
      const lookedBack = picked?.kind === 'question' && picked.lookedBack;
      if (guarded) {
        const decision = repeatGuard.decide({
          question: built.request.question ?? '',
          streaming: runner.busy(),
          now: Date.now(),
          ...(span ? { span } : {}),
          ...(auto ? { auto: true } : {}),
          ...(lookedBack ? { lookedBack: true } : {}),
        });
        if (decision.kind === 'show') setShownId(decision.answerId);
        if (decision.kind !== 'answer') return false;
      }
      logRef.current = built.log;
      keepWarmRef.current?.noteActivity();
      const entry: AnswerEntry = {
        // v1.4: a rerun keeps the card it replaces (same id), so one question has one card; a saved
        // row with this id is replaced when the new answer finishes (saveAnswer puts by id).
        id: replaces ?? crypto.randomUUID(),
        mode,
        ...(auto ? { auto: true } : {}),
        question:
          built.request.question ?? (mode === 'screenshot' ? DEFAULT_SCREENSHOT_QUESTION : ''),
        ...(image ? { thumbnail: image } : {}),
        fromLines: built.selected?.lineIds.length ?? 0,
        ...(mode === 'answer'
          ? (() => {
              // v1.3.2: Review and the downloads put the answer after the turn it answered.
              const sourceLineId = sourceLineOf(
                lines,
                pickedLines ?? built.selected?.lineIds,
                options.span,
              );
              return sourceLineId ? { sourceLineId } : {};
            })()
          : {}),
        text: '',
        status: 'streaming',
        askedAt: Date.now(),
        model: session.preferences.model,
        rating: null,
        note: '',
      };
      // A new answer cancels the one still streaming (the runner does; mark it here). A rerun takes
      // the place of the answer it replaces.
      setEntries((current) => [
        ...current
          .filter((old) => old.id !== entry.id)
          .map((old) =>
            old.status === 'streaming' ? { ...old, status: 'cancelled' as const } : old,
          ),
        entry,
      ]);
      setShownId(entry.id);
      if (span && (guarded || replaces || (mode === 'screenshot' && options.coveredLines))) {
        repeatGuard.remember(span, entry.id, Date.now());
        setAnsweredSpans((current) => [
          ...current.filter((item) => item.answerId !== entry.id),
          { span, answerId: entry.id },
        ]);
      }
      for (const id of pickedLines ?? options.coveredLines ?? []) answeredLinesRef.current.add(id);
      if (mode === 'answer' && span && pickedLines) {
        lastAnsweredRef.current = {
          answerId: entry.id,
          lineIds: pickedLines,
          end: span.end,
          askedAt: Date.now(),
          auto,
          ...(greyPress && !auto ? { grey: true } : {}),
          words: wordCount(
            lines
              .filter((line) => pickedLines.includes(line.id))
              .map((line) => line.text)
              .join(' '),
          ),
        };
      }
      // Kept here as well as in state: the answer's end needs them in the same tick.
      let meta: AnswerMeta | undefined;
      let cleanQuestion: string | undefined;
      // 1.5.1 (ADR-0069): Claude's "nothing to answer" types, and small talk that Kite found by itself:
      // auto-answer never puts a card up for "how are you doing?" (a press still gets its answer).
      const dropped = (type: AnswerType | undefined) =>
        isNoAnswer(type) || (auto && type === 'smalltalk');
      // 1.5.1: the call timing log (ids and times only). 1.5.2 (ADR-0070): a rerun gets an entry of its own
      // (the card's first request keeps its times), and the log says whether the words were still grey and
      // whether auto-answer asked at the pause.
      const sentWall = Date.now();
      const timingId = replaces ? `${entry.id}~${sentWall}` : entry.id;
      const greyWords = lines.some(
        (line) => !line.final && (pickedLines ?? built.selected?.lineIds ?? []).includes(line.id),
      );
      callTimings.noteAnswer({
        answerId: timingId,
        ...(greyWords ? { grey: true } : {}),
        ...(greyWords && auto ? { early: true } : {}),
        ...(replaces ? { rerunOf: replaces } : {}),
        trigger:
          options.trigger ??
          (auto ? 'auto' : options.span ? 'answer-this' : mode === 'chat' ? 'chat' : 'hotkey'),
        mode,
        askedAt: Math.round(sentWall - (performance.now() - keyPressAt)),
        speechEnd: span?.end ?? null,
        sentAt: sentWall,
        status: 'streaming',
        bytes: JSON.stringify(built.request).length,
      });
      let retries = 0;
      let firstWordLogged = false;
      runner.run(built.request, keyPressAt, {
        onRetry: () => {
          retries += 1;
          callTimings.noteAnswer({ answerId: timingId, retries });
        },
        onQuestion: (received) => {
          cleanQuestion = received;
          update(entry.id, { cleanQuestion });
        },
        onMeta: (received) => {
          // A steady label (v1.0.1): the same question keeps its first type, and a clearly
          // technical question is not shown as behavioural or small talk. A type the user chose
          // on the card (answerType) is shown as chosen.
          // Not a screenshot's: the same words go with a different screen each time.
          const type =
            answerType || isNoAnswer(received.type) || mode === 'screenshot'
              ? received.type
              : settleAnswerType(entry.question, received.type, labelsRef.current);
          meta = { ...received, type };
          if (dropped(type)) callTimings.noteAnswer({ answerId: timingId, status: 'none' });
          // Claude could not make sense of the words either (ADR-0043): no answer to show. The
          // entry goes, and the user gets the same notice as when the rules catch it first.
          // v1.4 (ADR-0065): or the words ask nothing ("can you repeat that?", a remark). The entry goes
          // the same way; a press of Answer gets a short notice, auto-answer stays silent, and the lines
          // stay answered (they are not noise, but there is nothing to answer in them).
          if (dropped(type)) {
            setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
            setAnsweredSpans((current) => current.filter((item) => item.answerId !== entry.id));
            setShownId(null);
            if (type === 'garbled') {
              setNotice(GARBLED_NOTICE);
              for (const id of pickedLines ?? built.selected?.lineIds ?? []) {
                noiseLinesRef.current.add(id);
              }
            } else if (!auto) {
              setNotice(NOTHING_TO_ANSWER_NOTICE);
            }
            return;
          }
          if (entry.question.trim() !== '' && mode !== 'screenshot') {
            labelsRef.current = [...labelsRef.current, { question: entry.question, type }];
          }
          update(entry.id, { meta });
        },
        onText: (text) => {
          if (!firstWordLogged) {
            firstWordLogged = true;
            callTimings.noteAnswer({ answerId: timingId, firstWordAt: Date.now() });
          }
          if (!dropped(meta?.type)) update(entry.id, { text });
        },
        onDone: (text, done, timeline) => {
          idleSinceRef.current = Date.now();
          if (!dropped(meta?.type)) {
            callTimings.noteAnswer({ answerId: timingId, status: 'done', doneAt: Date.now() });
          }
          // Not an answer: nothing to keep, send later or save.
          if (dropped(meta?.type)) return;
          // No model call: plain text matching (ADR-0030).
          const claims = needsClaimCheck(meta, mode)
            ? checkClaims(
                text,
                buildClaimCorpus(
                  claimSources(session, documents, transcript.lines(), entry.question),
                ),
              ).map((claim) => claim.text)
            : [];
          const finished: AnswerEntry = {
            ...entry,
            text,
            status: 'done',
            timeline,
            usage: done.usage,
            ...(meta ? { meta } : {}),
            ...(cleanQuestion ? { cleanQuestion } : {}),
            ...(claims.length > 0 ? { claims } : {}),
          };
          update(entry.id, finished);
          finishedRef.current = [
            ...finishedRef.current,
            {
              id: entry.id,
              mode,
              question: entry.question,
              text,
              askedAt: entry.askedAt,
              ...(meta?.target === 'kite' ? { target: 'kite' as const } : {}),
            },
          ];
          console.info('answer: done', {
            sessionId: session.id,
            answerId: entry.id,
            mode,
            ...timeline,
            cacheRead: done.usage.cache_read_input_tokens,
            cacheWrite: done.usage.cache_creation_input_tokens,
            input: done.usage.input_tokens,
            output: done.usage.output_tokens,
          });
          // Saved even when "Save transcript" is off (StoredAnswer in core/storage/types.ts).
          storeRef.current
            .save(toStored(finished, session.id, callStartedAt))
            .catch(() => setSaveFailed(true));
        },
        onError: (failure) => {
          idleSinceRef.current = Date.now();
          callTimings.noteAnswer({ answerId: timingId, status: 'error', doneAt: Date.now() });
          const shown = answerFailureText(failure);
          update(entry.id, {
            status: 'error',
            error: shown.text,
            unavailable: shown.unavailable,
            ...(shown.problem ? { problem: shown.problem } : {}),
          });
          console.warn('answer: failed', {
            sessionId: session.id,
            answerId: entry.id,
            code: failure.code,
          });
        },
      });
      return true;
    },
    [
      session,
      documents,
      lessons,
      transcript,
      callStartedAt,
      runner,
      repeatGuard,
      update,
      resolvedAnswered,
    ],
  );

  // 1.5.2 (ADR-0070): a press waiting for the question is tried again whenever the transcript changes (the
  // grey line grows into a question, or ends), and once more when PRESS_WAIT_MS is up (the timer in ask).
  useEffect(() => {
    retryPendingRef.current = () => {
      const pending = pendingPressRef.current;
      if (!pending) return;
      pendingPressRef.current = null;
      ask('answer', {
        waitingSince: pending.since,
        pressedAt: pending.pressedAt,
        trigger: pending.trigger,
      });
    };
  });
  useEffect(
    () =>
      transcript.subscribe(() => {
        if (pendingPressRef.current) retryPendingRef.current();
      }),
    [transcript],
  );
  // A new call, or End: nothing waits any more.
  useEffect(
    () => () => {
      pendingPressRef.current = null;
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    },
    [callStartedAt, sessionId],
  );

  const clear = useCallback(() => {
    // Selection falls back to the newest answer (v1.0.4): never an empty card while answers exist.
    setShownId(null);
    if (runner.busy()) {
      runner.cancel();
      setEntries((current) =>
        current.map((entry) =>
          entry.status === 'streaming' ? { ...entry, status: 'cancelled' as const } : entry,
        ),
      );
      return;
    }
    setNotice(null);
  }, [runner]);

  const stop = useCallback(() => {
    if (!runner.busy()) return;
    runner.cancel();
    setEntries((current) =>
      current.map((entry) =>
        entry.status === 'streaming' ? { ...entry, status: 'cancelled' as const } : entry,
      ),
    );
  }, [runner]);

  const rate = useCallback(
    (id: string, rating: AnswerRating) => {
      update(id, { rating });
      storeRef.current.rate(id, rating).catch(() => setSaveFailed(true));
    },
    [update],
  );

  const report = useCallback(
    (id: string, note: string) => {
      update(id, { reported: true, ...(note.trim() ? { note: note.trim() } : {}) });
      storeRef.current.report(id, note).catch(() => setSaveFailed(true));
    },
    [update],
  );

  const saveNote = useCallback(
    (id: string, note: string) => {
      update(id, { note: note.trim() });
      storeRef.current.note(id, note).catch(() => setSaveFailed(true));
    },
    [update],
  );

  // One entry per question (v1.0.4, ADR-0040); the state keeps every answer, this is what shows.
  // Every entry here is of this call, so none carries a call to tell apart.
  const history = useMemo(() => mergeAnswers(entries, (entry) => entry.askedAt), [entries]);
  const list = history.list;
  const selectedId = shownId === null ? null : (history.winnerOf.get(shownId) ?? shownId);
  // With nothing chosen, the newest answer that has something to show.
  const selected = list.findIndex((entry) => entry.id === selectedId);
  const newest = list.findLastIndex((entry) => !stoppedEmpty(entry));
  const index = selected !== -1 ? selected : newest !== -1 ? newest : list.length - 1;

  const prev = useCallback(() => {
    setShownId(list[Math.max(0, index - 1)]?.id ?? null);
  }, [list, index]);

  const screenshot = useCallback(
    (question?: string, trigger: AnswerTrigger = 'screenshot-hotkey') => {
      if (capturing) return;
      const pressedAt = performance.now();
      setCapturing(true);
      setNotice(null);
      void (async () => {
        try {
          const png = await getPlatform().captureScreenshot();
          const prepared = await prepareScreenshot(png);
          // Sizes and times only; never the image.
          console.info('screenshot: prepared', {
            sessionId: session.id,
            width: prepared.width,
            height: prepared.height,
            bytes: prepared.bytes,
            ms: Math.round(performance.now() - pressedAt),
          });
          // v1.1.0 (ADR-0043): without a typed question, the screen goes with what the other person
          // just asked, so the answer is about that.
          const lines = transcript.lines();
          const picked = question ? null : pickQuestion(lines);
          const span =
            picked?.kind === 'question' ? themSpan(lines, picked.selected.lineIds) : null;
          const recent =
            picked?.kind === 'question' && span && Date.now() - span.end <= RECENT_QUESTION_MS
              ? picked.selected.text
              : undefined;
          const about = question ?? recent;
          ask('screenshot', {
            ...(about ? { typed: about } : {}),
            image: prepared.dataUrl,
            pressedAt,
            trigger,
            // 1.5.1 (ADR-0069): a screenshot about what they just asked answers that speech too.
            ...(!question && recent && span && picked?.kind === 'question'
              ? { span, coveredLines: picked.selected.lineIds }
              : {}),
          });
        } catch (error) {
          setNotice(
            error instanceof CaptureError
              ? error.message
              : 'Paramount AI could not take a screenshot. Try again.',
          );
        } finally {
          setCapturing(false);
        }
      })();
    },
    [ask, capturing, session.id, transcript],
  );

  const next = useCallback(() => {
    setShownId(list[Math.min(list.length - 1, index + 1)]?.id ?? null);
  }, [list, index]);

  const showLatest = useCallback(() => setShownId(null), []);

  const reanswer = useCallback(
    (id: string, answerType: AnswerType) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      // A screenshot is kept in memory only: from an earlier page it can only go by its question.
      if (entry.mode === 'screenshot' && entry.thumbnail) {
        ask('screenshot', {
          typed: entry.question,
          image: entry.thumbnail,
          answerType,
          trigger: 'reanswer',
        });
      } else if (entry.mode === 'answer') {
        ask('answer', {
          answerType,
          trigger: 'reanswer',
          ...(entry.question ? { question: entry.question } : {}),
        });
      } else {
        ask('chat', { typed: entry.question, answerType, trigger: 'reanswer' });
      }
    },
    [ask, entries],
  );

  return {
    entries: list,
    index,
    notice,
    answer: useCallback(
      (trigger?: AnswerTrigger) => void ask('answer', { ...(trigger ? { trigger } : {}) }),
      [ask],
    ),
    autoAnswer: useCallback(
      (decision?: AutoDecision) => {
        // 1.5.2 (ADR-0070): a rerun of a press on grey words stays a press (no "Auto" mark).
        const pressRerun = decision?.kind === 'rerun' && lastAnsweredRef.current?.auto === false;
        void ask('answer', {
          ...(pressRerun ? { trigger: 'rerun' as const } : { auto: true }),
          ...(decision ? { lineIds: decision.lineIds } : {}),
          ...(decision?.kind === 'rerun' ? { replaces: decision.replaces } : {}),
        });
      },
      [ask],
    ),
    // 1.5.2 (ADR-0070): by the ids the lines have now, and when the last answer stopped streaming.
    answeredState: useCallback(
      () => ({ ...resolvedAnswered(), idleSince: idleSinceRef.current }),
      [resolvedAnswered],
    ),
    chat: useCallback((question: string) => ask('chat', { typed: question }), [ask]),
    answerThis: useCallback(
      (question: string, span: SpeechSpan) => ask('answer', { question, span }),
      [ask],
    ),
    answeredSpans,
    clear,
    stop,
    prev,
    next,
    show: setShownId,
    showLatest,
    reanswer,
    rate,
    saveNote,
    report,
    saveFailed,
    screenshot,
    capturing,
  };
}
