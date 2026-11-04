/**
 * File: apps/web/tests/eval/groups/detection.ts
 * Purpose: The evaluation groups of v1.1.0 (ADR-0043). `question-detection`: words that reach Claude
 *          after the rules in core/transcript/questionKind.ts have let them through: garbled lines and
 *          non-questions must not be answered as if they were questions, and real questions in messy
 *          transcripts must still be answered. `screenshot-types`: each kind of screen gets its own
 *          shape, and any code runs in the sandbox. Everything here is invented.
 * Used by: scripts/eval-answers.ts
 * Depends on: tests/eval/groups/types.ts
 * Architecture: docs/testing/answer-eval.md; ADR-0043
 */
import { inventedSession, type Scenario } from './types';

/** A practice interview for the detection scenarios. */
const PRACTICE = inventedSession({
  type: 'mock',
  company: 'Northwind Routes (invented)',
  role: 'Backend engineer (practice interview)',
  description: 'A mock interview for practice.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Priya Rao. Backend engineer at Harbor Lane Freight for four years. Rebuilt the billing export in Go. Runs the nightly route planning jobs on Kubernetes.',
    },
  ],
});

/** A client call for the detection scenarios. */
const CLIENT = inventedSession({
  type: 'regular',
  company: 'Harbor Lane Freight (invented)',
  role: 'Pilot review',
  description: 'A review of the route planning pilot.',
  documents: [
    {
      name: 'pricing.txt',
      text: 'Professional plan: 52 dollars per seat per month, billed yearly. Onboarding: 1,500 dollars once.',
    },
  ],
});

/**
 * A detection scenario.
 *
 * @param id          Its id.
 * @param covers      What it tests.
 * @param session     The session.
 * @param question    The words picked from the transcript.
 * @param expectType  The types that count as right.
 * @param mustInclude What a good reply must contain.
 * @returns The scenario.
 */
function detection(
  id: string,
  covers: string,
  session: Scenario['session'],
  question: string,
  expectType: NonNullable<Scenario['expectType']>,
  mustInclude: string[],
): Scenario {
  return {
    id,
    covers,
    group: 'question-detection',
    session,
    conversation: [],
    tail: [{ speaker: 'them', text: question, at: 60 }],
    mode: 'answer',
    question,
    mustInclude,
    mustNotInclude: ['an invented fact presented as an answer to a question nobody asked'],
    expectType,
  };
}

/**
 * A screenshot scenario.
 *
 * @param fields Its id, what it covers, image, words for the grader and what a good answer holds.
 * @returns The scenario.
 */
function screen(
  fields: Pick<
    Scenario,
    | 'id'
    | 'covers'
    | 'image'
    | 'imageDescription'
    | 'question'
    | 'mustInclude'
    | 'mustNotInclude'
    | 'expectType'
  > &
    Partial<Pick<Scenario, 'session' | 'tail' | 'expectCode'>>,
): Scenario {
  return {
    session: PRACTICE,
    conversation: [],
    tail: [],
    mode: 'screenshot',
    group: 'screenshot-types',
    ...fields,
  };
}

