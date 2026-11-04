/**
 * File: apps/web/src/features/prepare/MockInterview.tsx
 * Purpose: The Mock Interview page: Kite plays the interviewer. It writes questions from a session's
 *          job description and resume, reads each aloud with the browser's own voice, listens through
 *          the microphone with Kite's on-device speech-to-text (or takes a typed answer), gives brief
 *          feedback on each answer, sums up at the end, and saves it all as a Mock session.
 * Used by: app/(app)/mock/page.tsx; tests/integration/harness/prepare.tsx
 * Depends on: src/core/prepare (client, speech, mockSession), src/core/stt/sttEngine.ts,
 *             src/core/answer/warm.ts (toSessionContext), src/core/storage (sessions, documents),
 *             src/platform (getMicStream), src/ui (Button, LinkButton, PageShell, Select, Textarea)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0029
 *
 * The microphone is open only while listening, never while a question is read, so Kite's own voice
 * is not transcribed as the answer. Audio stays on this device. Answers are never logged.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MockItem, MockSummaryResponse } from '@kite/shared';
import { toSessionContext } from '@/core/answer/warm';
import { prepare } from '@/core/prepare/client';
import { saveMockInterview } from '@/core/prepare/mockSession';
import { speak, stopSpeaking } from '@/core/prepare/speech';
import { listDocuments } from '@/core/storage/documents';
import { listSessions } from '@/core/storage/sessions';
import type { Session, StoredDocument } from '@/core/storage/types';
import { createSttEngine, type SttEngine, type SttEngineOptions } from '@/core/stt/sttEngine';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { LinkButton } from '@/ui/LinkButton';
import { PageShell } from '@/ui/PageShell';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { sessionChoiceLabel } from './QuestionBank';

/** What the page needs from outside (the harness replaces them). */
export interface MockInterviewDeps {
  /** Creates the speech-to-text engine. */
  createEngine?: (
    options: SttEngineOptions,
  ) => Pick<SttEngine, 'attach' | 'detach' | 'drain' | 'stop'>;
  /** Opens the microphone. */
  getMic?: () => Promise<MediaStream>;
  /** Reads text aloud. */
  speak?: (text: string) => Promise<boolean>;
}

/** Where the interview is. */
type Phase =
  /** Choosing a session. */
  | 'choose'
  /** Writing the questions. */
  | 'writing'
  /** Reading a question aloud. */
  | 'asking'
  /** Waiting for the answer. */
  | 'listening'
  /** Writing the feedback. */
  | 'judging'
  /** Showing the feedback. */
  | 'feedback'
  /** Summing up and saving. */
  | 'finishing'
  /** Saved. */
  | 'done';

/** How many questions can be chosen. */
const COUNT_OPTIONS = [
  { value: '3', label: '3 questions' },
  { value: '5', label: '5 questions' },
  { value: '8', label: '8 questions' },
];

/**
 * The Mock Interview page.
 *
 * @param props.deps What the page needs from outside (the harness replaces them).
 * @returns The page.
 * Rendered by: app/(app)/mock/page.tsx
 */
