/**
 * File: apps/web/tests/eval/groups/adaptive.ts
 * Purpose: The `adaptive` evaluation group (ADR-0030): 6 roles × 4 question types, 24 scenarios.
 *          Each checks that Kite works out the role and question type in the same request and
 *          answers in the matching shape; coding answers must also run in the sandbox.
 *          Every person, company, project and figure here is invented.
 * Used by: scripts/eval-answers.ts
 * Depends on: tests/eval/groups/types.ts
 * Architecture: docs/testing/answer-eval.md
 */
import type { AnswerType, SessionContext } from '@kite/shared';
import { inventedSession, type Scenario } from './types';

/** Backend engineer, interview. */
const BACKEND = inventedSession({
  type: 'interview',
  company: 'Northwind Systems (invented)',
  role: 'Senior Backend Engineer',
  description: 'Technical interview for a payments platform team. Python and PostgreSQL.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Priya Rao. Backend engineer, 6 years. Lantern Freight (2021-now): moved the invoicing service from a monolith to three Python services; cut report load time from 40 seconds to 3 seconds by adding read replicas and rewriting two queries; led the on-call rota for four engineers. Earlier: Corvid Apps, built a queue-based email sender handling 2 million messages a day.',
    },
  ],
});

/** Data analyst, interview. */
const ANALYST = inventedSession({
  type: 'interview',
  company: 'Marlow Retail (invented)',
  role: 'Data Analyst',
  description: 'Interview for the pricing analytics team of a grocery chain.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Tom Adeyemi. Data analyst, 4 years. Fenwick Foods: built the weekly margin dashboard used by 30 store managers; an A/B test of shelf labels raised basket size by 4 percent. Tools: SQL, Python, Tableau.',
    },
  ],
});

/** Product manager, interview. */
const PRODUCT = inventedSession({
  type: 'interview',
  company: 'Tidewater Travel (invented)',
  role: 'Senior Product Manager',
  description: 'Product interview for the mobile booking app.',
  documents: [
    {
      name: 'cv.txt',
      text: 'Lena Fischer. Product manager, 7 years. Skylark Tickets: owned checkout; removing two form steps raised mobile conversion from 2.1 to 2.9 percent; ran a monthly customer panel. Earlier: support lead at the same company.',
    },
  ],
});

/** Account executive, sales call. */
const SALES = inventedSession({
  type: 'regular',
  company: 'Kesterel Health (invented)',
  role: 'Account executive selling Bluefin Route',
  description: 'Sales call with a clinic group about route planning for home visits.',
  documents: [
    {
      name: 'pricing.txt',
      text: 'Bluefin Route. Starter: 28 dollars per seat per month. Professional: 52 dollars per seat per month, billed yearly, includes live re-routing and single sign-on. Onboarding: 1,500 dollars one-time, covers setup and two training days. Discounts up to 10 percent need a two-year term.',
    },
    {
      name: 'product.txt',
      text: 'Bluefin Route plans daily visits for field staff. Dispatchers drag visits on a map; the driver app shows the next stop and re-routes around traffic. Reports show on-time visits per week.',
    },
  ],
});

/** Customer success manager, client call. */
const SUCCESS = inventedSession({
  type: 'regular',
  company: 'Harbor Lane Logistics (invented)',
  role: 'Customer success manager for Bluefin Route',
  description: 'Quarterly review with a customer whose dispatchers report sync errors.',
  documents: [
    {
      name: 'runbook.txt',
      text: 'Sync error E42: the driver app lost its session. Fix: sign out, sign in, then pull to refresh. If it returns within a day, collect the device id and open a priority ticket; the support target for priority tickets is 4 working hours. Single sign-on sessions expire after 12 hours.',
    },
  ],
});

/** Frontend engineer, interview, with JavaScript as the coding language. */
const FRONTEND = inventedSession({
  type: 'interview',
  company: 'Quillon Labs (invented)',
  role: 'Frontend Engineer',
  description: 'Interview for a design tools team. React and TypeScript.',
  codingLanguage: 'JavaScript',
  documents: [
    {
      name: 'cv.txt',
      text: 'Sam Okafor. Frontend engineer, 5 years. Pixelarc: rebuilt the canvas editor in React; virtualising the layer list cut render time from 900 to 120 milliseconds. Mentored two junior developers.',
    },
  ],
});

