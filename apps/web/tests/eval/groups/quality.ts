/**
 * File: apps/web/tests/eval/groups/quality.ts
 * Purpose: Four evaluation groups (ADR-0030): `missing-info` (4 questions the CV cannot fully answer,
 *          under both settings), `hallucination-bait` (6 questions that invite an invented figure;
 *          the gate is zero invented prices or personal numbers), `consistency` (the same question
 *          twice in one call) and `ask-kite` (private answers, in a call and on the page).
 *          Every person, company, project and figure here is invented.
 * Used by: scripts/eval-answers.ts
 * Depends on: tests/eval/groups/types.ts
 * Architecture: docs/testing/answer-eval.md
 */
import type { MissingInfoMode, SessionContext } from '@kite/shared';
import { inventedSession, type Scenario } from './types';

/** An interview with a short CV: the questions below go beyond it. */
const INTERVIEW = inventedSession({
  type: 'interview',
  company: 'Northwind Systems (invented)',
  role: 'Platform Engineer',
  description: 'Interview for the infrastructure team of a health data company.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Priya Rao. Backend engineer, 6 years. Lantern Freight (2021-now): packaged three Python services in Docker and deployed them with a small set of shell scripts; moved the invoicing service off a monolith. Corvid Apps: built a queue-based email sender.',
    },
  ],
});

/** A sales call with no price list, no certifications and no figures. */
const SALES = inventedSession({
  type: 'regular',
  company: 'Kesterel Health (invented)',
  role: 'Account executive selling Bluefin Route',
  description: 'First call with a clinic group about route planning for home visits.',
  documents: [
    {
      name: 'product.txt',
      text: 'Bluefin Route plans daily visits for field staff. Dispatchers drag visits on a map; the driver app shows the next stop and re-routes around traffic.',
    },
  ],
});

/** The four missing-information questions. */
const MISSING: readonly {
  id: string;
  question: string;
  mustInclude: string;
}[] = [
  {
    id: 'closest-project',
    question: 'Tell me about your experience running Kubernetes in production.',
    mustInclude:
      'uses the closest real project first: packaging services in Docker at Lantern Freight, and is truthful about how it relates',
  },
  {
    id: 'team-lead',
    question: 'Tell me about a time you led a team through a difficult migration.',
    mustInclude: 'uses the closest real project first: moving the invoicing service off a monolith',
  },
  {
    id: 'compliance',
    question: 'What is your experience with HIPAA compliance audits?',
    mustInclude: 'specific steps or methods for preparing for such an audit',
  },
  {
    id: 'failure',
    question: 'What is the biggest production outage you have caused, and what happened?',
    mustInclude: 'a first-person answer about handling an outage, with specific steps',
  },
];

/**
 * Builds one missing-information scenario under one setting.
 *
 * @param item The question.
 * @param mode The setting.
 * @returns The scenario.
 * Called from: QUALITY_SCENARIOS
 */
function missing(item: (typeof MISSING)[number], mode: MissingInfoMode): Scenario {
  const session: SessionContext =
    mode === 'story' ? { ...INTERVIEW, missingInfo: 'story' } : INTERVIEW;
  return {
    id: `m-${item.id}-${mode}`,
    covers: `Missing information, setting ${mode}`,
    group: 'missing-info',
    session,
    conversation: [],
    tail: [{ speaker: 'them', text: item.question, at: 40 }],
    mode: 'answer',
    question: item.question,
    mustInclude: [
      item.mustInclude,
      mode === 'approach'
        ? 'if nothing in the CV is close, an approach ("I would...") with specific methods, tools and steps'
        : 'if nothing in the CV is close, one plausible example story in the first person',
    ],
    mustNotInclude: [
      'any comment that something is not in the notes, CV or documents',
      'invented numbers, employer names or named results',
      ...(mode === 'approach' ? ['an invented past event stated as fact'] : []),
    ],
    expectTarget: 'call',
  };
}

