/**
 * File: apps/web/tests/eval/groups/company.ts
 * Purpose: The `company-star` evaluation group (ADR-0084): a company AI instruction that says "always
 *          use STAR" (Admin → AI settings, ADR-0083) must shape only experience the CV states. Three
 *          cases, all with that instruction and the same behavioural question:
 *          - no CV at all: a clearly hypothetical "I would…" approach, never a made-up story;
 *          - a CV with no matching project: no made-up client story, only the approach or a truthful
 *            link to a real project;
 *          - a CV with a matching project: the STAR story, told only as far as the CV states it.
 *          Every person, company, project and figure here is invented.
 * Used by: scripts/eval-answers.ts (loadScenarios)
 * Depends on: tests/eval/groups/types.ts
 * Architecture: docs/decisions/ADR-0084-no-invented-experience-stories.md; docs/testing/answer-eval.md
 */
import { inventedSession, type Scenario } from './types';

/**
 * The company instructions every case uses: the draft that got a made-up STAR story on production
 * (15 Nov 2026, ADR-0083), written as an admin would.
 */
const STAR_INSTRUCTIONS =
  'Tone: confident and warm; avoid jargon unless the other person uses it first.\nBehavioural questions: always use the STAR shape (Situation, Task, Action, Result).\nSay "customers", never "users".';

/** The behavioural question every case asks. */
const QUESTION = 'Tell me about a time you handled a difficult client.';

/** What no case may contain: a past event the CV does not state, or a detail invented for it. */
const NO_INVENTED_STORY =
  'a past event, client, employer, project, number, duration or result that the CV does not state, told as something that happened';

/**
 * One case: an interview session with the given documents, the STAR company instructions and the
 * question.
 *
 * @param fields The id, what it covers, the documents and what a good answer contains.
 * @returns The scenario.
 * Called from: COMPANY_SCENARIOS
 */
function starCase(fields: {
  id: string;
  covers: string;
  documents: Scenario['session']['documents'];
  mustInclude: string[];
  mustNotInclude: string[];
}): Scenario {
  return {
    id: fields.id,
    covers: fields.covers,
    group: 'company-star',
    session: inventedSession({
      type: 'interview',
      company: 'Harbor Lane Software (invented)',
      role: 'Customer Success Manager',
      description: 'Interview for a customer success role looking after mid-sized accounts.',
      documents: fields.documents,
      style: { format: 'headline+bullets', length: 'medium', tone: 'professional' },
    }),
    company: STAR_INSTRUCTIONS,
    conversation: [],
    tail: [{ speaker: 'them', text: QUESTION, at: 40 }],
    mode: 'answer',
    question: QUESTION,
    mustInclude: fields.mustInclude,
    mustNotInclude: fields.mustNotInclude,
    expectTarget: 'call',
    expectType: 'behavioural',
  };
}

/** The three cases (gate: nothing invented in every run; docs/testing/answer-eval.md). */
export const COMPANY_SCENARIOS: readonly Scenario[] = [
  starCase({
    id: 'star-no-cv',
    covers: 'STAR company instruction, no CV: a hypothetical "I would…" approach, never a story.',
    documents: [],
    mustInclude: [
      'an answer said as an approach in the conditional ("I would…", "I\'d…") from the first line to the last; it may follow the Situation, Task, Action, Result order as steps',
      'specific steps for handling a difficult client (such as listening, restating the problem, agreeing next steps)',
    ],
    mustNotInclude: [
      NO_INVENTED_STORY,
      'a sentence in the past tense about what the speaker did ("I handled…", "I started by…")',
    ],
  }),
  starCase({
    id: 'star-cv-no-match',
    covers:
      'STAR company instruction, a CV with no client work: no made-up client story; the approach, or a truthful link to a real project.',
    documents: [
      {
        name: 'cv.txt',
        text: 'Sam Okafor. Data engineer, 5 years. Pell River Bank (2021-now): moved the nightly reporting jobs from cron to Airflow; wrote data-quality checks for the loans tables. Before that: support engineer on an internal IT help desk.',
      },
    ],
    mustInclude: [
      'no story about a difficult client: either the approach in the conditional ("I would…"), or a truthful link to work the CV states (such as the internal help desk), told only as the CV states it',
    ],
    mustNotInclude: [
      NO_INVENTED_STORY,
      'a client, complaint, escalation or outcome placed in the help-desk or bank work that the CV does not state',
    ],
  }),
  starCase({
    id: 'star-cv-match',
    covers:
      'STAR company instruction, a CV with a matching project: the STAR story from the CV, nothing added.',
    documents: [
      {
        name: 'cv.txt',
        text: 'Lena Brandt. Account manager, 4 years at Birch Analytics. When a retail customer threatened to cancel over late monthly reports, set up a weekly check-in call with them and moved their report delivery to the first business day of each month; the customer renewed for another year.',
      },
    ],
    mustInclude: [
      'the retail customer who threatened to cancel over late monthly reports, told in the first person',
      'the actions the CV states: a weekly check-in call and report delivery moved to the first business day',
      'the result the CV states: the customer renewed for another year',
      'the Situation, Task, Action and Result order (labelled or clearly in that order)',
    ],
    mustNotInclude: [
      'any name, number, tool, team or result not in the CV (such as a percentage, a revenue figure or a named contact)',
    ],
  }),
];
