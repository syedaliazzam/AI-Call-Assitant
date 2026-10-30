/**
 * File: apps/web/src/features/live/useLiveAnswers.ts
 * Purpose: React state for the answers of a live call: Answer (question from the transcript)
 *          and Chat (typed question) build a request from the session, the transcript and the
 *          earlier answers (core/answer/context.ts) and stream it (one at a time); Clear
 *          cancels; Previous/Next move through the session's answers. Each finished answer is
 *          saved on this device with its rating and note (Stage 7). While the call runs, the
 *          idle re-warm keeps Claude's cache warm (core/answer/keepWarm.ts).
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer (context.ts, answerClient.ts, warm.ts, keepWarm.ts),
 *             src/core/transcript/transcript.ts, src/core/storage (answers.ts, types.ts)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §6.3; day-04-answers.md
 *               Stages 6–7
 *
 * Logs only ids, timings and token counts; never the question or answer text.
 */
'use client';

import type { AnswerUsage, ModelTier } from '@kite/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAnswerRunner, type AnswerTimeline } from '@/core/answer/answerClient';
import { buildAnswerRequest, emptyLog, type CallAnswer } from '@/core/answer/context';
import { startKeepWarm, type KeepWarm } from '@/core/answer/keepWarm';
import { warmSession } from '@/core/answer/warm';
import { listAnswers, rateAnswer, saveAnswer, setAnswerNote } from '@/core/storage/answers';
import type { AnswerRating, Session, StoredAnswer, StoredDocument } from '@/core/storage/types';
import type { Transcript } from '@/core/transcript/transcript';

/** Where answers are saved on this device (core/storage/answers.ts; tests may replace it). */
export interface AnswerStore {
  /** Saves a finished answer. */
  save: (answer: StoredAnswer) => Promise<void>;
  /** Lists the session's saved answers, oldest first. */
  list: (sessionId: string) => Promise<StoredAnswer[]>;
  /** Sets an answer's rating. */
  rate: (id: string, rating: AnswerRating) => Promise<void>;
  /** Sets an answer's note. */
  note: (id: string, note: string) => Promise<void>;
}

/** The real store (IndexedDB through core/storage). */
const DEFAULT_STORE: AnswerStore = {
  save: saveAnswer,
  list: listAnswers,
  rate: rateAnswer,
  note: setAnswerNote,
};

/** One answer of this call (or an earlier one of the session), as the panel shows it. */
export interface AnswerEntry {
  /** Answer id (crypto.randomUUID()). */
  id: string;
  /** 'answer' (from the transcript) or 'chat' (typed). */
  mode: 'answer' | 'chat';
  /** The question answered ('' when Claude was asked to answer the latest "Them" lines). */
  question: string;
  /** How many transcript lines the question came from (0 for chat). */
  fromLines: number;
  /** The answer text so far. */
  text: string;
  /** Streaming, finished, failed, or cancelled by Clear (or a newer answer). */
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  /** The error message when it failed. */
  error?: string;
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
    mode: saved.mode === 'chat' ? 'chat' : 'answer',
    question: saved.question,
    fromLines: 0,
    text: saved.text,
    status: 'done',
    askedAt: saved.createdAt,
    model: saved.model,
    rating: saved.rating ?? null,
    note: saved.note ?? '',
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
  };
}

/** Inputs of useLiveAnswers(). */
export interface LiveAnswersInput {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /** The live transcript. */
  transcript: Transcript;
  /** When this call connected (Unix ms); a new value starts a new conversation. */
  callStartedAt: number;
  /** Where answers are saved (default: this device's IndexedDB). */
  store?: AnswerStore;
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
  /** Answers a typed question. */
  chat: (question: string) => void;
  /** Cancels a streaming answer; otherwise hides the answer shown. */
  clear: () => void;
  /** Shows the previous answer. */
  prev: () => void;
  /** Shows the next answer. */
  next: () => void;
  /** Rates an answer (saved at once). */
  rate: (id: string, rating: AnswerRating) => void;
  /** Saves an answer's note. */
  saveNote: (id: string, note: string) => void;
  /** True when a rating or note could not be saved on this device. */
  saveFailed: boolean;
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
  const store = input.store ?? DEFAULT_STORE;
  const [entries, setEntries] = useState<AnswerEntry[]>([]);
  // The answer shown, by id (null after Clear).
  const [shownId, setShownId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [runner] = useState(() => createAnswerRunner());
  // What the conversation has sent so far, and the finished answers (refs: read when asked).
  const logRef = useRef(emptyLog());
  const finishedRef = useRef<CallAnswer[]>([]);
  const keepWarmRef = useRef<KeepWarm | null>(null);
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
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
  useEffect(() => {
    logRef.current = emptyLog();
    finishedRef.current = [];
    const keepWarm = startKeepWarm({
      warm: () => warmSession(session, documents, { conversation: logRef.current.chunks }),
    });
    keepWarmRef.current = keepWarm;
    return () => {
      keepWarm.stop();
      keepWarmRef.current = null;
      runner.cancel();
    };
  }, [callStartedAt, session, documents, runner]);

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
   * @param mode  'answer' or 'chat'.
   * @param typed The typed question (chat).
   */
  const ask = useCallback(
    (mode: 'answer' | 'chat', typed?: string) => {
      const keyPressAt = performance.now();
      const lines = transcript.lines();
      if (mode === 'answer' && !lines.some((line) => line.speaker === 'them')) {
        setNotice('Nothing from the other person yet. Type a question in Chat instead.');
        return;
      }
      setNotice(null);
      const built = buildAnswerRequest({
        session,
        documents,
        lines,
        answers: finishedRef.current,
        mode,
        typedQuestion: typed,
        now: Date.now(),
        callStartedAt,
        log: logRef.current,
      });
      logRef.current = built.log;
      keepWarmRef.current?.noteActivity();
      const entry: AnswerEntry = {
        id: crypto.randomUUID(),
        mode,
        question: built.request.question ?? '',
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
      runner.run(built.request, keyPressAt, {
        onText: (text) => update(entry.id, { text }),
        onDone: (text, done, timeline) => {
          const finished: AnswerEntry = {
            ...entry,
            text,
            status: 'done',
            timeline,
            usage: done.usage,
          };
          update(entry.id, finished);
          finishedRef.current = [
            ...finishedRef.current,
            { id: entry.id, mode, question: entry.question, text, askedAt: entry.askedAt },
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
          update(entry.id, { status: 'error', error: failure.message });
          console.warn('answer: failed', {
            sessionId: session.id,
            answerId: entry.id,
            code: failure.code,
          });
        },
      });
    },
    [session, documents, transcript, callStartedAt, runner, update],
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

  const next = useCallback(() => {
    if (index === -1) return;
    setShownId(entries[Math.min(entries.length - 1, index + 1)]?.id ?? null);
  }, [entries, index]);

  return {
    entries,
    index,
    notice,
    answer: useCallback(() => ask('answer'), [ask]),
    chat: useCallback((question: string) => ask('chat', question), [ask]),
    clear,
    prev,
    next,
    rate,
    saveNote,
    saveFailed,
  };
}