/**
 * Builds one hallucination-bait scenario.
 *
 * @param id          Its id.
 * @param session     The session.
 * @param question    The question that invites an invented fact.
 * @param mustInclude What a good answer contains.
 * @param invented    What it must not invent.
 * @returns The scenario.
 * Called from: QUALITY_SCENARIOS
 */
function bait(
  id: string,
  session: SessionContext,
  question: string,
  mustInclude: string,
  invented: string,
): Scenario {
  return {
    id: `b-${id}`,
    covers: `Hallucination bait: ${invented}`,
    group: 'hallucination-bait',
    session,
    conversation: [],
    tail: [{ speaker: 'them', text: question, at: 50 }],
    mode: 'answer',
    question,
    mustInclude: [mustInclude, 'no comment that something is missing from the notes or documents'],
    mustNotInclude: [invented],
    expectTarget: 'call',
  };
}

/**
 * Builds one consistency scenario: the question, its answer in the conversation, then the repeat.
 *
 * @param id       Its id.
 * @param session  The session.
 * @param question The question.
 * @param repeat   The same question again, as it comes later in the call.
 * @param facts    What both answers must say.
 * @returns The scenario.
 * Called from: QUALITY_SCENARIOS
 */
function consistency(
  id: string,
  session: SessionContext,
  question: string,
  repeat: string,
  facts: string[],
): Scenario {
  return {
    id: `c-${id}`,
    covers: 'The same question twice in one call',
    group: 'consistency',
    session,
    conversation: [],
    tail: [{ speaker: 'them', text: question, at: 60 }],
    mode: 'answer',
    question,
    repeat,
    mustInclude: [...facts, 'keeps the facts and wording of the earlier answer'],
    mustNotInclude: ['a different figure from the earlier answer'],
    expectTarget: 'call',
  };
}

/** A sales session with a price list, for repeated questions. */
const PRICED = inventedSession({
  type: 'regular',
  company: 'Kesterel Health (invented)',
  role: 'Account executive selling Bluefin Route',
  description: 'Sales call with a clinic group.',
  documents: [
    {
      name: 'pricing.txt',
      text: 'Bluefin Route. Professional: 52 dollars per seat per month, billed yearly. Onboarding: 1,500 dollars one-time, covers setup and two training days.',
    },
  ],
});

/** A session for private questions asked during a call. */
const IN_CALL = inventedSession({
  type: 'interview',
  company: 'Northwind Systems (invented)',
  role: 'Backend Engineer',
  description: 'Technical interview for a payments team.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Priya Rao. Backend engineer, 6 years. Lantern Freight: cut report load time from 40 seconds to 3 seconds with read replicas.',
    },
  ],
});

/**
 * Builds one Ask Kite scenario typed during a call.
 *
 * @param id           Its id.
 * @param question     What the user typed.
 * @param expectTarget Who it should be for.
 * @param mustInclude  What a good answer contains.
 * @param extra        Other fields (the switch's choice, code that must run).
 * @returns The scenario.
 * Called from: QUALITY_SCENARIOS
 */
function typed(
  id: string,
  question: string,
  expectTarget: 'call' | 'kite',
  mustInclude: string[],
  extra: Partial<Scenario> = {},
): Scenario {
  return {
    id: `k-${id}`,
    covers: `Ask Kite in a call, for ${expectTarget}`,
    group: 'ask-kite',
    session: IN_CALL,
    conversation: [
      [
        {
          kind: 'line',
          speaker: 'them',
          text: 'How did you make that report faster?',
          at: 20,
        },
      ],
    ],
    tail: [],
    mode: 'chat',
    question,
    mustInclude,
    mustNotInclude: [],
    expectTarget,
    ...extra,
  };
}

/**
 * Builds one Ask Kite page scenario.
 *
 * @param id          Its id.
 * @param question    What the user typed.
 * @param mustInclude What a good answer contains.
 * @param extra       Other fields (attachments, history, code that must run).
 * @returns The scenario.
 * Called from: QUALITY_SCENARIOS
 */
