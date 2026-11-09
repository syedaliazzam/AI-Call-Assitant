/**
 * File: apps/web/scripts/measure-large-docs.ts
 * Purpose: Developer-only measurement for ADR-0067 (500k characters of documents per session),
 *          against the real Claude API, with an invented 480k-character test set (a CV and three
 *          long documents; no real company, person or customer):
 *          1. live answers (fast model): a first answer with no warm-up (it writes the cache), then
 *             two answers that read it; time to first text, total time, tokens and cost of each,
 *             and a check that answers 2 and 3 read the whole cached document block;
 *          2. the documents summary (fast model, POST /api/summary's code): time, tokens and cost;
 *          3. the call notes (smart model) as now sent (the CV and the summary), and the token count
 *             of the notes prompt as it was before (every document in full; counted, not run).
 *          Prints only counts, times and dollars; never the documents, the answers, the summary or
 *          the notes. Prices: platform.claude.com/docs/en/about-claude/pricing (2026-11-10).
 *          Usage: pnpm --filter web measure:large-docs
 * Used by: the "measure:large-docs" script in apps/web/package.json (run by a developer by hand;
 *          never in CI: it calls the real API, about 6 requests, about $0.35)
 * Depends on: src/server/prompt.ts (buildPrompt), src/server/claude.ts (streamReply,
 *             countInputTokens), src/server/summary.ts, src/server/notes.ts, src/server/env.ts
 * Key: refuses to run without ANTHROPIC_API_KEY (scripts/lib/require-key.ts). A paid run: agree
 *      it, with its estimated cost, with the developer first (CLAUDE.md "Claude key and spend").
 * Architecture: ADR-0067; docs/testing/benchmark-results.md (where the numbers are recorded)
 *
 * Each run adds a random reference number to the session, so it never reads an earlier run's cache.
 */
import type {
  AnswerRequest,
  AnswerUsage,
  ConversationChunk,
  NotesRequest,
  SessionContext,
  SessionDocument,
} from '@kite/shared';
import { countInputTokens, streamReply } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { generateCallNotes, notesPrompt } from '@/server/notes';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import { writeDocumentsSummary } from '@/server/summary';
import { requireKey } from './lib/require-key';

/** Dollars per million tokens: [input, 5-minute cache write, cache read, output]. */
type Rates = readonly [number, number, number, number];

/** claude-haiku-5-5 for prompts up to 100,000 tokens. */
const HAIKU: Rates = [0.1, 0.125, 0.01, 0.5];
/** claude-haiku-5-5 for prompts over 100,000 tokens (cache reads and writes count towards it). */
const HAIKU_LONG: Rates = [0.5, 0.625, 0.05, 2.5];
/** claude-sonnet-5-5 (one price across the 1M context). */
const SONNET: Rates = [2, 2.5, 0.1, 10];

/**
 * A request's cost in dollars.
 *
 * @param usage The request's token counts.
 * @param tier  'fast' (Haiku, priced by prompt length) or 'smart' (Sonnet).
 * @returns Dollars.
 * Called from: main()
 */
function cost(usage: AnswerUsage, tier: 'fast' | 'smart'): number {
  const prompt =
    usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const [input, write, read, output] =
    tier === 'smart' ? SONNET : prompt > 100_000 ? HAIKU_LONG : HAIKU;
  return (
    (usage.input_tokens * input +
      usage.cache_creation_input_tokens * write +
      usage.cache_read_input_tokens * read +
      usage.output_tokens * output) /
    1_000_000
  );
}

/** Invented sentences for the long documents; {n} becomes a number so sections differ. */
const SENTENCES = [
  'Section {n} of the Northwind Atlas handbook covers depot routing for region {n}.',
  'The Atlas Route planner re-plans every {n} minutes when live traffic changes.',
  'Customers on the Growth plan pay {n} dollars per seat per month, billed yearly.',
  'Support tickets in tier {n} are answered within four business hours.',
  'The pilot at depot {n} cut average planning time from forty to eighteen minutes.',
  'Single sign-on is included from the Business plan upward, with SCIM provisioning.',
  'Training runs in groups of six, with one practice day before each depot goes live.',
  'Data is kept in the EU region and deleted {n} days after a contract ends.',
  'Case study {n}: a regional grocer reduced late deliveries by a third in one quarter.',
  'The API allows {n} requests per minute per workspace before throttling begins.',
  'Discounts above ten percent need approval from the regional sales director.',
  'Implementation takes six to eight weeks, led by a named onboarding manager.',
];

/**
 * Builds one invented document of about the given length.
 *
 * @param title  The document's heading.
 * @param chars  Target length in characters.
 * @param offset Shifts the numbering, so documents differ.
 * @returns The text.
 * Called from: testSet()
 */
