/**
 * File: apps/web/src/core/answer/latency.ts
 * Purpose: The answer latency measurement behind /dev/latency (day-04-answers.md Stage 11):
 *          on an invented session and a call transcript that grows between answers, sends the
 *          warm-up and then N answers one after another through the real client path
 *          (buildAnswerRequest → createAnswerRunner → /api/answer), and summarises key press →
 *          request sent → first word → headline complete → done as p50/p95, with each
 *          request's cache read and write.
 * Used by: src/features/dev/LatencyTest.tsx
 * Depends on: src/core/answer (context.ts, answerClient.ts, warm.ts),
 *             src/core/transcript/transcript.ts, src/core/stt/metrics.ts (percentile)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (latency targets and levers);
 *               day-04-answers.md Stage 11
 *
 * Everything here is invented. Results hold numbers only (no question or answer text), so
 * they can be copied into docs/testing/benchmark-results.md.
 */
import type { Session, StoredDocument } from '../storage/types';
import { percentile } from '../stt/metrics';
import { createTranscript } from '../transcript/transcript';
import { createAnswerRunner, type AnswerTimeline, type streamAnswer } from './answerClient';
import { buildAnswerRequest, emptyLog, type CallAnswer } from './context';
import { warmSession } from './warm';

/** One measured answer (numbers only). */
export interface LatencySample extends AnswerTimeline {
  /** Which answer (1-based). */
  n: number;
  /** Cache tokens read. */
  cacheRead: number;
  /** Cache tokens written. */
  cacheWrite: number;
  /** Uncached input tokens. */
  input: number;
  /** Output tokens. */
  output: number;
}

/** p50 and p95 of one timing, in ms. */
export interface Spread {
  /** Median (nearest rank). */
  p50: number;
  /** 95th percentile (nearest rank). */
  p95: number;
}

/** The summary of a run. */
export interface LatencySummary {
  /** Answers measured. */
  count: number;
  /** Key press → request sent. */
  toSent: Spread;
  /** Key press → first word. */
  toFirstWord: Spread;
  /** Key press → headline complete. */
  toHeadline: Spread;
  /** Key press → done. */
  toDone: Spread;
  /** Answers that read the cache (cacheRead > 0). */
  cacheHits: number;
}

/** Options for runLatencyTest(). */
export interface LatencyOptions {
  /** How many answers (default 20). */
  count?: number;
  /** Called after each answer (for the progress line). */
  onSample?: (sample: LatencySample) => void;
  /** Sends a request (tests replace it). Default streamAnswer(). */
  send?: typeof streamAnswer;
}

/** The invented session used for the measurement. */
export const LATENCY_SESSION: Session = {
  id: 'latency-test',
  type: 'sales',
  company: 'Harbor Lane Freight (invented)',
  role: 'Pilot review',
  description: 'Invented latency test session.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: 'Harbor Lane\nBluefin Route\nProfessional plan',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 0,
  status: 'not-started',
  lastActiveAt: null,
};

/** Invented sentences the test document is built from. */
const SENTENCES = [
  'The Harbor Lane pilot covered four depots and ran for twelve weeks.',
  'Bluefin Route is the live re-routing feature; it cut late deliveries by a third.',
  'Average planning time fell from forty minutes to eighteen minutes per dispatcher.',
  'The Professional plan costs 52 dollars per seat per month, billed yearly.',
  'Onboarding is a one-time fee of 1,500 dollars covering setup and two training days.',
  'Training runs in groups of six, with one practice day before going live.',
  'Single sign-on is included in the Professional plan.',
  'Cancellation needs 30 days written notice before the renewal date.',
];

/**
 * The invented document (about 2,000 words, so the session prompt is well above the cache
 * minimum, like a real session with a document).
 *
 * @returns The document.
 * Called from: LatencyTest.tsx; runLatencyTest() callers
 */
export function latencyDocuments(): StoredDocument[] {
  const paragraphs: string[] = [];
  for (let i = 1; i <= 20; i += 1) {
    const rotated = [...SENTENCES.slice(i % 8), ...SENTENCES.slice(0, i % 8)];
    paragraphs.push(`Section ${i}. ${rotated.join(' ')}`);
  }
  const text = paragraphs.join('\n\n');
  return [
    {
      id: 'latency-doc',
      sessionId: LATENCY_SESSION.id,
      name: 'pilot-report.txt',
      text,
      chars: text.length,
      addedAt: 0,
    },
  ];
}