/**
 * Builds one scenario of the group.
 *
 * @param id           Its id, after the group's prefix.
 * @param session      The role's session.
 * @param expectType   The expected question type (any of them, when several are fair).
 * @param question     What the other person asked.
 * @param mustInclude  What a good answer contains.
 * @param mustNotInclude What it must not contain.
 * @param expectCode   True when it must have code that runs.
 * @returns The scenario.
 * Called from: ADAPTIVE_SCENARIOS
 */
function scenario(
  id: string,
  session: SessionContext,
  expectType: AnswerType | AnswerType[],
  question: string,
  mustInclude: string[],
  mustNotInclude: string[] = ['invented employers, numbers or results'],
  expectCode = false,
): Scenario {
  return {
    id: `a-${id}`,
    covers: `${session.role}: ${Array.isArray(expectType) ? expectType.join(' or ') : expectType}`,
    group: 'adaptive',
    session,
    conversation: [],
    tail: [{ speaker: 'them', text: question, at: 30 }],
    mode: 'answer',
    question,
    mustInclude,
    mustNotInclude,
    expectType,
    expectTarget: 'call',
    expectCode,
  };
}

/** The `adaptive` group. */
export const ADAPTIVE_SCENARIOS: readonly Scenario[] = [
  scenario(
    'backend-behavioural',
    BACKEND,
    'behavioural',
    'Tell me about a time you made a system much faster.',
    [
      'the Lantern Freight report: load time from 40 seconds to 3 seconds',
      'how: read replicas and rewriting two queries',
      'told in order: the situation, what I did, the result',
    ],
  ),
  scenario(
    'backend-concept',
    BACKEND,
    'concept',
    'What is a database index and when would you not use one?',
    [
      'says what an index is in plain words',
      'how it works or speeds up reads',
      'when not to use one: for example slower writes or small tables',
    ],
    ['a claim that indexes have no cost'],
  ),
  scenario(
    'backend-coding',
    BACKEND,
    'coding',
    'Write a function that returns the first non-repeating character in a string.',
    [
      'states an approach, such as counting characters with a dictionary',
      'gives the complexity: linear time',
      'names at least one edge case, such as an empty string',
      'a Python code block',
      'a line on how to say it',
    ],
    ['invented employers, numbers or results'],
    true,
  ),
  scenario(
    'backend-design',
    BACKEND,
    'design',
    'How would you design a service that sends payment receipts by email?',
    [
      'requirements to confirm',
      'main components, such as an API, a queue and workers',
      'how data flows',
      'how it scales, and a trade-off',
    ],
    ['invented traffic figures stated as facts about the company'],
  ),
  scenario(
    'analyst-behavioural',
    ANALYST,
    'behavioural',
    'Give me an example of an analysis that changed a business decision.',
    [
      'the shelf label A/B test at Fenwick Foods',
      'basket size raised by 4 percent',
      'told in order',
    ],
  ),
  scenario(
    'analyst-coding',
    ANALYST,
    'coding',
    'Can you write some Python that takes a list of daily sales and returns the seven-day moving average?',
    [
      'states an approach, such as a sliding window',
      'gives the complexity',
      'names an edge case, such as fewer than seven days',
      'a Python code block',
      'a line on how to say it',
    ],
    ['invented employers, numbers or results'],
    true,
  ),
  scenario(
    'analyst-case',
    ANALYST,
    'case',
    'Roughly how many loaves of bread does a mid-size supermarket sell in a day? Walk me through it.',
    ['states assumptions, said as assumptions', 'a step by step calculation', 'a final estimate'],
    ['assumptions presented as known facts about Marlow Retail'],
  ),
  scenario(
    'analyst-wrapup',
    ANALYST,
    'smalltalk',
    'Great, that is all from me. Thanks for your time today.',
    ['a short, friendly closing line the user can say'],
    ['an invented next step or date'],
  ),
  scenario(
    'pm-product',
    PRODUCT,
    'product',
    'How would you show a new customer what your checkout change does?',
    [
      'what it does: fewer form steps',
      'how to show it',
      'why it matters: the rise from 2.1 to 2.9 percent',
    ],
    ['invented numbers'],
  ),
  scenario(
    'pm-case',
    PRODUCT,
    'case',
    'Estimate how many people book a hotel on their phone each day in a city of one million.',
    ['states assumptions, said as assumptions', 'a step by step calculation', 'a final estimate'],
    ['assumptions presented as known facts'],
  ),
  scenario(
    'pm-behavioural',
    PRODUCT,
    'behavioural',
    'Tell me about a time customer feedback changed your plan.',
    [
      'uses the closest real experience: the monthly customer panel or the checkout work',
      'first person, told in order',
    ],
  ),
  scenario(
    'pm-unclear',
    PRODUCT,
    'unclear',
    'So what about the other thing, how did that go?',
    ['a short reply the user can say', 'a question to find out what they mean'],
    ['an invented story presented as what they meant'],
  ),
  scenario(
    'sales-pricing',
    SALES,
    'sales',
    'What would the Professional plan cost us for twenty dispatchers?',
    ['52 dollars per seat per month', '1,040 dollars a month for twenty seats', 'billed yearly'],
    ['a discount nobody asked about', 'a different price'],
  ),
  scenario(
    'sales-demo',
    SALES,
    'product',
    'Can you show me how a dispatcher would actually use it day to day?',
    [
      'dispatchers drag visits on a map',
      'the driver app shows the next stop and re-routes around traffic',
      'why it matters to a clinic group doing home visits',
    ],
    ['features not in the documents'],
  ),
  scenario(
    'sales-smalltalk',
    SALES,
    'smalltalk',
    'Before we start, did you have a good week?',
    ['a short, friendly reply the user can say'],
    ['invented personal details stated as facts'],
  ),
  scenario(
    'sales-unclear',
    SALES,
    ['unclear', 'sales'],
    'And is that one the same as the other one?',
    ['a short reply the user can say', 'asks which plans or things they mean'],
    ['an invented comparison'],
  ),
  scenario(
    'success-client',
    SUCCESS,
    ['sales', 'product'],
    'Our dispatchers keep seeing error E42. What should they do?',
    [
      'sign out, sign in, then pull to refresh',
      'if it returns, collect the device id and open a priority ticket',
    ],
    ['a fix not in the runbook'],
  ),
  scenario(
    'success-sla',
    SUCCESS,
    ['sales', 'product'],
    'How quickly do you respond if we open a priority ticket?',
    ['the target is 4 working hours'],
    ['any other response time', 'a guarantee beyond the target'],
  ),
  scenario(
    'success-concept',
    SUCCESS,
    'concept',
    'What does single sign-on actually mean for our drivers?',
    [
      'says what single sign-on is in plain words',
      'sessions expire after 12 hours, so drivers sign in again',
    ],
    ['invented settings or figures'],
  ),
  scenario(
    'success-wrapup',
    SUCCESS,
    'smalltalk',
    'Okay I think that covers everything, have a good one.',
    ['a short, friendly closing line the user can say'],
    ['an invented commitment'],
  ),
  scenario(
    'frontend-coding',
    FRONTEND,
    'coding',
    'Write a debounce function, please.',
    [
      'states an approach: a timer reset on each call',
      'gives the complexity or says it is constant per call',
      'names an edge case, such as the this value or cancelling',
      'a JavaScript code block',
      'a line on how to say it',
    ],
    ['Python code'],
    true,
  ),
  scenario(
    'frontend-concept',
    FRONTEND,
    'concept',
    'What is list virtualisation and when does it help?',
    [
      'says what it is: rendering only what is visible',
      'when it helps: long lists',
      'a trade-off, or the real example from Pixelarc',
    ],
    ['invented numbers'],
  ),
  scenario(
    'frontend-behavioural',
    FRONTEND,
    'behavioural',
    'Tell me about helping a less experienced colleague.',
    ['mentored two junior developers', 'first person, without invented details stated as facts'],
    ['invented names, numbers or results'],
  ),
  scenario(
    'frontend-design',
    FRONTEND,
    'design',
    'How would you design real-time collaboration for a canvas editor?',
    [
      'requirements to confirm',
      'main components, such as a sync server and client state',
      'how edits flow',
      'how it scales, and a trade-off',
    ],
    ['invented figures stated as facts about the company'],
  ),
];
