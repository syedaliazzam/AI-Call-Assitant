/**
 * File: apps/web/src/features/live/useLiveAnswers.ts
 * Purpose: React state for the answers of a live call: Answer (question from the transcript)
 *          and Chat (typed question) build a request from the session, the transcript and the
 *          earlier answers (core/answer/context.ts) and stream it (one at a time); Clear
 *          cancels; Previous/Next move through the session's answers. Each finished answer is
 *          saved on this device with its rating and note (Stage 7). While the call runs, the
 *          idle re-warm keeps Claude's cache warm (core/answer/keepWarm.ts).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer (context.ts, answerClient.ts, warm.ts, keepWarm.ts,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAnswerRunner, type AnswerTimeline } from '@/core/answer/answerClient';
import { buildClaimCorpus, checkClaims, needsClaimCheck } from '@/core/answer/claimCheck';
import { buildAnswerRequest, emptyLog, type CallAnswer } from '@/core/answer/context';
import { startKeepWarm, type KeepWarm } from '@/core/answer/keepWarm';
import { warmSession } from '@/core/answer/warm';
import { answerFailureText, OFFLINE_TEXT, type AnswerProblem } from '@/core/answer/unavailable';
import { isOnline } from '@/core/net/online';
import { prepareScreenshot } from '@/core/screenshot/prepare';
import {
  listAnswers,
  rateAnswer,
  reportAnswer,
  saveAnswer,
  setAnswerNote,
} from '@/core/storage/answers';
import type { AnswerRating, Session, StoredAnswer, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';
import { getPlatform } from '@/platform';
import { CaptureError } from '@/platform/errors';

/** Where answers are saved on this device (core/storage/answers.ts; tests may replace it). */
export interface AnswerStore {
  /** Saves a finished answer. */
  save: (answer: StoredAnswer) => Promise<void>;
  /** Lists the session's saved answers, oldest first. */
  list: (sessionId: string) => Promise<StoredAnswer[]>;
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
  list: listAnswers,
  rate: rateAnswer,
  report: reportAnswer,
  note: setAnswerNote,
};

/** One answer of this call (or an earlier one of the session), as the panel shows it. */
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
  /** How many transcript lines the question came from (0 for chat). */
  fromLines: number;
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
   * True for an answer saved earlier (a previous call, or before a reload): shown for review
   * and rating, but not part of this call's conversation.
   */
  earlier: boolean;
}

/**
 * Turns a saved answer into a panel entry (for answers from before this page opened).
 *
 * @param saved The saved answer.
 * @returns The entry, marked as earlier.
 * Called from: useLiveAnswers() (on open)
 */
function fromStored(saved: StoredAnswer): AnswerEntry {
  return {
    id: saved.id,
    mode: saved.mode,
    question: saved.question,
    fromLines: 0,
    text: saved.text,
    status: 'done',
    askedAt: saved.createdAt,
    model: saved.model,
    rating: saved.rating ?? null,
    note: saved.note ?? '',
    ...(saved.reported ? { reported: true } : {}),
    ...(saved.meta ? { meta: saved.meta } : {}),
    ...(saved.claims?.length ? { claims: saved.claims } : {}),
    earlier: true,
  };
}

/**
 * Turns a finished entry into the row saved on this device.
 *
 * @param entry     The finished entry.
 * @param sessionId Its session.
 * @returns The row.
 * Called from: useLiveAnswers() (when an answer finishes)
 */
function toStored(entry: AnswerEntry, sessionId: string): StoredAnswer {
  return {
    id: entry.id,
    sessionId,
    mode: entry.mode,
    question: entry.question,
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
  };
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
}

/** What useLiveAnswers() returns. */
export interface LiveAnswers {
  /** This call's answers, oldest first. */
  entries: AnswerEntry[];
  /** Index of the answer shown, or -1 for none (after Clear). */
  index: number;
  /** A short notice for the user (for example "nothing to answer yet"), or null. */
  notice: string | null;
  /** Answers the latest question from the transcript. */
  answer: () => void;
  /** Answers the latest question by itself (auto-answer, Day 6 Stage 4f; marked "Auto"). */
  autoAnswer: () => void;
  /** Answers a typed question. */
  chat: (question: string) => void;
  /** Cancels a streaming answer; otherwise hides the answer shown. */
  clear: () => void;
  /** Shows the previous answer. */
  prev: () => void;
  /** Shows the next answer. */
  next: () => void;
  /** Shows one answer of the call (the list under the answer shown, ADR-0030). */
  show: (id: string) => void;
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
   */
  screenshot: (question?: string) => void;
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
  // What the conversation has sent so far, and the finished answers (refs: read when asked).
  const logRef = useRef(emptyLog());
  const finishedRef = useRef<CallAnswer[]>([]);
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

