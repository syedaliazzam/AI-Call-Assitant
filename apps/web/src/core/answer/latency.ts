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
 *
 * ADR-0099: a run can choose the answer model (to compare Gemini, GPT, Claude Haiku and Groq) and the
 * session: the pilot review with a 2,000-word document (as before), or an interview with an invented CV.
 * Each run is one invented call with its own call id (OpenAI's prompt_cache_key), and records which model
 * really answered each request, so fallbacks to Claude Haiku are counted.
 */
import type { AnswerModel, Session, StoredDocument } from '../storage/types';
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
  /** Server: request received → first text sent, in ms. */
  serverToFirstText: number;
  /** Server: request received → Claude's stream opened, in ms. */
  serverToStreamOpen: number;
  /** ADR-0099: the model that really answered (as the server says), or null from an older server. */
  answeredBy: AnswerModel | null;
  /** ADR-0099: why the asked model's answer moved to Claude Haiku, or null when it did not. */
  fallback: 'timeout' | 'error' | 'empty' | null;
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
  /**
   * Server: request received → first text sent (sign-in check, reaching Claude, Claude's first
   * token). The rest of toFirstWord is the network between this computer and Vercel.
   */
  serverToFirstText: Spread;
  /** Answers that read the cache (cacheRead > 0). */
  cacheHits: number;
  /** ADR-0099: answers that moved to Claude Haiku (a fallback). */
  fallbacks: number;
}

/** ADR-0099: which invented session a run uses. */
export type LatencyFixture = 'pilot' | 'cv';

/** Options for runLatencyTest(). */
export interface LatencyOptions {
  /** How many answers (default 20). */
  count?: number;
  /** Called after each answer (for the progress line). */
  onSample?: (sample: LatencySample) => void;
  /** Sends a request (tests replace it). Default streamAnswer(). */
  send?: typeof streamAnswer;
  /** ADR-0099: the answer model (default the session's: Claude Haiku). */
  model?: AnswerModel;
  /** ADR-0099: the invented session: 'pilot' (default) or 'cv'. */
  fixture?: LatencyFixture;
  /** ADR-0099 measurement only: OpenAI priority processing for a GPT model (honoured for admins). */
  serviceTier?: 'priority';
}

/** The invented session used for the measurement. */
export const LATENCY_SESSION: Session = {
  id: 'latency-test',
  type: 'regular',
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

/** ADR-0099: the invented interview session with a CV. */
export const LATENCY_CV_SESSION: Session = {
  ...LATENCY_SESSION,
  id: 'latency-test-cv',
  type: 'interview',
  company: 'Lakeshore Analytics (invented)',
  role: 'Senior Backend Engineer',
  description: 'Invented latency test interview.',
  preferences: { ...LATENCY_SESSION.preferences, keyTerms: 'Lakeshore\nPostgreSQL\nKafka' },
};

/** The invented CV's sections, each a few sentences, as a real CV reads. */
const CV_SECTIONS = [
  'Alex Moreno (invented). Senior backend engineer, eight years of experience building data services in Python and Go.',
  'Experience. Brightline Payments, Senior Engineer, 2022 to now: led the move of the ledger service from a single PostgreSQL instance to a partitioned cluster, cutting p95 query time from 900 ms to 140 ms; built the Kafka event pipeline that handles 40,000 events per second; mentored four engineers.',
  'Northgate Retail, Backend Engineer, 2019 to 2022: rebuilt the order API in Go, reducing cloud spend by 30 percent; introduced contract tests between eleven services; owned the on-call rota for the checkout team.',
  'Cobalt Health, Software Engineer, 2017 to 2019: wrote the appointment reminder service in Python, sending 2 million messages a month; added structured logging and dashboards that halved the time to find incidents.',
  'Skills. Python, Go, PostgreSQL, Redis, Kafka, Kubernetes, Terraform, AWS, observability with OpenTelemetry, API design, incident response.',
  'Education. BSc Computer Science, University of Leeds (invented), 2017. Certifications: AWS Solutions Architect Associate.',
  'Projects. Open-source maintainer of a small PostgreSQL migration linter used by about 300 teams; speaker at a regional Go meetup on graceful service shutdown.',
];

/**
 * ADR-0099: the invented CV (about 250 words, as the session's resume document).
 *
 * @returns The CV document.
 * Called from: runLatencyTest()
 */
export function latencyCvDocuments(): StoredDocument[] {
  const text = CV_SECTIONS.join('\n\n');
  return [
    {
      id: 'latency-cv',
      sessionId: LATENCY_CV_SESSION.id,
      name: 'alex-moreno-cv.txt',
      text,
      chars: text.length,
      addedAt: 0,
      kind: 'resume',
    },
  ];
}

/** ADR-0099: the invented interview questions "Them" asks, in turn. */
const CV_QUESTIONS = [
  'TELL ME ABOUT A TIME YOU IMPROVED THE PERFORMANCE OF A DATABASE',
  'HOW DID YOU DESIGN THE KAFKA PIPELINE',
  'WHAT WOULD YOU DO IF A RELEASE BROKE CHECKOUT ON A FRIDAY EVENING',
  'HOW DO YOU MENTOR JUNIOR ENGINEERS',
  'WHY DO YOU WANT TO JOIN LAKESHORE',
  'WHAT IS YOUR EXPERIENCE WITH KUBERNETES',
  'HOW DO YOU APPROACH API DESIGN',
  'TELL ME ABOUT A DISAGREEMENT WITH A COLLEAGUE AND HOW YOU RESOLVED IT',
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
    fallbacks: samples.filter((s) => s.fallback !== null).length,
    serverToFirstText: spread(samples.map((s) => s.serverToFirstText)),
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
  // ADR-0099: the chosen session and model, and one call id for the run (OpenAI's prompt_cache_key).
  const cv = options.fixture === 'cv';
  const fixture = cv ? LATENCY_CV_SESSION : LATENCY_SESSION;
  const session: Session = options.model
    ? { ...fixture, preferences: { ...fixture.preferences, model: options.model } }
    : fixture;
  const questions = cv ? CV_QUESTIONS : QUESTIONS;
  const documents = cv ? latencyCvDocuments() : latencyDocuments();
  const callId = `latency-${Date.now().toString(36)}`;
  // ADR-0099: priority processing (a GPT model, admins) goes with every request of the run, warm-up included.
  const tier = options.serviceTier ? { serviceTier: options.serviceTier } : {};
  await warmSession(session, documents, {
    ...(options.send ? { send: options.send } : {}),
    callId,
    ...tier,
  });

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
    const question = questions[(n - 1) % questions.length]!;
    transcript.addFinal({
      speaker: 'them',
      text: question,
      tStart: base + 8_000,
      tEnd: base + 11_000,
    });

    // The key press: from here the timeline is the one the live page measures.
    const keyPressAt = performance.now();
    const built = buildAnswerRequest({
      session,
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
      runner.run({ ...built.request, callId, ...tier }, keyPressAt, {
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
            serverToFirstText: done.serverMs.toFirstText,
            serverToStreamOpen: done.serverMs.toStreamOpen,
            answeredBy: done.model ?? null,
            fallback: done.fallback ?? null,
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
