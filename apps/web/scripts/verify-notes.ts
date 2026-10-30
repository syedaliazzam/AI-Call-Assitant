/**
 * File: apps/web/scripts/verify-notes.ts
 * Purpose: Developer-only check of the call notes against the real Claude API (smart model),
 *          on a generated, invented 60-minute call: about 450 lines on several topics, three
 *          questions from the other side, two agreed next steps with owners, a 3-minute stretch
 *          of garbled transcript (minutes 25–28), and three Kite answers, one rated thumbs down
 *          with a note. Runs the real server code (server/notes.ts). Prints only numbers: token
 *          counts, time, and how many items of each kind came back.
 *          Pass = the notes come back in the expected structure within the limits, the garbled
 *          stretch is listed as unclear (its time range overlaps minutes 25–28), the agreed next
 *          steps are there, and at least one lesson is proposed from the thumbs down.
 *          Usage: pnpm --filter web verify:notes
 * Used by: the "verify:notes" script in apps/web/package.json (by hand; never in CI)
 * Depends on: src/server/notes.ts, src/server/env.ts, @kite/shared
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes);
 *               day-05-overlay-screenshots-notes.md Stage 5
 *
 * Runs like verify-warm.ts (tsx, `--env-file=.env.local`, `--conditions=react-server`). Never
 * prints the call, the answers or the notes.
 */
import {
  MAX_PROPOSED_LESSONS,
  MAX_SUMMARY_BULLETS,
  type CallLine,
  type NotesRequest,
} from '@kite/shared';
import { getClaudeEnv } from '@/server/env';
import { generateCallNotes } from '@/server/notes';

/** Invented sentences for the clear parts of the call, by topic. */
const TOPICS: { them: string[]; you: string[] }[] = [
  {
    them: [
      'THE PILOT AT THE FOUR DEPOTS WENT WELL OVERALL',
      'OUR DISPATCHERS LIKED THE MORNING ROUTE PLANS',
      'PLANNING TIME DROPPED A LOT FOR THE NIGHT SHIFT',
    ],
    you: [
      'THAT MATCHES WHAT WE SAW IN THE PILOT REPORT',
      'THE AVERAGE WENT FROM FORTY TO EIGHTEEN MINUTES',
      'GOOD TO HEAR THE NIGHT SHIFT FELT IT TOO',
    ],
  },
  {
    them: [
      'LATE DELIVERIES WERE DOWN BY ABOUT A THIRD',
      'THE LIVE RE ROUTING HELPED ON THE MOTORWAY DAYS',
      'A FEW DRIVERS IGNORED THE NEW ROUTES AT FIRST',
    ],
    you: [
      'WE CAN ADD A SHORT DRIVER BRIEFING FOR THAT',
      'THE RE ROUTING IS WHERE MOST OF THE GAIN CAME FROM',
      'THAT IS COMMON IN THE FIRST TWO WEEKS',
    ],
  },
  {
    them: [
      'FINANCE WANTS YEARLY BILLING IF POSSIBLE',
      'WE ARE LOOKING AT AROUND FORTY SEATS',
      'SINGLE SIGN ON IS A MUST FOR OUR IT TEAM',
    ],
    you: [
      'YEARLY BILLING IS OUR STANDARD',
      'FORTY SEATS ON PROFESSIONAL IS STRAIGHTFORWARD',
      'SINGLE SIGN ON IS INCLUDED IN PROFESSIONAL',
    ],
  },
];

/** Garbled lines for minutes 25–28 (what a bad connection gives the recogniser). */
const GARBLED = [
  'THE BLUE OF FARM WHEN SEVEN PUT IT NEAR GOVERN THE',
  'AND SO MARKET LOW THE IF GLASS RIVER NINETY',
  'WAS THEY THE HE IN TO OVER BREAD STATION ME',
  'COLD THE PAPER OF IN WHICH FOREST AND THE THE',
];

/**
 * Builds the invented 60-minute call.
 *
 * @returns The lines, oldest first.
 * Called from: main()
 */
