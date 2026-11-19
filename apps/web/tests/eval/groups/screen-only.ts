/**
 * File: apps/web/tests/eval/groups/screen-only.ts
 * Purpose: The `screen-only` evaluation group (ADR-0107): Ctrl+Shift+Enter answers the screen alone. Each
 *          scenario sends only the session and an invented screenshot, as the app does (no transcript, no
 *          question, private by default), and checks that the reply finds the question or task on the screen
 *          and answers it with substance: a coding problem solved with code that runs, a multiple-choice
 *          question with the right letter, a chat message answered, the key point of a page or dashboard,
 *          code with an error fixed, and an unreadable screen said to be one in one line. None may only
 *          describe the screen or ask whether the user wants the answer.
 * Used by: scripts/eval-answers.ts (`--only=screen-only`, and the full run)
 * Depends on: ./types (inventedSession, Scenario); tests/eval/images/screen-*.jpg (scripts/make-eval-images.ts)
 * Architecture: docs/testing/answer-eval.md (groups); docs/decisions/ADR-0107-screen-only-screenshot-answers.md
 *
 * Invented data only: no real company, person or customer.
 */
import { inventedSession, type Scenario } from './types';

/** An interview session with a short CV: the setup that showed "Other · From your CV" before ADR-0107. */
const INTERVIEW = inventedSession({
  type: 'interview',
  company: 'Northwind Labs (invented)',
  role: 'Backend engineer interview (the user is the candidate)',
  description: 'Technical interview with a live coding part.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Sam Patel (invented). Backend engineer, 4 years. At Brightpath Logistics (2022 to 2026) built the shipment-tracking API in Python (FastAPI) on Postgres and Redis, and added per-client request quotas.',
    },
  ],
  codingLanguage: 'Python',
});

/** What no screen-only answer may do. */
const NOT_A_DESCRIPTION =
  'only a description of what the screen shows, or a question asking whether the user wants the answer';

/**
 * A screen-only scenario with the group's fixed parts.
 *
 * @param fields The scenario's own fields.
 * @returns The scenario.
 */
function screenOnly(
  fields: Pick<
    Scenario,
    'id' | 'covers' | 'image' | 'imageDescription' | 'mustInclude' | 'mustNotInclude' | 'expectType'
  > &
    Partial<Pick<Scenario, 'expectCode'>>,
): Scenario {
  return {
    session: INTERVIEW,
    conversation: [],
    tail: [],
    mode: 'screenshot',
    group: 'screen-only',
    question: '',
    screenOnly: true,
    expectTarget: 'kite',
    ...fields,
  };
}

/** The scenarios. */
export const SCREEN_ONLY_SCENARIOS: Scenario[] = [
  screenOnly({
    id: 'so-coding-problem',
    covers:
      'A coding problem on screen is solved, with code that runs (the case that was only described).',
    image: 'images/screen-coding-slots.jpg',
    imageDescription:
      'A practice problem "Merge Overlapping Meeting Slots": merge every pair of [start, end] slots that overlap or touch and return them sorted by start; examples [[30,60],[0,15],[10,20],[55,90]] gives [[0,20],[30,90]] and [[1,4],[4,5]] gives [[1,5]]; an editor with an empty Python merge_slots(slots).',
    mustInclude: [
      'the approach: sort by start, then merge each slot into the last one when they overlap or touch',
      'a Python merge_slots function that merges touching slots too',
      'a complexity line, O(n log n)',
    ],
    mustNotInclude: [NOT_A_DESCRIPTION],
    expectType: 'coding',
    expectCode: true,
  }),
  screenOnly({
    id: 'so-multiple-choice',
    covers: 'A multiple-choice question on screen gets the right letter and why.',
    image: 'images/screen-multiple-choice.jpg',
    imageDescription:
      "A quiz question: what does this print: console.log('A'); setTimeout(() => console.log('B'), 0); Promise.resolve().then(() => console.log('C')); console.log('D'); options A) A B C D, B) A D C B, C) A D B C, D) A C D B.",
    mustInclude: [
      'the answer is option B, A D C B',
      'why: synchronous logs first, then the promise callback (a microtask), then the timer',
    ],
    mustNotInclude: [NOT_A_DESCRIPTION, 'any option other than B given as the answer'],
    expectType: 'task',
  }),
  screenOnly({
    id: 'so-chat-question',
    covers: 'A chat message that asks a question gets the reply to it.',
    image: 'images/screen-chat-question.jpg',
    imageDescription:
      "A chat app: Dana Ortiz asks: how would you stop one noisy customer from overloading our public API? Just a few lines on the approach you'd take.",
    mustInclude: [
      'per-client rate limiting (for example a token bucket or quota keyed on the API key or client)',
      'over-limit requests are rejected or slowed, for example with HTTP 429',
    ],
    mustNotInclude: [NOT_A_DESCRIPTION],
    expectType: 'task',
  }),
  screenOnly({
    id: 'so-before-after',
    covers: 'A page comparing two versions gets its key point, not "this screen shows a chat".',
    image: 'images/screen-before-after.jpg',
    imageDescription:
      'Sessions screen before 1.6.3 and after 1.6.4: the before header has Buy credits and New session buttons, the after header only New session; heading "No Buy credits button in the header"; text: credits moved to Settings → Billing in 1.6.4, everything else unchanged.',
    mustInclude: [
      '1.6.4 removes the Buy credits button from the Sessions header',
      'credits moved to Settings → Billing',
    ],
    mustNotInclude: [NOT_A_DESCRIPTION],
    expectType: ['document', 'webpage', 'slide', 'task'],
  }),
  screenOnly({
    id: 'so-dashboard',
    covers:
      'A dashboard with no question on it gets its takeaway, never "garbled" (which hid the card).',
    image: 'images/screen-dashboard.jpg',
    imageDescription:
      'An analytics dashboard, last 7 days vs the 7 days before: visits 48,210 (up 12%), page views 131,904 (up 8%), load time 4.8 s (up from 1.9 s), checkout conversions 1.1% (down from 2.6%); slowest pages /checkout 7.9 s, /pricing 3.1 s, / 1.4 s.',
    mustInclude: [
      'the takeaway: traffic is up but load time rose from 1.9 to 4.8 seconds and checkout conversions fell from 2.6% to 1.1%',
      'the checkout page is the slowest, at 7.9 seconds',
    ],
    mustNotInclude: [NOT_A_DESCRIPTION, 'a cause of the slowdown stated as a fact'],
    expectType: ['table', 'webpage'],
  }),
  screenOnly({
    id: 'so-code-error',
    covers: 'Code with an error on screen gets the cause and the fixed code.',
    image: 'images/code-error.jpg',
    imageDescription:
      'report.py: def average(values): return sum(values) / len(values); print(average([])); a traceback: ZeroDivisionError: division by zero.',
    mustInclude: [
      'the cause: average([]) divides by len([]) which is 0',
      'corrected Python code that handles an empty list',
    ],
    mustNotInclude: [NOT_A_DESCRIPTION],
    expectType: 'codefix',
    expectCode: true,
  }),
  screenOnly({
    id: 'so-unreadable',
    covers: 'A screen that cannot be read says so in one line, without guessing.',
    image: 'images/unreadable.jpg',
    imageDescription: 'A heavily blurred slide; no text can be read.',
    mustInclude: ['one line saying the screen cannot be read, and what would help'],
    mustNotInclude: ['any number or text guessed from the blurred screen'],
    expectType: 'unreadable',
  }),
];