/** The scenarios. */
export const DETECTION_SCENARIOS: Scenario[] = [
  // Garbled: the rules let these through, because they have common words in them.
  detection(
    'qd-garbled-1',
    'Words with no meaning, though they have common words in them.',
    PRACTICE,
    'THE BLUE ROUTER SINGS UNDER A TUESDAY POTATO OF THE RIVER',
    ['garbled', 'unclear'],
    ['no answer, or only a short request to repeat it'],
  ),
  detection(
    'qd-garbled-2',
    'Noise from background speech, cut together.',
    CLIENT,
    'AND THE WHEN TO FOR IT WAS SEVEN LADDER HOW THE MAYBE OF',
    ['garbled', 'unclear'],
    ['no answer, or only a short request to repeat it'],
  ),
  detection(
    'qd-garbled-3',
    'A question word in noise is still noise.',
    PRACTICE,
    'WHAT THE GREEN OF SIDEWAYS IS PLANET MONDAY FORK',
    ['garbled', 'unclear'],
    ['no answer, or only a short request to repeat it'],
  ),
  // Non-questions the rules leave as statements: a short, friendly reply at most.
  detection(
    'qd-statement-1',
    'A remark, with nothing asked.',
    CLIENT,
    'OKAY THAT SOUNDS GOOD THANKS FOR THAT',
    ['smalltalk', 'unclear'],
    ['a short, friendly reply with no details and no promises'],
  ),
  detection(
    'qd-statement-2',
    'Thinking aloud, with nothing asked.',
    PRACTICE,
    'RIGHT LET ME JUST FIND MY NOTES HERE',
    ['smalltalk', 'unclear'],
    ['a short, friendly reply with no details and no promises'],
  ),
  detection(
    'qd-statement-3',
    'Small talk about the weather.',
    CLIENT,
    'IT HAS BEEN RAINING HERE ALL WEEK',
    ['smalltalk', 'unclear'],
    ['a short, friendly reply with no details and no promises'],
  ),
  // Real questions in messy transcripts must still be answered.
  detection(
    'qd-real-1',
    'A misheard price question.',
    CLIENT,
    'SO WHAT WOULD THE PRO FESSIONAL PLAN COST FOR FORTY SEATS',
    'sales',
    ['52 dollars per seat, or 2,080 dollars a month for forty seats'],
  ),
  detection(
    'qd-real-2',
    'A question with its lead-in and a repeat.',
    PRACTICE,
    'UM SO SO WHAT DID YOU DO ON THE BILLING THE BILLING EXPORT',
    ['behavioural', 'concept'],
    ['rebuilt the billing export in Go'],
  ),
  detection(
    'qd-real-3',
    'A request with no question word.',
    PRACTICE,
    'I WOULD LIKE TO HEAR ABOUT YOUR KUBERNETES WORK',
    ['behavioural', 'concept'],
    ['runs the nightly route planning jobs on Kubernetes'],
  ),
  detection(
    'qd-real-4',
    'A misheard technical word.',
    PRACTICE,
    'HOW WOULD YOU KEEP THE NIGHTLY JOBS FROM FAILING SILENTLY ON CUBE NET EASE',
    ['concept', 'design', 'behavioural'],
    ['a specific way to detect failed jobs, such as alerts or monitoring'],
  ),
  detection(
    'qd-real-5',
    'A short follow-up.',
    CLIENT,
    'AND IS ONBOARDING INCLUDED IN THAT',
    'sales',
    ['onboarding is 1,500 dollars once, so it is not included'],
  ),
  // Screens.
  screen({
    id: 'st-coding-problem',
    covers: 'A coding problem on screen gets the full coding shape, with code that runs.',
    image: 'images/coding-problem.jpg',
    imageDescription:
      'A practice problem: write count_vowels(text) that returns how many vowels (a, e, i, o, u, either case) a string has, with examples: "Harbor" gives 2, "sky" gives 0, "AEIOU" gives 5.',
    question: 'Can you solve this one?',
    mustInclude: [
      'an approach line',
      'key steps',
      'a Python function count_vowels that handles both cases',
      'a complexity line, O(n)',
      'one line on how to explain it',
    ],
    mustNotInclude: ['code that does not match the problem on screen'],
    expectType: 'coding',
    expectCode: true,
  }),
  screen({
    id: 'st-code-error',
    covers: 'Code with an error gets the cause, the fix and corrected code.',
    image: 'images/code-error.jpg',
    imageDescription:
      'report.py: average(values) returns sum(values) / len(values), and print(average([])) fails with ZeroDivisionError: division by zero.',
    question: 'Why does this fail?',
    mustInclude: [
      'the cause: an empty list makes len(values) zero, so it divides by zero',
      'the fix: handle the empty list before dividing',
      'corrected code in a code block',
    ],
    mustNotInclude: ['a different cause'],
    expectType: 'codefix',
    expectCode: true,
  }),
  screen({
    id: 'st-slide',
    covers: 'A slide gets its key points and how to respond.',
    session: CLIENT,
    image: 'images/slide-numbers.jpg',
    imageDescription:
      'A slide, Q3 renewal summary: 128 seats, 52 dollars per seat per month, 6,656 dollars a month, renewal on 1 December, late deliveries down 33% since the pilot.',
    question: "What's on screen and how should I respond?",
    mustInclude: ['the renewal figures as shown on the slide', 'how to respond'],
    mustNotInclude: ['a figure that is not on the slide'],
    expectType: ['slide', 'table'],
  }),
  screen({
    id: 'st-table-chart',
    covers: 'A chart gets its takeaway and its key numbers.',
    session: CLIENT,
    image: 'images/chart-bars.jpg',
    imageDescription:
      'A bar chart of support tickets per week: 420, 310, 180 and 95 over weeks 1 to 4.',
    question: 'What does this show?',
    mustInclude: ['the takeaway: tickets fell every week', 'the numbers 420 and 95'],
    mustNotInclude: ['a number that is not on the chart'],
    expectType: 'table',
  }),
  screen({
    id: 'st-document',
    covers: 'A document gets its key points, joined to what the other person just asked.',
    session: CLIENT,
    tail: [{ speaker: 'them', text: 'HOW MUCH NOTICE DO WE HAVE TO GIVE', at: 120 }],
    image: 'images/document-terms.jpg',
    imageDescription:
      "Service agreement section 4: either side may end the agreement with 60 days' written notice; fees paid in advance are refunded for any full months left after the notice ends; customer data is deleted within 30 days after the agreement ends.",
    question: 'HOW MUCH NOTICE DO WE HAVE TO GIVE',
    mustInclude: ['60 days written notice'],
    mustNotInclude: ['a notice period other than 60 days'],
    // What was asked is about the terms, so a client's question about them counts as well.
    expectType: ['document', 'sales'],
  }),
  screen({
    id: 'st-web-page',
    covers: 'A web page says what matters on it for this call.',
    session: CLIENT,
    image: 'images/web-page.jpg',
    imageDescription:
      'A web page, "Route planning service status", at status.example: partial outage, route planning delayed in the EU region since 09:40 UTC; live tracking and billing not affected; next update at 11:00 UTC.',
    question: "What's on screen and how should I respond?",
    mustInclude: ['route planning is delayed in the EU', 'tracking and billing are not affected'],
    mustNotInclude: ['a cause for the outage, which the page does not give'],
    expectType: 'webpage',
  }),
  screen({
    id: 'st-unreadable',
    covers: 'A screen that cannot be read says so, without guessing.',
    session: CLIENT,
    image: 'images/unreadable.jpg',
    imageDescription:
      'A slide so blurred that nothing on it can be read. A good reply is one short line saying so.',
    question: "What's on screen and how should I respond?",
    mustInclude: ['says the screen cannot be read'],
    mustNotInclude: ['any figure or fact guessed from the image'],
    expectType: 'unreadable',
  }),
];