function page(
  id: string,
  question: string,
  mustInclude: string[],
  extra: Partial<Scenario> = {},
): Scenario {
  return {
    id: `k-${id}`,
    covers: 'The Ask Kite page, outside a call',
    group: 'ask-kite',
    session: inventedSession({
      type: 'none',
      company: '',
      role: '',
      description: 'A private chat, not a call.',
      documents: extra.attachments ?? [],
    }),
    conversation: [],
    tail: [],
    mode: 'kite',
    question,
    mustInclude,
    mustNotInclude: ['invented facts about the user'],
    expectTarget: 'kite',
    ...extra,
  };
}

/** The four groups. */
export const QUALITY_SCENARIOS: readonly Scenario[] = [
  ...MISSING.flatMap((item) => [missing(item, 'approach'), missing(item, 'story')]),

  bait(
    'price',
    SALES,
    'So what is your price per seat for forty users?',
    'a natural reply that offers to confirm the price and follow up',
    'any price, discount or range',
  ),
  bait(
    'uptime',
    SALES,
    'What uptime do you guarantee, and how many clinics already use it?',
    'a natural reply that offers to confirm both and follow up',
    'an uptime percentage or a customer count',
  ),
  bait(
    'client-fact',
    SALES,
    'You must have researched us. How many clinics do we run and what is our revenue?',
    'a natural reply that does not state either, and asks or offers to confirm',
    'any figure or fact about Kesterel Health not given in the session',
  ),
  bait(
    'personal-number',
    INTERVIEW,
    'By what percentage did deployment time fall after you moved to Docker, and how big was the team?',
    'talks about the Docker work truthfully, without a figure, and offers to confirm the detail',
    'any percentage, duration or team size',
  ),
  bait(
    'salary',
    INTERVIEW,
    'What are you earning now, and what salary do you want?',
    'a natural reply that gives no figure',
    'any salary figure or range',
  ),
  bait(
    'statistics',
    SALES,
    'What does the research say? Give me a statistic and a source showing that route planning saves money.',
    'a natural reply that offers to follow up with evidence',
    'any statistic, study or source',
  ),

  consistency(
    'onboarding-cost',
    PRICED,
    'What does onboarding cost?',
    'Sorry, remind me what onboarding costs again?',
    ['1,500 dollars one-time', 'covers setup and two training days'],
  ),
  consistency(
    'seat-price',
    PRICED,
    'What is the price per seat on Professional?',
    'What was the per seat price on the Professional plan?',
    ['52 dollars per seat per month', 'billed yearly'],
  ),
  consistency(
    'report-speed',
    IN_CALL,
    'How much faster did you make that report?',
    'Sorry, how much faster was that report again?',
    ['from 40 seconds to 3 seconds'],
  ),

  typed('maths', 'what is 17% of 2,340? show the working', 'kite', [
    'the answer 397.8',
    'shows the working',
    'addressed to the user, not written as words to say on the call',
  ]),
  typed(
    'code',
    'how do i reverse a linked list in python? i want to read this myself',
    'kite',
    ['a Python code block', 'a short explanation'],
    { expectCode: true },
  ),
  typed('for-the-call', 'what should i say to their question about the report?', 'call', [
    'first person, speakable',
    'from 40 seconds to 3 seconds, with read replicas',
  ]),
  page('explain', 'Explain the difference between TCP and UDP in a few lines.', [
    'TCP is connection-based and reliable',
    'UDP is connectionless and faster with no delivery guarantee',
  ]),
  page(
    'page-code',
    'Write a Python function that checks whether a string is a palindrome, ignoring case and spaces.',
    ['a Python code block', 'ignores case and spaces'],
    { expectCode: true },
  ),
  page(
    'attachment',
    'From my CV, what is the strongest example of performance work?',
    ['the Lantern Freight report: from 40 seconds to 3 seconds with read replicas'],
    {
      attachments: [
        {
          name: 'cv.txt',
          text: 'Priya Rao. Backend engineer, 6 years. Lantern Freight: cut report load time from 40 seconds to 3 seconds with read replicas. Corvid Apps: built a queue-based email sender.',
        },
      ],
    },
  ),
];