export function MockInterview({
  deps = {},
}: {
  /** What the page needs from outside. */
  deps?: MockInterviewDeps;
}) {
  // null while loading.
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [chosenId, setChosenId] = useState('');
  const [count, setCount] = useState('5');
  const [phase, setPhase] = useState<Phase>('choose');
  const [questions, setQuestions] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [heard, setHeard] = useState('');
  const [partial, setPartial] = useState('');
  const [typed, setTyped] = useState('');
  const [micProblem, setMicProblem] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [items, setItems] = useState<MockItem[]>([]);
  const [summary, setSummary] = useState<MockSummaryResponse | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const engine = useRef<Pick<SttEngine, 'attach' | 'detach' | 'drain' | 'stop'> | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const context = useRef<{ session: Session; documents: StoredDocument[] } | null>(null);
  const startedAt = useRef(0);
  const heardRef = useRef('');
  const partialRef = useRef('');
  // False once the page has closed: a late reply must not change anything.
  const alive = useRef(true);
  const speakFn = deps.speak ?? speak;

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((rows) => {
        if (cancelled) return;
        // An interview needs a job: regular calls do not belong here.
        const usable = rows.filter((session) => session.type !== 'regular');
        setSessions(usable);
        setChosenId(usable[0]?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Stops the microphone, the engine and the voice. */
  const release = useCallback(() => {
    stopSpeaking();
    for (const track of mic.current?.getTracks() ?? []) track.stop();
    mic.current = null;
    engine.current?.stop();
    engine.current = null;
  }, []);

  // Leaving the page ends everything.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  /**
   * Reads a question aloud, then starts listening.
   *
   * @param question The question.
   */
  const ask = useCallback(
    async (question: string) => {
      setPhase('asking');
      heardRef.current = '';
      partialRef.current = '';
      setHeard('');
      setPartial('');
      setTyped('');
      setFeedback('');
      await speakFn(question);
      if (!alive.current) return;
      setPhase('listening');
      // Open only now, so the question's own sound is not taken for the answer.
      if (engine.current && mic.current) {
        await engine.current.attach('you', mic.current).catch(() => setMicProblem(true));
      }
    },
    [speakFn],
  );

  /** Writes the questions, gets the microphone ready, and asks the first. */
  async function start() {
    const session = sessions?.find((candidate) => candidate.id === chosenId);
    if (!session) return;
    setFailure(null);
    setItems([]);
    setPhase('writing');
    const documents = await listDocuments(session.id);
    context.current = { session, documents };
    startedAt.current = Date.now();
    const outcome = await prepare({
      kind: 'mock-questions',
      session: toSessionContext(session, documents),
      count: Number(count),
    });
    if (!alive.current) return;
    if (!outcome.ok || outcome.data.questions.length === 0) {
      setFailure(
        outcome.ok ? 'Paramount AI could not write any questions. Try again.' : outcome.message,
      );
      setPhase('choose');
      return;
    }
    // A failure here leaves typed answers working, so the interview can still go on.
    try {
      mic.current = await (deps.getMic ?? (() => getPlatform().getMicStream()))();
      const create = deps.createEngine ?? createSttEngine;
      engine.current = create({
        onPartial: ({ channel, text }) => {
          if (channel !== 'you' || !alive.current) return;
          partialRef.current = text;
          setPartial(text);
        },
        onFinal: ({ channel, text }) => {
          if (channel !== 'you' || !alive.current) return;
          heardRef.current = heardRef.current ? `${heardRef.current} ${text}` : text;
          partialRef.current = '';
          setHeard(heardRef.current);
          setPartial('');
        },
        onError: () => {
          if (alive.current) setMicProblem(true);
        },
      });
    } catch {
      setMicProblem(true);
    }
    if (!alive.current) return;
    setQuestions(outcome.data.questions);
    setIndex(0);
    await ask(outcome.data.questions[0]!);
  }

  /** Takes the answer given so far and asks for feedback on it. */
  async function finishAnswer() {
    const current = context.current;
    if (!current) return;
    setPhase('judging');
    if (engine.current) {
      // Stopping the channel turns what is still being heard into a final line.
      engine.current.detach('you');
      await engine.current.drain();
      if (!alive.current) return;
    }
    // Refs, because the last final line can arrive during the wait above, after this render.
    const answer = typed.trim() || heardRef.current.trim() || partialRef.current.trim();
    const question = questions[index]!;
    const outcome = await prepare({
      kind: 'mock-feedback',
      session: toSessionContext(current.session, current.documents),
      question,
      answer: answer || '(no answer was given)',
    });
    if (!alive.current) return;
    const text = outcome.ok ? outcome.data.feedback : 'Feedback could not be written for this one.';
    setFailure(outcome.ok ? null : outcome.message);
    setItems((done) => [...done, { question, answer: answer || '(no answer)', feedback: text }]);
    setFeedback(text);
    setPhase('feedback');
  }

  /** Goes to the next question, or finishes after the last. */
  function next() {
    const following = index + 1;
    if (following >= questions.length) {
      void finish(items);
      return;
    }
    setIndex(following);
    void ask(questions[following]!);
  }

  /**
   * Sums up and saves.
   *
   * @param answered The answered questions.
   */
  async function finish(answered: readonly MockItem[]) {
    const current = context.current;
    if (!current) return;
    release();
    if (answered.length === 0) {
      setPhase('choose');
      return;
    }
    setPhase('finishing');
    const outcome = await prepare({
      kind: 'mock-summary',
      session: toSessionContext(current.session, current.documents),
      items: [...answered],
    });
    if (!alive.current) return;
    const written = outcome.ok ? outcome.data : null;
    setSummary(written);
    setFailure(outcome.ok ? null : 'The summary could not be written. Your answers are saved.');
    try {
      setSavedId(await saveMockInterview(current.session.id, answered, written, startedAt.current));
    } catch {
      setFailure('The interview could not be saved on this computer.');
    }
    setPhase('done');
  }

  const question = questions[index] ?? '';
  const listening = phase === 'listening';
  const inInterview = ['asking', 'listening', 'judging', 'feedback'].includes(phase);

  return (
    <PageShell
      eyebrow="Prepare"
      title="Mock Interview"
      description="Paramount AI asks the questions out loud and listens to your answers. Your voice stays on this computer."
      width="md"
    >
      {failure && (
        <p role="alert" className="text-[13px] text-ui-danger">
          {failure}
        </p>
      )}

      {phase === 'choose' && sessions && sessions.length === 0 && (
        <section className="border border-ui-border rounded-card bg-ui-surface shadow-card px-6 py-10 text-center">
          <p className="text-[15px] text-ui-muted">
            Create an Interview or Mock session first: its job description and resume are what the
            questions come from.
          </p>
          <LinkButton href="/sessions/new?type=mock" variant="primary" className="mt-4">
            Create session
          </LinkButton>
        </section>
      )}

      {phase === 'choose' && sessions && sessions.length > 0 && (
        <section className="flex flex-col gap-4 border border-ui-border rounded-card bg-ui-surface shadow-card p-5">
          <Select
            label="Session"
            options={sessions.map((session) => ({
              value: session.id,
              label: sessionChoiceLabel(session),
            }))}
            value={chosenId}
            onChange={setChosenId}
          />
          <Select label="Length" options={COUNT_OPTIONS} value={count} onChange={setCount} />
          <p className="text-[13px] text-ui-muted">
            Use headphones if you can. The first time, Paramount AI downloads its speech model (204
            MB, one time only); you can type your answers until it is ready.
          </p>
          <div>
            <Button onClick={() => void start()}>Start interview</Button>
          </div>
        </section>
      )}

      {phase === 'writing' && (
        <p role="status" className="text-[13px] text-ui-muted">
          Writing your questions…
        </p>
      )}

      {inInterview && (
        <section
          aria-label="Interview"
          className="flex flex-col gap-4 border border-ui-border rounded-card bg-ui-surface shadow-card p-5"
        >
          <p className="text-[13px] font-medium text-ui-muted">
            Question {index + 1} of {questions.length}
          </p>
          <p aria-label="Question" className="text-[18px] font-semibold text-ui-heading">
            {question}
          </p>
          {phase === 'asking' && (
            <p role="status" className="text-[13px] text-ui-muted">
              Paramount AI is asking…
            </p>
          )}
          {listening && (
            <>
              <p role="status" className="text-[13px] text-ui-muted">
                {micProblem
                  ? 'The microphone is not available. Type your answer below.'
                  : 'Listening. Answer out loud, then press Done.'}
              </p>
              {(heard || partial) && (
                <p
                  aria-label="What Paramount AI heard"
                  className="rounded-control bg-ui-band px-3 py-2 text-[15px]"
                >
                  {heard} <span className="text-ui-muted">{partial}</span>
                </p>
              )}
              <Textarea
                label="Or type your answer"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                rows={3}
                maxLength={8_000}
              />
              <div>
                <Button onClick={() => void finishAnswer()}>Done</Button>
              </div>
            </>
          )}
          {phase === 'judging' && (
            <p role="status" className="text-[13px] text-ui-muted">
              Paramount AI is thinking about your answer…
            </p>
          )}
          {phase === 'feedback' && (
            <>
              <p
                aria-label="Feedback"
                className="rounded-control border border-ui-accent bg-ui-pale px-3 py-2 text-[15px] text-ui-text"
              >
                {feedback}
              </p>
              <div>
                <Button onClick={next}>
                  {index + 1 >= questions.length ? 'Finish' : 'Next question'}
                </Button>
              </div>
            </>
          )}
          {phase !== 'judging' && (
            <div>
              <Button variant="ghost" size="sm" onClick={() => void finish(items)}>
                End interview
              </Button>
            </div>
          )}
        </section>
      )}

      {phase === 'finishing' && (
        <p role="status" className="text-[13px] text-ui-muted">
          Summing up and saving…
        </p>
      )}

      {phase === 'done' && (
        <section
          aria-label="Summary"
          className="flex flex-col gap-3 border border-ui-border rounded-card bg-ui-surface shadow-card p-5"
        >
          <h2 className="text-[18px] font-semibold text-ui-heading">How it went</h2>
          {summary && (
            <>
              <ul className="list-disc space-y-1 pl-5 text-[15px] text-ui-text">
                {summary.summary.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {summary.nextSteps.length > 0 && (
                <>
                  <h3 className="text-[15px] font-semibold text-ui-heading">Practise next</h3>
                  <ul className="list-disc space-y-1 pl-5 text-[15px] text-ui-text">
                    {summary.nextSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {savedId && (
              <LinkButton href={`/sessions/${savedId}`} variant="primary">
                Review this interview
              </LinkButton>
            )}
            <Button variant="secondary" onClick={() => setPhase('choose')}>
              New interview
            </Button>
          </div>
        </section>
      )}
    </PageShell>
  );
}
