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
 *          ADR-0076: in calls with cloud transcription (rules 'newest') a press first waits until the other
 *          side is transcribed up to the press (at most 300 ms; a second press answers at once), then answers
 *          the newest unanswered speech by time (core/answer/newestQuestion.ts), and every press shows what
 *          it did: a new card, "Showing the earlier answer", "Already answering" or "Nothing new to answer".
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
import { buildChunkIndex } from '@/core/documents/chunks';
import { startKeepWarm, type KeepWarm } from '@/core/answer/keepWarm';
import { startKeepAlive } from '@/core/answer/keepAlive';
import { warmSession } from '@/core/answer/warm';
import { answerFailureText, OFFLINE_TEXT, type AnswerProblem } from '@/core/answer/unavailable';
import { choosePress, PRESS_WAIT_MS } from '@/core/answer/pressQuestion';
import {
  chooseNewest,
  FINISHING_NOTICE_AFTER_MS,
  type NewestAutoDecision,
} from '@/core/answer/newestQuestion';
import { createSpeculativeHold, themWentOn, type AskedSpeech } from '@/core/answer/speculative';
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

/** ADR-0076 (G2): shown while a press waits for the other side's last words, after 150 ms. */
export const FINISHING_NOTICE = 'Finishing the question…';

/** ADR-0076 (G3, E3 rule 4): a press with nothing new said since the last card shows that card. */
export const SHOWING_EARLIER_NOTICE = 'Showing the earlier answer — nothing new was asked since.';

/** ADR-0076 (G3, E3 rule 7): a press while the answer to the same speech is still coming. */
export const ALREADY_ANSWERING_NOTICE = 'Already answering — the answer is on its way.';

/** ADR-0076 (G3): a press with nothing at all to answer. */
export const NOTHING_NEW_NOTICE =
  'Nothing new to answer. Press Answer when they ask something, or type the question.';

/** ADR-0076 (E3 rule 8): only lost audio follows the last answer. */
export const GAP_NOTICE =
  'Part of their audio was lost, so the question may be missing. Type it, or use Answer this on their words.';

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
  /**
   * ADR-0076 (E3 rule 2): the press gave up waiting for the other side's last words, so the question may
   * be incomplete (the card says so). In memory only.
   */
  incomplete?: boolean;
  /**
   * Batch C (P1-1): a speculative auto-answer still held hidden (core/answer/speculative.ts): it streams,
   * but no list, card or overlay shows it until the hold ends. In memory only.
   */
  held?: boolean;
  /**
   * Batch D (P0-C, ADR-0079): this card asks again the question of another card (its id), because the other
   * person went on into a new question. Saved, so Review keeps the two answers apart.
   */
  rerunOf?: string;
  /**
   * Batch D (P1-G): part of the other person's audio was lost around the words this card answered; the card
   * says so in a small line. In memory only.
   */
  audioLost?: boolean;
}

/**
 * Turns a finished entry into the row saved on this device.
 *
 * @param entry         The finished entry.
 * @param sessionId     Its session.
 * @param callStartedAt When its call connected (Unix ms).
 * @param callId        ADR-0077: its call's record id, when known.
 * @returns The row.
 * Called from: useLiveAnswers() (when an answer finishes)
 */
