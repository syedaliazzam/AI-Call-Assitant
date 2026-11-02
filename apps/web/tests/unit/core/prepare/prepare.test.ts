/**
 * Tests: apps/web/src/core/prepare (client.ts, speech.ts, mockSession.ts) and
 * core/storage/questionBanks.ts. The client never throws; speaking always finishes, whether the
 * voice ends, fails, never starts or does not exist; a finished interview becomes a Mock session
 * that leaves its source alone; a question bank is replaced by a new one and goes with its session.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepare } from '@/core/prepare/client';
import { saveMockInterview } from '@/core/prepare/mockSession';
import { speak, stopSpeaking, type SpeechDeps } from '@/core/prepare/speech';
import { listAnswers } from '@/core/storage/answers';
import { DB_NAME, forgetDb } from '@/core/storage/db';
import { listDocuments } from '@/core/storage/documents';
import { getNotes } from '@/core/storage/notes';
import { getQuestionBank, saveQuestionBank } from '@/core/storage/questionBanks';
import { createSessionWithDocuments, deleteSession, getSession } from '@/core/storage/sessions';
import { listUtterances } from '@/core/storage/utterances';
import { sessionInput } from '../storage/helpers';

/** An invented session context, as requests carry it. */
const CONTEXT = {
  type: 'interview',
  company: 'A',
  role: 'B',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

beforeEach(async () => {
  forgetDb();
  await Dexie.delete(DB_NAME);
});

describe('prepare', () => {
  it('returns the reply', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ questions: ['One?'] }),
    ) as unknown as typeof fetch;
    expect(
      await prepare({ kind: 'mock-questions', session: CONTEXT, count: 1 }, fetchImpl),
    ).toEqual({ ok: true, data: { questions: ['One?'] } });
  });

  it('turns failures into messages', async () => {
    const reply = (status: number, body: unknown) =>
      vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
    const request = { kind: 'question-bank', session: CONTEXT } as const;
    expect(await prepare(request, reply(401, { code: 'unauthorized' }))).toMatchObject({
      ok: false,
      message: expect.stringContaining('signed out'),
    });
    const other = await prepare(request, reply(502, { code: 'upstream_error', message: 'detail' }));
    expect(JSON.stringify(other)).not.toContain('detail');
    const offline = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await prepare(request, offline)).ok).toBe(false);
  });
});

describe('speak', () => {
  /**
   * Fake browser objects.
   *
   * @param behaviour What the voice does when asked to speak.
   * @returns The objects, and the timer callback.
   */
  function fake(behaviour: 'end' | 'error' | 'silent' | 'throw') {
    const timers: (() => void)[] = [];
    const cancel = vi.fn();
    const deps: SpeechDeps = {
      synthesis: {
        cancel,
        speak: (utterance) => {
          if (behaviour === 'throw') throw new Error('no voice');
          if (behaviour === 'end') utterance.onend?.({} as SpeechSynthesisEvent);
          if (behaviour === 'error') utterance.onerror?.({} as SpeechSynthesisErrorEvent);
        },
      },
      createUtterance: () => ({}) as SpeechSynthesisUtterance,
      setTimer: (callback) => {
        timers.push(callback);
        return () => undefined;
      },
    };
    return { deps, timers, cancel };
  }

  it('says true when the voice finished', async () => {
    expect(await speak('Hello', fake('end').deps)).toBe(true);
  });

  it('says false when the voice fails or throws', async () => {
    expect(await speak('Hello', fake('error').deps)).toBe(false);
    expect(await speak('Hello', fake('throw').deps)).toBe(false);
  });

  it('finishes by itself when a voice never starts', async () => {
    const { deps, timers, cancel } = fake('silent');
    const done = speak('Hello', deps);
    timers[0]!();
    expect(await done).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it('says false where there is no speech at all', async () => {
    const deps: SpeechDeps = { ...fake('end').deps, synthesis: null };
    expect(await speak('Hello', deps)).toBe(false);
    expect(() => stopSpeaking(deps)).not.toThrow();
  });
});

describe('saveMockInterview', () => {
  const ITEMS = [
    { question: 'Why us?', answer: 'I like freight.', feedback: 'Add a number.' },
    { question: 'Tell me about SQL.', answer: 'Four years.', feedback: 'Good and short.' },
  ];
  const SUMMARY = { summary: ['Clear answers.'], nextSteps: ['Use more numbers.'] };

  it('becomes an ended Mock session, with the call, feedback and summary', async () => {
    const source = await createSessionWithDocuments(
      sessionInput({ saveTranscript: false }),
      [{ name: 'cv.txt', text: 'Experience (invented).' }],
      1,
    );
    const id = await saveMockInterview(source.id, ITEMS, SUMMARY, 1_000, 2_000);

    const saved = await getSession(id);
    expect(saved).toMatchObject({ type: 'mock', status: 'ended', saveTranscript: true });
    expect((await listDocuments(id)).map((document) => document.name)).toEqual(['cv.txt']);

    const lines = await listUtterances(id);
    expect(lines.map((line) => [line.speaker, line.text])).toEqual([
      ['them', 'Why us?'],
      ['you', 'I like freight.'],
      ['them', 'Tell me about SQL.'],
      ['you', 'Four years.'],
    ]);
    const answers = await listAnswers(id);
    expect(answers.map((answer) => answer.text)).toEqual(['Add a number.', 'Good and short.']);
    // Each feedback comes after the answer it is about.
    expect(answers[0]!.createdAt).toBeGreaterThan(lines[1]!.tStart);
    expect(answers[0]!.createdAt).toBeLessThan(lines[2]!.tStart);

    const notes = await getNotes(id);
    expect(notes?.notes.summary).toEqual(['Clear answers.']);
    expect(notes?.notes.nextSteps).toEqual([{ step: 'Use more numbers.', owner: 'You' }]);
    expect(notes?.notes.questions).toHaveLength(2);
  });

  it('leaves the session it came from as it was', async () => {
    const source = await createSessionWithDocuments(sessionInput(), [], 1);
    await saveMockInterview(source.id, ITEMS, SUMMARY, 1_000, 2_000);
    expect(await getSession(source.id)).toEqual(source);
    expect(await listUtterances(source.id)).toEqual([]);
  });

  it('still saves the answers when the summary could not be written', async () => {
    const source = await createSessionWithDocuments(sessionInput(), [], 1);
    const id = await saveMockInterview(source.id, ITEMS, null, 1_000, 2_000);
    expect(await getNotes(id)).toBeNull();
    expect(await listAnswers(id)).toHaveLength(2);
  });
});

describe('question banks', () => {
  const GROUPS = [
    { type: 'role' as const, questions: [{ question: 'Why this role?', answer: 'I like data.' }] },
  ];

  it('stores one per session, a new one replacing the old', async () => {
    await saveQuestionBank({ sessionId: 's', groups: GROUPS, createdAt: 1 });
    await saveQuestionBank({ sessionId: 's', groups: [], createdAt: 2 });
    expect(await getQuestionBank('s')).toEqual({ sessionId: 's', groups: [], createdAt: 2 });
    expect(await getQuestionBank('other')).toBeNull();
  });

  it('goes with its session', async () => {
    const session = await createSessionWithDocuments(sessionInput(), [], 1);
    await saveQuestionBank({ sessionId: session.id, groups: GROUPS, createdAt: 1 });
    expect((await deleteSession(session.id)).questionBanks).toBe(1);
    expect(await getQuestionBank(session.id)).toBeNull();
  });
});