function inventedDocument(title: string, chars: number, offset: number): string {
  const parts = [title];
  let length = title.length;
  for (let i = 0; length < chars; i += 1) {
    const sentence = SENTENCES[i % SENTENCES.length]!.replaceAll('{n}', String(offset + i));
    parts.push(i % 6 === 0 ? `\n\n${sentence}` : sentence);
    length += sentence.length + 1;
  }
  return parts.join(' ').slice(0, chars);
}

/** An invented CV (no real person). */
const CV = [
  'Jordan Vale (invented test CV). Operations analyst.',
  'Experience: Route Planning Analyst at Coastline Parcel (2021 to 2025). Built a weekly report of late deliveries in SQL and Excel, used by six depot managers. Ran a two-month trial of a route planning tool at two depots.',
  'Experience: Logistics Coordinator at Fenwick Supplies (2018 to 2021). Scheduled outbound trucks and kept the carrier rate sheet up to date.',
  'Skills: SQL, Excel, Power BI, basic Python. Education: BSc Business Studies.',
]
  .join('\n')
  .repeat(4);

/**
 * The 480k-character test set: the CV and three long documents.
 *
 * @returns The documents, the CV first.
 * Called from: main()
 */
function testSet(): SessionDocument[] {
  const cv: SessionDocument = { name: 'jordan-vale-cv.txt', text: CV, kind: 'resume' };
  const rest = 480_000 - cv.text.length;
  return [
    cv,
    { name: 'atlas-handbook.txt', text: inventedDocument('Atlas handbook', 200_000, 0) },
    {
      name: 'pricing-and-terms.txt',
      text: inventedDocument('Pricing and terms', 150_000, 5_000),
    },
    {
      name: 'case-studies.txt',
      text: inventedDocument('Case studies', rest - 350_000, 9_000),
    },
  ];
}

/** The invented call: lines said before each answer, and the question. Times in seconds. */
const CALL: { lines: [speaker: 'you' | 'them', text: string, at: number][]; question: string }[] = [
  {
    lines: [
      ['them', 'Thanks for coming in. Tell me what you know about our route planner.', 6],
      ['them', 'How often does Atlas Route re-plan when traffic changes?', 14],
    ],
    question: 'How often does Atlas Route re-plan when traffic changes?',
  },
  {
    lines: [
      ['you', 'It re-plans on a fixed cycle when live traffic changes.', 30],
      ['them', 'Good. Have you run a trial of a planning tool yourself?', 41],
    ],
    question: 'Have you run a trial of a planning tool yourself?',
  },
  {
    lines: [
      ['you', 'Yes, at two depots for two months.', 58],
      ['them', 'Which plan includes single sign-on?', 66],
    ],
    question: 'Which plan includes single sign-on?',
  },
];

/** One answer's numbers. */
interface Measured {
  /** Token counts. */
  usage: AnswerUsage;
  /** Request start → first text, ms. */
  msFirstText: number;
  /** Request start → done, ms. */
  msTotal: number;
  /** Dollars. */
  dollars: number;
}

/**
 * Formats dollars with four decimals.
 *
 * @param dollars The amount.
 * @returns For example '$0.0123'.
 */
function usd(dollars: number): string {
  return `$${dollars.toFixed(4)}`;
}

/**
 * Prints token counts (never text).
 *
 * @param label What was measured.
 * @param usage Its token counts.
 * @param extra More numbers for the same line.
 */
function printUsage(label: string, usage: AnswerUsage, extra: string): void {
  console.log(
    `${label}: input ${usage.input_tokens}, cache write ${usage.cache_creation_input_tokens}, cache read ${usage.cache_read_input_tokens}, output ${usage.output_tokens}; ${extra}`,
  );
}