function toStored(
  entry: AnswerEntry,
  sessionId: string,
  callStartedAt: number,
  callId?: string,
): StoredAnswer {
  return {
    id: entry.id,
    sessionId,
    callStartedAt,
    ...(callId ? { callId } : {}),
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
    ...(entry.rerunOf ? { rerunOf: entry.rerunOf } : {}),
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
  /** ADR-0077: the call's record id (saved with each answer), when known. */
  callId?: string;
  /** Where answers are saved (default: this device's IndexedDB). */
  store?: AnswerStore;
  /** The chat box's switch: who typed and screenshot questions are for (ADR-0030). */
  chatTarget?: TargetChoice;
  /** True while listening is paused (ADR-0044): nothing is being said, so no paid warm-ups. */
  paused?: boolean;
  /**
   * ADR-0076: which question rules a press and auto-answer use: 'newest' (E3, calls with cloud
   * transcription) or 'legacy' (today's rules; the default).
   */
  rules?: 'newest' | 'legacy';
  /**
   * ADR-0076 (E3 rule 2): waits until the other side is transcribed up to a press (capped by the caller).
   *
   * @param atUnix The press (Unix ms).
   * @returns How long it waited and whether it gave up.
   */
  catchUp?: (atUnix: number) => Promise<{ waitedMs: number; timedOut: boolean }>;
  /**
   * Batch C (P1-1): listens for the other side's turn events (Flux), so a held speculative answer is
   * cancelled when their turn resumes.
   *
   * @param listener Called with each turn event of "Them".
   * @returns Stops listening.
   */
  themTurns?: (listener: (event: 'start' | 'eager' | 'end' | 'resumed') => void) => () => void;
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
  /**
   * v1.4: what auto-answer needs to know: the lines answered so far and the latest answered question;
   * ADR-0076: and the end of the newest answered speech (capture clock), or null.
   */
  answeredState: () => {
    answeredLineIds: ReadonlySet<string>;
    last: AnsweredQuestion | null;
    idleSince: number | null;
    answeredEnd: number | null;
    /**
     * Batch C (P1-1): how many speculative answers were cancelled in this call, so auto-answer may act
     * again on a decision it already acted on (its speech is unanswered again).
     */
    epoch: number;
  };
  /**
   * ADR-0076: auto-answer under the 'newest' rules (rule 9) and the re-ask (rule 6): exactly the chosen
   * words, or the whole question again on the card it replaces.
   *
   * @param decision What core/answer/newestQuestion.ts decided.
   */
  autoNewest: (decision: NewestAutoDecision) => void;
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
  const { session, documents, transcript, callStartedAt, callId } = input;
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
  // ADR-0076 (E3 rule 3): the end of the newest speech any answer covered (capture clock), or null.
  const answeredEndRef = useRef<number | null>(null);
  // ADR-0076: the newest card for speech that is still shown (null once Claude found nothing to answer).
  const speechCardRef = useRef<string | null>(null);
  // Batch D (P1-G): the end of the newest speech answered on a card of its own (a press, an auto-answer, a
  // re-ask on a new card), not by a re-ask that replaced a card in place. A press answers anything after it,
  // so speech a re-ask took into an earlier card's question still gets its own card when pressed for.
  const ownEndRef = useRef<number | null>(null);
  // Batch D (P1-G): the end of the speech the user's last press answered (null before any press).
  const lastPressEndRef = useRef<number | null>(null);
  // Batch D (P0-C): the card whose answer is streaming now, or null.
  const streamingIdRef = useRef<string | null>(null);
  // ADR-0076 (G1): a press waiting for the other side; a second press calls force() and answers at once.
  const pendingCatchUpRef = useRef<{ force: () => void } | null>(null);
  // ADR-0076: the latest catch-up function and rules (read when a key is pressed).
  const catchUpRef = useRef(input.catchUp);
  const rules = input.rules ?? 'legacy';
  // Batch C (P2-1): the documents' parts, made once per document (not per question), for each request.
  const chunkIndex = useMemo(() => buildChunkIndex(documents), [documents]);
  // Batch C (P1-1): the speculative answer held hidden now: what it asked, and how to show or cancel it.
  const heldRef = useRef<{
    answerId: string;
    asked: AskedSpeech;
    show: () => void;
    cancel: () => void;
  } | null>(null);
  // Batch C (P1-1): an answer's finishing work (save, history) when it finished while still held, by id;
  // run when it is shown, dropped when it is cancelled.
  const heldFinish = useRef(new Map<string, () => void>());
  // Batch C (P1-1): grows with each cancelled speculative answer (auto-answer's decision keys use it).
  const cancelEpochRef = useRef(0);
  const [hold] = useState(() =>
    createSpeculativeHold({
      // Ids and times only.
      onTrace: (state, answerId, ms) =>
        callTimings.noteTrace('speculative', { state, answerId, ms: Math.round(ms) }),
    }),
  );

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
    catchUpRef.current = input.catchUp;
  });

  // A new call: a new conversation; End (unmount) stops any answer still streaming.
  const sessionId = session.id;
  useEffect(() => {
    logRef.current = emptyLog();
    finishedRef.current = [];
    labelsRef.current = [];
    lastAnsweredRef.current = null;
    answeredEndRef.current = null;
    speechCardRef.current = null;
    ownEndRef.current = null;
    lastPressEndRef.current = null;
    streamingIdRef.current = null;
    return () => {
      // Batch C (P1-1): a held answer goes with the call (the runner's cancel below stops its request).
      hold.drop();
      heldRef.current = null;
      runner.cancel();
      // Fail safe: an answer stopped here must not stay "streaming" (its card would show "…" for
      // ever, as when a re-render cancelled every answer before the v1.0.0 fix in LivePage).
      setEntries((current) =>
        current.map((entry) =>
          entry.status === 'streaming' ? { ...entry, status: 'cancelled' as const } : entry,
        ),
      );
    };
  }, [callStartedAt, sessionId, runner, hold]);

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
    // Batch C (P1-2): the connection keep-alive (an authenticated ping every 25 s; never Claude).
    const stopKeepAlive = startKeepAlive({
      onFailed: (status) => callTimings.noteTrace('ping-failed', { status }),
    });
    return () => {
      keepWarm.stop();
      keepWarmRef.current = null;
      stopKeepAlive();
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
        /**
         * Batch D (P0-C, ADR-0079): a re-ask on a NEW card: the card whose question it asks again (the other
         * person went on into a new question, so that card's finished answer is kept).
         */
        rerunOf?: string;
        /**
         * Batch D (P1-G): an in-place re-ask that only finishes the same sentence: its card now answers that
         * whole sentence, so a later press does not answer the sentence's end again on a card of its own.
         */
        finishesSentence?: boolean;
        /** 1.5.1: what asked, for the call timing log (default: the key, or auto). */
        trigger?: AnswerTrigger;
        /**
         * 1.5.1 (ADR-0069): the transcript lines a screenshot's question came from: marked answered and
         * remembered by the repeat guard, so Answer does not ask the same speech again.
         */
        coveredLines?: readonly string[];
        /** 1.5.2 (ADR-0070): when a press that is waiting for the question began waiting (Unix ms). */
        waitingSince?: number;
        /**
         * ADR-0076 (E3 rule 3): exactly these words of the other person, chosen by newestQuestion.ts (a
         * press, an auto-answer or a re-ask). Sent as they are; not re-picked, not repeat-guarded.
         */
        exact?: {
          /** The words. Never logged. */
          text: string;
          /** Their lines. */
          lineIds: readonly string[];
          /** Their span (capture clock). */
          span: SpeechSpan;
          /** Whether some are still grey. */
          grey: boolean;
          /** How many words. */
          words: number;
          /** The press gave up waiting for the other side (rule 2). */
          incomplete?: boolean;
          /** Batch D (P1-G): part of their audio was lost around these words (a note on the card). */
          audioLost?: boolean;
        };
        /**
         * Batch C (P1-1): a speculative auto-answer: streamed into a card held hidden for
         * SPECULATIVE_HOLD_MS, cancelled silently when the other person goes on within it.
         */
        speculative?: boolean;
      } = {},
    ): boolean => {
      const { typed, image, auto = false, answerType } = options;
      const keyPressAt = options.pressedAt ?? performance.now();
      // Offline: answers are paused (the banner says so); the transcript keeps going.
      if (!isOnline()) {
        setNotice(OFFLINE_TEXT);
        return false;
      }
      // Batch C (P1-1): any other request replaces a held speculative answer: it is cancelled and its
      // speech counts as unanswered again (first, so this request is built on the restored state).
      if (heldRef.current) hold.activity();
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
      if (mode === 'answer' && options.exact) {
        // ADR-0076: the words newestQuestion.ts chose, exactly.
        picked = {
          kind: 'question',
          selected: { text: options.exact.text, lineIds: [...options.exact.lineIds] },
          lookedBack: false,
        };
        partOfLines = true;
        greyPress = options.exact.grey;
      } else if (mode === 'answer' && options.lineIds && !options.question) {
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
        chunks: chunkIndex,
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
        options.exact?.span ??
        options.span ??
        ((pickedLines ?? built.selected?.lineIds)
          ? themSpan(lines, pickedLines ?? built.selected?.lineIds ?? [])
          : null);
      // v1.4: a rerun or a continuation is a deliberate new request for a longer question: not guarded.
      // ADR-0076: words chosen by newestQuestion.ts are new by construction (after the newest answered speech).
      const guarded =
        mode === 'answer' &&
        !replaces &&
        !options.exact &&
        (!options.question || options.span !== undefined);
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
      // Batch C (P1-1): a speculative answer (a new auto-answer, never a re-ask on a shown card) can be taken
      // back. What it changes below is noted first, so a cancel puts everything back as it was.
      const speculative = options.speculative === true && mode === 'answer' && !replaces;
      // Batch D (P0-B, P0-C): a re-ask, in place (replaces) or on a new card (rerunOf).
      const reaskOf = replaces ?? options.rerunOf;
      const before = speculative
        ? {
            log: logRef.current,
            answeredEnd: answeredEndRef.current,
            ownEnd: ownEndRef.current,
            speechCard: speechCardRef.current,
            last: lastAnsweredRef.current,
            lines: new Set(answeredLinesRef.current),
            finished: finishedRef.current,
            labels: labelsRef.current,
            idleSince: idleSinceRef.current,
          }
        : null;
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
        ...(options.exact?.incomplete ? { incomplete: true } : {}),
        ...(options.exact?.audioLost ? { audioLost: true } : {}),
        ...(speculative ? { held: true } : {}),
        // Batch D (P0-C): a new card that asks another card's question again.
        ...(!replaces && options.rerunOf ? { rerunOf: options.rerunOf } : {}),
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
      // Batch C (P1-1): a held answer is shown when its hold ends (the hold's show below).
      if (!speculative) setShownId(entry.id);
      // Batch D (P0-C): the answer streaming now (an "in place" re-ask is allowed while it still streams).
      streamingIdRef.current = entry.id;
      // Batch D (P1-G): restored if Claude finds nothing to answer in an auto-answer's words (below), so a
      // press on those words still answers them.
      const ownEndBefore = ownEndRef.current;
      if (
        span &&
        (guarded || replaces || options.exact || (mode === 'screenshot' && options.coveredLines))
      ) {
        // ADR-0076 (E3 rule 3): the newest answered speech ends here (or later).
        answeredEndRef.current = Math.max(answeredEndRef.current ?? span.end, span.end);
        // Batch D (P1-G): speech answered on a card of its own (not by replacing a card in place, unless the
        // re-ask only finished the same sentence).
        if (mode === 'answer' && (!replaces || options.finishesSentence === true)) {
          ownEndRef.current = Math.max(ownEndRef.current ?? span.end, span.end);
        }
        if (mode === 'answer') speechCardRef.current = entry.id;
        repeatGuard.remember(span, entry.id, Date.now());
        setAnsweredSpans((current) => [
          ...current.filter((item) => item.answerId !== entry.id),
          { span, answerId: entry.id },
        ]);
      }
      for (const id of pickedLines ?? options.coveredLines ?? []) answeredLinesRef.current.add(id);
      if (mode === 'answer' && span && pickedLines) {
        // Batch D (P0-B): a re-ask keeps the ORIGINAL answer's anchor, words and grey/auto kind, and counts
        // itself, so the rule-6 window never moves forward and a card is asked again at most MAX_REASKS times.
        const previous = lastAnsweredRef.current;
        const original = reaskOf && previous?.answerId === reaskOf ? previous : null;
        const words =
          options.exact?.words ??
          wordCount(
            lines
              .filter((line) => pickedLines.includes(line.id))
              .map((line) => line.text)
              .join(' '),
          );
        lastAnsweredRef.current = {
          answerId: entry.id,
          lineIds: pickedLines,
          end: span.end,
          start: span.start,
          askedAt: Date.now(),
          auto: original ? original.auto : auto,
          ...((original ? original.grey : greyPress && !auto) ? { grey: true } : {}),
          words,
          anchorStart: original
            ? (original.anchorStart ?? original.start ?? span.start)
            : span.start,
          anchorEnd: original ? (original.anchorEnd ?? original.end) : span.end,
          reasks: original ? (original.reasks ?? 0) + 1 : 0,
          ...(original
            ? original.askedText !== undefined
              ? { askedText: original.askedText }
              : {}
            : options.exact
              ? { askedText: options.exact.text }
              : {}),
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
        // Batch D (P0-C): a re-ask on a new card is linked to the card it asks again, too.
        ...(reaskOf ? { rerunOf: reaskOf } : {}),
        trigger:
          options.trigger ??
          (auto ? 'auto' : options.span ? 'answer-this' : mode === 'chat' ? 'chat' : 'hotkey'),
        mode,
        askedAt: Math.round(sentWall - (performance.now() - keyPressAt)),
        speechEnd: span?.end ?? null,
        sentAt: sentWall,
        status: 'streaming',
        bytes: JSON.stringify(built.request).length,
        // Batch C (P2-1): how many document parts went with it (a count only).
        documentChunks: built.request.documentChunks?.length ?? 0,
        // ADR-0076 (timing trace): which lines and how many words were asked (ids and counts only).
        ...(pickedLines ? { lineIds: [...pickedLines] } : {}),
        ...(span ? { span: { start: span.start, end: span.end } } : {}),
        ...(options.exact ? { askedWords: options.exact.words } : {}),
        ...(options.exact?.incomplete ? { incomplete: true } : {}),
        ...(speculative ? { speculative: true } : {}),
      });
      if (speculative && before) {
        const askedIds = pickedLines ?? [];
        heldRef.current = {
          answerId: entry.id,
          asked: {
            lineIds: askedIds,
            end: span?.end ?? sentWall,
            lineWords: wordCount(
              lines
                .filter((line) => askedIds.includes(line.id))
                .map((line) => line.text)
                .join(' '),
            ),
          },
          show: () => {
            update(entry.id, { held: false });
            setShownId(entry.id);
            const finish = heldFinish.current.get(entry.id);
            heldFinish.current.delete(entry.id);
            finish?.();
          },
          cancel: () => {
            // Silently: the request stops, the card never existed, the speech is unanswered again.
            runner.cancel();
            heldFinish.current.delete(entry.id);
            logRef.current = before.log;
            answeredEndRef.current = before.answeredEnd;
            ownEndRef.current = before.ownEnd;
            if (streamingIdRef.current === entry.id) streamingIdRef.current = null;
            speechCardRef.current = before.speechCard;
            lastAnsweredRef.current = before.last;
            answeredLinesRef.current = before.lines;
            finishedRef.current = before.finished;
            labelsRef.current = before.labels;
            idleSinceRef.current = before.idleSince;
            repeatGuard.forget(entry.id);
            setAnsweredSpans((current) => current.filter((item) => item.answerId !== entry.id));
            setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
            callTimings.noteAnswer({ answerId: timingId, status: 'cancelled', doneAt: Date.now() });
            cancelEpochRef.current += 1;
          },
        };
        callTimings.noteTrace('speculative', { state: 'sent', answerId: entry.id });
        hold.start(entry.id, {
          onShow: () => {
            const held = heldRef.current;
            if (held?.answerId !== entry.id) return;
            heldRef.current = null;
            held.show();
          },
          onCancel: () => {
            const held = heldRef.current;
            if (held?.answerId !== entry.id) return;
            heldRef.current = null;
            held.cancel();
          },
        });
      }
      /**
       * Runs an answer's finishing work now, or (Batch C, P1-1) when its card is shown, while it is held.
       *
       * @param finish The work.
       */
      const whenShown = (finish: () => void) => {
        if (hold.holding(entry.id)) heldFinish.current.set(entry.id, finish);
        else finish();
      };
      let retries = 0;
      let firstWordLogged = false;
      runner.run(built.request, keyPressAt, {
        // ADR-0076 (timing trace): the request's phases.
        onPhase: (phase, at) =>
          callTimings.noteAnswer({
            answerId: timingId,
            ...(phase === 'body-ready'
              ? { bodyReadyAt: at }
              : phase === 'fetch'
                ? { fetchAt: at }
                : { headersAt: at }),
          }),
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
          callTimings.noteAnswer({ answerId: timingId, metaAt: Date.now() });
          if (dropped(type)) callTimings.noteAnswer({ answerId: timingId, status: 'none' });
          // ADR-0076: no card is left for this speech, so a later press has none to show.
          if (dropped(type) && speechCardRef.current === entry.id) speechCardRef.current = null;
          // Batch D (P1-G): auto-answer put no card up for these words, so a press must still answer them.
          if (dropped(type) && auto && lastAnsweredRef.current?.answerId === entry.id) {
            ownEndRef.current = ownEndBefore;
          }
          // Claude could not make sense of the words either (ADR-0043): no answer to show. The
          // entry goes, and the user gets the same notice as when the rules catch it first.
          // v1.4 (ADR-0065): or the words ask nothing ("can you repeat that?", a remark). The entry goes
          // the same way; a press of Answer gets a short notice, auto-answer stays silent, and the lines
          // stay answered (they are not noise, but there is nothing to answer in them).
          if (dropped(type)) {
            // Batch C (P1-1): nothing to show, so nothing to hold either.
            if (hold.holding(entry.id)) {
              hold.drop();
              heldRef.current = null;
              heldFinish.current.delete(entry.id);
            }
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
          if (streamingIdRef.current === entry.id) streamingIdRef.current = null;
          if (!dropped(meta?.type)) {
            callTimings.noteAnswer({ answerId: timingId, status: 'done', doneAt: Date.now() });
          }
          // ADR-0076 (timing trace): the server's timings and the cache token counts (numbers only).
          callTimings.noteAnswer({
            answerId: timingId,
            ...(done.serverMs
              ? { serverMs: { ...(done.serverMs as unknown as Record<string, number>) } }
              : {}),
            cacheRead: done.usage?.cache_read_input_tokens ?? 0,
            cacheWrite: done.usage?.cache_creation_input_tokens ?? 0,
            inputTokens: done.usage?.input_tokens ?? 0,
          });
          // Not an answer: nothing to keep, send later or save.
          if (dropped(meta?.type)) return;
          // Batch C (P1-1): an answer that finished while still held is kept and saved once it is shown
          // (never when it is cancelled).
          whenShown(() => {
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
              // Finishing runs only once the card shows.
              held: false,
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
              .save(toStored(finished, session.id, callStartedAt, callId))
              .catch(() => setSaveFailed(true));
          });
        },
        onError: (failure) => {
          idleSinceRef.current = Date.now();
          if (streamingIdRef.current === entry.id) streamingIdRef.current = null;
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
      callId,
      runner,
      repeatGuard,
      update,
      resolvedAnswered,
      hold,
      chunkIndex,
    ],
  );

  /**
   * ADR-0076 (E3 rules 3, 4, 7, 8): what a press does once the other side is caught up: a new card for the
   * newest unanswered speech, or a notice saying what happened. Every decision goes to the timing trace.
   *
   * @param trigger    What asked (the key or a button).
   * @param keyPressAt When the key was pressed (performance.now()).
   * @param incomplete True when the press gave up waiting (rule 2).
   */
  const decideNewest = useCallback(
    (trigger: AnswerTrigger, keyPressAt: number, incomplete: boolean) => {
      const decided = (decision: string, extra: Record<string, number | boolean> = {}) =>
        callTimings.noteTrace('press-decision', { decision, trigger, ...extra });
      const lines = transcript.lines().filter((line) => !noiseLinesRef.current.has(line.id));
      if (!lines.some((line) => line.speaker === 'them' && !line.gap)) {
        setNotice('Nothing from the other person yet. Type a question in Chat instead.');
        decided('nothing-new');
        return;
      }
      // Batch D (P1-G): a press answers everything after the speech answered on cards of their own, so words
      // a re-ask took into an earlier card's question get a card of their own now.
      const choice = chooseNewest({
        lines,
        answeredEnd: ownEndRef.current,
        lastAnswerId: speechCardRef.current,
      });
      if (choice.kind === 'answer') {
        // Covered by a re-ask (in place) but not by a card of its own: answered again, on its own card.
        const afterReask = (answeredEndRef.current ?? Number.NEGATIVE_INFINITY) > choice.span.start;
        const sent = ask('answer', {
          pressedAt: keyPressAt,
          trigger,
          exact: {
            text: choice.text,
            lineIds: choice.lineIds,
            span: choice.span,
            grey: choice.grey,
            words: choice.words,
            ...(incomplete ? { incomplete: true } : {}),
            ...(choice.audioLost ? { audioLost: true } : {}),
          },
        });
        if (sent) lastPressEndRef.current = choice.span.end;
        decided(sent ? 'sent' : 'not-sent', {
          words: choice.words,
          segments: choice.segments,
          grey: choice.grey,
          incomplete,
          ...(choice.audioLost ? { audioLost: true } : {}),
          ...(afterReask ? { afterReask: true } : {}),
        });
        return;
      }
      if (choice.kind === 'show-existing') {
        const streaming = runner.busy() && lastAnsweredRef.current?.answerId === choice.answerId;
        setShownId(choice.answerId);
        // Batch D (P1-G): when that card answered their words since the user's last press (auto-answer did),
        // it IS the answer to this press: shown with no notice. "Nothing new" only when nothing was said
        // since the last press.
        const answersNewWords =
          (ownEndRef.current ?? Number.NEGATIVE_INFINITY) >
          (lastPressEndRef.current ?? Number.NEGATIVE_INFINITY);
        setNotice(
          streaming ? ALREADY_ANSWERING_NOTICE : answersNewWords ? null : SHOWING_EARLIER_NOTICE,
        );
        lastPressEndRef.current = ownEndRef.current;
        decided(
          streaming ? 'ignored-streaming' : answersNewWords ? 'shown-answer' : 'shown-existing',
        );
        return;
      }
      setNotice(choice.kind === 'gap' ? GAP_NOTICE : NOTHING_NEW_NOTICE);
      decided(choice.kind === 'gap' ? 'gap' : 'nothing-new');
    },
    [ask, runner, transcript],
  );

  /**
   * ADR-0076 (E3 rule 2, G1–G3): a press under the 'newest' rules. It waits until the other side is
   * transcribed up to the press (at most the caller's cap); "Finishing the question…" shows only after
   * FINISHING_NOTICE_AFTER_MS; a second press while waiting answers at once.
   *
   * @param trigger What asked.
   */
  const pressNewest = useCallback(
    (trigger: AnswerTrigger) => {
      const keyPressAt = performance.now();
      const receivedAt = Date.now();
      callTimings.noteTrace('press', { trigger });
      if (!isOnline()) {
        setNotice(OFFLINE_TEXT);
        callTimings.noteTrace('press-decision', { decision: 'offline', trigger });
        return;
      }
      // Batch C (P1-1): the user wants the answer being held: it shows at once (its speech is answered, so
      // the press below says "Already answering" unless something newer was said).
      if (hold.release())
        callTimings.noteTrace('press-decision', { decision: 'released', trigger });
      const waiting = pendingCatchUpRef.current;
      if (waiting) {
        callTimings.noteTrace('press-again', { trigger });
        waiting.force();
        return;
      }
      let settled = false;
      const noticeTimer = setTimeout(() => {
        if (!settled) setNotice(FINISHING_NOTICE);
      }, FINISHING_NOTICE_AFTER_MS);
      const settle = (waitedMs: number, timedOut: boolean, forced: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(noticeTimer);
        pendingCatchUpRef.current = null;
        callTimings.noteTrace('press-wait', { waitedMs, timedOut, forced });
        setNotice((current) => (current === FINISHING_NOTICE ? null : current));
        decideNewest(trigger, keyPressAt, timedOut || forced);
      };
      pendingCatchUpRef.current = {
        force: () => settle(Date.now() - receivedAt, false, true),
      };
      const wait =
        catchUpRef.current?.(receivedAt) ?? Promise.resolve({ waitedMs: 0, timedOut: false });
      wait.then(
        (outcome) => settle(outcome.waitedMs, outcome.timedOut, false),
        () => settle(Date.now() - receivedAt, true, false),
      );
    },
    [decideNewest, hold],
  );

  // Batch C (P1-1): a held speculative answer is cancelled when the other person goes on: new words in the
  // transcript, or (Flux) their turn resumed.
  useEffect(
    () =>
      transcript.subscribe(() => {
        const held = heldRef.current;
        if (held && themWentOn(transcript.lines(), held.asked)) hold.activity();
      }),
    [transcript, hold],
  );
  const themTurns = input.themTurns;
  useEffect(() => {
    if (!themTurns) return;
    return themTurns((event) => {
      if (event === 'resumed' && heldRef.current) hold.activity();
    });
  }, [themTurns, hold]);

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
      pendingCatchUpRef.current = null;
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
  // Batch C (P1-1): a held speculative answer is in no list until its hold ends.
  const history = useMemo(
    () =>
      mergeAnswers(
        entries.filter((entry) => !entry.held),
        (entry) => entry.askedAt,
      ),
    [entries],
  );
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
      (trigger?: AnswerTrigger) => {
        // ADR-0076: the E3 rules in calls with cloud transcription.
        if (rules === 'newest') pressNewest(trigger ?? 'hotkey');
        else void ask('answer', { ...(trigger ? { trigger } : {}) });
      },
      [ask, pressNewest, rules],
    ),
    autoNewest: useCallback(
      (decision: NewestAutoDecision) => {
        // A re-ask of a press's card stays a press (no "Auto" mark).
        const pressRerun = decision.kind === 'rerun' && lastAnsweredRef.current?.auto === false;
        // Batch D (P0-C, decision D2): a re-ask replaces its card only while the first answer still streams,
        // or when the added words just finish the same sentence; otherwise it gets a new card linked to the
        // first, so a finished answer to a different question is never overwritten.
        const inPlace =
          decision.kind === 'rerun' &&
          (decision.sameSentence ||
            (runner.busy() && streamingIdRef.current === decision.replaces));
        callTimings.noteTrace('auto', {
          kind: decision.kind,
          words: decision.words,
          sinceEndMs: Date.now() - decision.tEnd,
        });
        if (decision.kind === 'rerun') {
          // Batch D (trace): every re-ask with why it happened and where it went. Ids and codes only.
          callTimings.noteTrace('reask', {
            reason: decision.reason,
            card: inPlace ? 'same' : 'new',
            sameSentence: decision.sameSentence,
            of: decision.replaces,
            press: pressRerun,
            words: decision.words,
          });
        }
        void ask('answer', {
          ...(pressRerun ? { trigger: 'rerun' as const } : { auto: true }),
          ...(decision.kind === 'rerun'
            ? inPlace
              ? {
                  replaces: decision.replaces,
                  ...(decision.sameSentence ? { finishesSentence: true } : {}),
                }
              : { rerunOf: decision.replaces }
            : {}),
          // Batch C (P1-1): a new auto-answer, sent at the end of turn, is held hidden for 400 ms first.
          ...(decision.kind === 'answer' ? { speculative: true } : {}),
          exact: {
            text: decision.text,
            lineIds: decision.lineIds,
            span: decision.span,
            grey: false,
            words: decision.words,
          },
        });
      },
      [ask, runner],
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
      () => ({
        ...resolvedAnswered(),
        idleSince: idleSinceRef.current,
        answeredEnd: answeredEndRef.current,
        epoch: cancelEpochRef.current,
      }),
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