  // The session's saved answers (earlier calls, or before a reload), shown before this call's.
  useEffect(() => {
    let cancelled = false;
    storeRef.current
      .list(session.id)
      .then((saved) => {
        if (cancelled || saved.length === 0) return;
        setEntries((current) => {
          const known = new Set(current.map((entry) => entry.id));
          const earlier = saved.filter((row) => !known.has(row.id)).map(fromStored);
          return [...earlier, ...current];
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  // A new call: a new conversation and the idle re-warm; End (unmount) stops both.
  const sessionId = session.id;
  useEffect(() => {
    logRef.current = emptyLog();
    finishedRef.current = [];
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
        /** A re-answer's question. */
        question?: string;
      } = {},
    ) => {
      const { typed, image, auto = false, answerType } = options;
      const keyPressAt = options.pressedAt ?? performance.now();
      // Offline: answers are paused (the banner says so); the transcript keeps going.
      if (!isOnline()) {
        setNotice(OFFLINE_TEXT);
        return;
      }
      const lines = transcript.lines();
      if (
        mode === 'answer' &&
        !options.question &&
        !lines.some((line) => line.speaker === 'them')
      ) {
        setNotice('Nothing from the other person yet. Type a question in Chat instead.');
        return;
      }
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
      });
      logRef.current = built.log;
      keepWarmRef.current?.noteActivity();
      const entry: AnswerEntry = {
        id: crypto.randomUUID(),
        mode,
        ...(auto ? { auto: true } : {}),
        question:
          built.request.question ?? (mode === 'screenshot' ? DEFAULT_SCREENSHOT_QUESTION : ''),
        ...(image ? { thumbnail: image } : {}),
        fromLines: built.selected?.lineIds.length ?? 0,
        text: '',
        status: 'streaming',
        askedAt: Date.now(),
        model: session.preferences.model,
        rating: null,
        note: '',
        earlier: false,
      };
      // A new answer cancels the one still streaming (the runner does; mark it here).
      setEntries((current) => [
        ...current.map((old) =>
          old.status === 'streaming' ? { ...old, status: 'cancelled' as const } : old,
        ),
        entry,
      ]);
      setShownId(entry.id);
      // Kept here as well as in state: the answer's end needs it in the same tick.
      let meta: AnswerMeta | undefined;
      runner.run(built.request, keyPressAt, {
        onMeta: (received) => {
          meta = received;
          update(entry.id, { meta: received });
        },
        onText: (text) => update(entry.id, { text }),
        onDone: (text, done, timeline) => {
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
          storeRef.current.save(toStored(finished, session.id)).catch(() => setSaveFailed(true));
        },
        onError: (failure) => {
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
    },
    [session, documents, lessons, transcript, callStartedAt, runner, update],
  );

  const clear = useCallback(() => {
    if (runner.busy()) {
      runner.cancel();
      setEntries((current) =>
        current.map((entry) =>
          entry.status === 'streaming' ? { ...entry, status: 'cancelled' as const } : entry,
        ),
      );
      return;
    }
    setShownId(null);
    setNotice(null);
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

  const index = entries.findIndex((entry) => entry.id === shownId);

  const prev = useCallback(() => {
    // After Clear, Previous shows the latest answer again.
    const target = index === -1 ? entries.length - 1 : Math.max(0, index - 1);
    setShownId(entries[target]?.id ?? null);
  }, [entries, index]);

  const screenshot = useCallback(
    (question?: string) => {
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
          ask('screenshot', {
            ...(question ? { typed: question } : {}),
            image: prepared.dataUrl,
            pressedAt,
          });
        } catch (error) {
          setNotice(
            error instanceof CaptureError
              ? error.message
              : 'Kite could not take a screenshot. Try again.',
          );
        } finally {
          setCapturing(false);
        }
      })();
    },
    [ask, capturing, session.id],
  );

  const next = useCallback(() => {
    if (index === -1) return;
    setShownId(entries[Math.min(entries.length - 1, index + 1)]?.id ?? null);
  }, [entries, index]);

  const reanswer = useCallback(
    (id: string, answerType: AnswerType) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      // A screenshot is kept in memory only: from an earlier page it can only go by its question.
      if (entry.mode === 'screenshot' && entry.thumbnail) {
        ask('screenshot', { typed: entry.question, image: entry.thumbnail, answerType });
      } else if (entry.mode === 'answer') {
        ask('answer', { answerType, ...(entry.question ? { question: entry.question } : {}) });
      } else {
        ask('chat', { typed: entry.question, answerType });
      }
    },
    [ask, entries],
  );

  return {
    entries,
    index,
    notice,
    answer: useCallback(() => ask('answer'), [ask]),
    autoAnswer: useCallback(() => ask('answer', { auto: true }), [ask]),
    chat: useCallback((question: string) => ask('chat', { typed: question }), [ask]),
    clear,
    prev,
    next,
    show: setShownId,
    reanswer,
    rate,
    saveNote,
    report,
    saveFailed,
    screenshot,
    capturing,
  };
}