/**
 * Runs the measurement and prints the numbers.
 *
 * @returns Nothing; sets a non-zero exit code when the cache check fails.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  requireKey('measure-large-docs');
  const env = getClaudeEnv();
  const reference = crypto.randomUUID().slice(0, 8);
  const documents = testSet();
  const chars = documents.reduce((total, document) => total + document.text.length, 0);
  const session: SessionContext = {
    type: 'interview',
    company: 'Northwind Atlas (invented)',
    role: 'Operations Analyst',
    description: `Invented test session, reference ${reference}. The role plans depot routes with Atlas Route and reports on late deliveries.`,
    instructions: 'Keep answers short.',
    keyTerms: ['Atlas Route', 'Northwind'],
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    documents,
  };
  console.log(
    `measure-large-docs: ${documents.length} documents, ${chars} characters; fast ${env.modelFast}, smart ${env.modelSmart}`,
  );

  // 1. Live answers: no warm-up, so answer 1 writes the cache and answers 2 and 3 read it.
  const conversation: ConversationChunk[] = [];
  const answers: Measured[] = [];
  const said: NotesRequest['answers'] = [];
  const allLines: NotesRequest['lines'] = [];
  let previous: { question: string; text: string; at: number } | null = null;
  for (const [index, step] of CALL.entries()) {
    const stable = step.lines.slice(0, -1);
    const asked = step.lines.at(-1)!;
    conversation.push([
      ...(previous ? [{ kind: 'answer' as const, mode: 'answer' as const, ...previous }] : []),
      ...stable.map(([speaker, text, at]) => ({ kind: 'line' as const, speaker, text, at })),
    ]);
    const request: AnswerRequest = {
      mode: 'answer',
      session,
      conversation: conversation.map((chunk) => [...chunk]),
      tail: [{ speaker: asked[0], text: asked[1], at: asked[2] }],
      question: step.question,
    };
    const prompt = buildPrompt(request);
    const startedAt = performance.now();
    let firstTextAt: number | null = null;
    let text = '';
    const reply = streamReply({
      model: env.modelFast,
      tier: 'fast',
      ...prompt,
      maxTokens: ANSWER_MAX_TOKENS,
    });
    let next = await reply.next();
    while (!next.done) {
      firstTextAt ??= performance.now();
      text += next.value;
      next = await reply.next();
    }
    const usage = next.value.usage;
    const measured: Measured = {
      usage,
      msFirstText: Math.round((firstTextAt ?? performance.now()) - startedAt),
      msTotal: Math.round(performance.now() - startedAt),
      dollars: cost(usage, 'fast'),
    };
    answers.push(measured);
    printUsage(
      `answer ${index + 1}${index === 0 ? ' (no warm-up)' : ''}`,
      usage,
      `first text ${measured.msFirstText} ms, total ${measured.msTotal} ms, ${usd(measured.dollars)}`,
    );
    // Kept in memory for the next chunk and the notes; never printed.
    previous = { question: step.question, text, at: asked[2] + 1 };
    for (const [speaker, line, at] of step.lines) allLines.push({ speaker, text: line, at });
    said.push({
      at: asked[2] + 1,
      mode: 'answer',
      question: step.question,
      text,
      rating: null,
      note: '',
    });
  }
  const first = answers[0]!;
  const cached = answers.slice(1);
  const cacheOk = cached.every(
    (answer) => answer.usage.cache_read_input_tokens >= first.usage.cache_creation_input_tokens,
  );
  const perCached = cached.reduce((total, answer) => total + answer.dollars, 0) / cached.length;
  const readOnly = (first.usage.cache_creation_input_tokens * HAIKU_LONG[2]) / 1_000_000;
  console.log(
    `${cacheOk ? 'ok  ' : 'FAIL'} answers 2 and 3 read the whole cached prefix (${first.usage.cache_creation_input_tokens} tokens)`,
  );
  console.log(
    `estimate, 20-answer call: ${usd(first.dollars + 19 * perCached)} (1 write + 19 reads); each idle re-warm (4.5 min with no answer) adds about ${usd(readOnly)}`,
  );

  // 2. The documents summary (fast model).
  const others = documents.filter((document) => document.kind !== 'resume');
  const summaryStarted = performance.now();
  const written = await writeDocumentsSummary(
    { documents: others.map(({ name, text }) => ({ name, text })) },
    env.modelFast,
  );
  printUsage(
    'summary',
    written.usage,
    `${written.summary.length} characters, ${Math.round(performance.now() - summaryStarted)} ms, ${usd(cost(written.usage, 'fast'))}`,
  );

  // 3. The notes, as sent now (the CV and the summary), and the old prompt's size (counted only).
  const notesRequest: NotesRequest = {
    session: {
      ...session,
      documents: documents.filter((document) => document.kind === 'resume'),
      documentsSummary: written.summary,
    },
    lines: allLines,
    answers: said,
  };
  const notesStarted = performance.now();
  const notes = await generateCallNotes(notesRequest, env.modelSmart);
  const notesDollars = cost(notes.usage, 'smart');
  printUsage(
    'notes now',
    notes.usage,
    `${Math.round(performance.now() - notesStarted)} ms, ${usd(notesDollars)}`,
  );
  const before = notesPrompt({ ...notesRequest, session });
  const beforeTokens = await countInputTokens({
    model: env.modelSmart,
    tier: 'smart',
    system: before.system,
    messages: [{ role: 'user', content: before.prompt }],
  });
  // As the old notes request was billed: the cached blocks written once, the output as now.
  const beforeDollars =
    (beforeTokens * SONNET[1] + notes.usage.output_tokens * SONNET[3]) / 1_000_000;
  console.log(
    `notes before (every document in full; counted, not run): about ${beforeTokens} input tokens, about ${usd(beforeDollars)}`,
  );
  console.log(cacheOk ? 'PASS' : 'FAIL');
  if (!cacheOk) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // The error's name and status only: an API error message could quote the request.
  const status = (error as { status?: number }).status;
  console.error(
    `measure-large-docs: failed (${error instanceof Error ? error.name : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
  );
  process.exitCode = 1;
});