function inventedCall(): CallLine[] {
  const lines: CallLine[] = [];
  let at = 5;
  let n = 0;
  while (at < 3_600) {
    const garbled = at >= 1_500 && at < 1_680;
    const topic = TOPICS[Math.floor(at / 1_200) % TOPICS.length]!;
    const speaker = n % 2 === 0 ? 'them' : 'you';
    const text = garbled
      ? GARBLED[n % GARBLED.length]!
      : speaker === 'them'
        ? topic.them[n % topic.them.length]!
        : topic.you[n % topic.you.length]!;
    lines.push({ speaker, text, at });
    at += 7 + (n % 3);
    n += 1;
  }
  // The planted questions and agreed next steps.
  const planted: CallLine[] = [
    { speaker: 'them', text: 'WHAT WOULD FORTY SEATS ON PROFESSIONAL COST PER MONTH', at: 2_405 },
    { speaker: 'them', text: 'HOW LONG DOES THE ROLLOUT TAKE FOR ALL DEPOTS', at: 2_811 },
    { speaker: 'them', text: 'CAN YOU HOLD THE PRICE FOR TWO YEARS', at: 3_005 },
    { speaker: 'you', text: 'I WILL SEND THE CONTRACT DRAFT BY FRIDAY', at: 3_402 },
    {
      speaker: 'them',
      text: 'GREAT AND PRIYA FROM OUR IT TEAM WILL SET UP SINGLE SIGN ON',
      at: 3_410,
    },
  ];
  return [...lines, ...planted].sort((a, b) => a.at - b.at);
}

/**
 * Runs the check and prints numbers only.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const lines = inventedCall();
  const request: NotesRequest = {
    session: {
      type: 'sales',
      company: 'Harbor Lane Freight (invented)',
      role: 'Renewal call with the operations team',
      description: 'Invented 60-minute test call.',
      instructions: '',
      keyTerms: ['Harbor Lane', 'Professional plan'],
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      documents: [
        {
          name: 'price-list.txt',
          text: 'Professional plan: 52 dollars per seat per month, billed yearly, single sign-on included. Rollout: six weeks.',
        },
      ],
    },
    lines,
    answers: [
      {
        at: 2_408,
        mode: 'answer',
        question: 'What would forty seats on Professional cost per month?',
        text: 'Forty seats cost 2,080 dollars a month.\n- 52 dollars per seat',
        rating: 'up',
        note: '',
      },
      {
        at: 2_814,
        mode: 'answer',
        question: 'How long does the rollout take for all depots?',
        text: 'About six weeks.\n- Three phases',
        rating: null,
        note: '',
      },
      {
        at: 3_008,
        mode: 'answer',
        question: 'Can you hold the price for two years?',
        text: 'Yes, we can hold it.',
        rating: 'down',
        note: 'Wrong: the price list says nothing about holding prices; it should say I need to check with sales.',
      },
    ],
  };
  const chars = lines.reduce((sum, line) => sum + line.text.length, 0);
  const model = getClaudeEnv().modelSmart;
  console.log(
    `verify-notes: model ${model}; invented call ${Math.round(lines.at(-1)!.at / 60)} minutes, ${lines.length} lines, ${chars} characters, ${request.answers.length} answers`,
  );
  const startedAt = performance.now();
  const { notes, usage } = await generateCallNotes(request, model);
  const ms = Math.round(performance.now() - startedAt);
  console.log(
    `notes: ${ms} ms; input ${usage.input_tokens}, output ${usage.output_tokens}, cache write ${usage.cache_creation_input_tokens}, read ${usage.cache_read_input_tokens}`,
  );
  console.log(
    `counts: summary ${notes.summary.length}, questions ${notes.questions.length}, next steps ${notes.nextSteps.length}, unclear ${notes.unclear.length}, lessons ${notes.lessons.length}`,
  );
  console.log(
    `unclear ranges (s): ${JSON.stringify(notes.unclear.map((part) => [part.from, part.to]))}; question ratings: ${JSON.stringify(notes.questions.map((q) => q.rating))}`,
  );
  const garbledListed = notes.unclear.some((part) => part.from < 1_680 && part.to > 1_500);
  const checks: [string, boolean][] = [
    [
      `summary 1–${MAX_SUMMARY_BULLETS} bullets`,
      notes.summary.length >= 1 && notes.summary.length <= MAX_SUMMARY_BULLETS,
    ],
    ['the garbled minutes 25–28 are listed as unclear', garbledListed],
    ['at least the three planted questions', notes.questions.length >= 3],
    [
      'the two agreed next steps, with owners',
      notes.nextSteps.length >= 2 && notes.nextSteps.filter((s) => s.owner.trim()).length >= 2,
    ],
    [
      `1–${MAX_PROPOSED_LESSONS} lessons proposed (from the thumbs down)`,
      notes.lessons.length >= 1 && notes.lessons.length <= MAX_PROPOSED_LESSONS,
    ],
    [
      'a question carries the thumbs down from the request',
      notes.questions.some((q) => q.rating === 'down'),
    ],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  const pass = checks.every(([, ok]) => ok);
  console.log(pass ? 'PASS' : 'FAIL');
  if (!pass) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const status = (error as { status?: number }).status;
  console.error(
    `verify-notes: failed (${error instanceof Error ? error.name : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
  );
  process.exitCode = 1;
});