/** The invented questions "Them" asks, in turn (with a "You" line before each). */
const QUESTIONS = [
  'WHAT DOES THE PROFESSIONAL PLAN COST PER SEAT',
  'HOW LONG DOES THE PILOT TAKE',
  'WHAT HAPPENED TO LATE DELIVERIES',
  'HOW DOES TRAINING WORK FOR THE DISPATCHERS',
  'IS SINGLE SIGN ON INCLUDED',
  'WHAT IS THE ONBOARDING FEE',
  'HOW MUCH PLANNING TIME DID THEY SAVE',
  'WHAT IS THE CANCELLATION NOTICE PERIOD',
];

/**
 * p50 and p95 of a list of timings.
 *
 * @param values Milliseconds.
 * @returns The spread (0 for an empty list).
 * Called from: summarise()
 */
function spread(values: readonly number[]): Spread {
  return { p50: percentile(values, 50) ?? 0, p95: percentile(values, 95) ?? 0 };
}

/**
 * Summarises measured answers.
 *
 * @param samples The answers.
 * @returns p50/p95 for each timing, and how many read the cache.
 * Called from: runLatencyTest(); LatencyTest.tsx; tests
 */
export function summarise(samples: readonly LatencySample[]): LatencySummary {
  return {
    count: samples.length,
    toSent: spread(samples.map((s) => s.toSent)),
    toFirstWord: spread(samples.map((s) => s.toFirstWord)),
    toHeadline: spread(samples.map((s) => s.toHeadline)),
    toDone: spread(samples.map((s) => s.toDone)),
    cacheHits: samples.filter((s) => s.cacheRead > 0).length,
  };
}

/**
 * Runs the measurement: a warm-up, then `count` answers one after another. Before each answer,
 * two new lines are added to the invented call (a "You" line and a "Them" question), placed
 * far enough in the past to be stable, so each request appends one chunk as in a real call.
 *
 * @param options How many answers, the progress callback, and a request override (tests).
 * @returns Every sample and the summary.
 * @throws Error('ANSWER_FAILED: <code>') when an answer fails (the run stops).
 * Called from: LatencyTest.tsx; tests
 */
export async function runLatencyTest(
  options: LatencyOptions = {},
): Promise<{ samples: LatencySample[]; summary: LatencySummary }> {
  const count = options.count ?? 20;
  const documents = latencyDocuments();
  await warmSession(LATENCY_SESSION, documents, options.send ? { send: options.send } : {});

  // The invented call started an hour ago; each answer's lines sit a minute apart.
  const callStartedAt = Date.now() - 3_600_000;
  const transcript = createTranscript();
  const runner = createAnswerRunner(options.send ? { send: options.send } : {});
  let log = emptyLog();
  const answers: CallAnswer[] = [];
  const samples: LatencySample[] = [];

  for (let n = 1; n <= count; n += 1) {
    const base = callStartedAt + n * 60_000;
    transcript.addFinal({
      speaker: 'you',
      text: 'THAT IS A GOOD POINT LET ME CHECK',
      tStart: base,
      tEnd: base + 3_000,
    });
    const question = QUESTIONS[(n - 1) % QUESTIONS.length]!;
    transcript.addFinal({
      speaker: 'them',
      text: question,
      tStart: base + 8_000,
      tEnd: base + 11_000,
    });

    // The key press: from here the timeline is the one the live page measures.
    const keyPressAt = performance.now();
    const built = buildAnswerRequest({
      session: LATENCY_SESSION,
      documents,
      lines: transcript.lines(),
      answers,
      mode: 'answer',
      now: Date.now(),
      callStartedAt,
      log,
    });
    log = built.log;
    const askedAt = base + 12_000;
    const sample = await new Promise<LatencySample>((resolve, reject) => {
      runner.run(built.request, keyPressAt, {
        onText: () => undefined,
        onDone: (text, done, timeline) => {
          answers.push({ id: `a${n}`, mode: 'answer', question, text, askedAt });
          resolve({
            n,
            ...timeline,
            cacheRead: done.usage.cache_read_input_tokens,
            cacheWrite: done.usage.cache_creation_input_tokens,
            input: done.usage.input_tokens,
            output: done.usage.output_tokens,
          });
        },
        onError: (failure) => reject(new Error(`ANSWER_FAILED: ${failure.code}`)),
      });
    });
    samples.push(sample);
    options.onSample?.(sample);
  }
  return { samples, summary: summarise(samples) };
}
