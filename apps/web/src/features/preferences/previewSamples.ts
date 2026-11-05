/**
 * File: apps/web/src/features/preferences/previewSamples.ts
 * Purpose: The hand-written sample answers Answer preferences shows (spec S6): 8 question types, each in
 *          3 formats, with plain and professional wording. Length shows more or fewer points. No request
 *          is ever made for these, so changing a setting costs nothing and shows at once. Everything here
 *          is invented.
 * Used by: src/features/session-setup/AnswerPreferencesDialog.tsx
 * Depends on: src/core/storage/types.ts (AnswerStyle)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S6)
 */
import type { AnswerStyle } from '@/core/storage/types';

/** A question type the preview can show. */
export type SampleQuestionType =
  | 'behavioural'
  | 'coding'
  | 'experience'
  | 'how'
  | 'situational'
  | 'system-design'
  | 'technical'
  | 'about';

/** The question types, in the order the select lists them. */
export const SAMPLE_QUESTION_OPTIONS: readonly { value: SampleQuestionType; label: string }[] = [
  { value: 'behavioural', label: 'Behavioural' },
  { value: 'coding', label: 'Coding' },
  { value: 'experience', label: 'Experience check' },
  { value: 'how', label: 'How do you…' },
  { value: 'situational', label: 'Situational' },
  { value: 'system-design', label: 'System design' },
  { value: 'technical', label: 'Technical knowledge' },
  { value: 'about', label: 'Tell me about yourself' },
];

/** One sample answer in one wording. */
interface SampleWording {
  /** The line to say first ("Opening line + bullets"). */
  line: string;
  /** Short points, most important first (five, so Detailed can show them all). */
  bullets: readonly [string, string, string, string, string];
  /** Sentences to say word for word ("Read it out"), most important first. */
  script: readonly [string, string, string, string, string];
}

/** One question type's sample. */
interface Sample {
  /** The invented question. */
  question: string;
  /** Everyday words. */
  plain: SampleWording;
  /** Precise, formal wording (also shown for the technical tone). */
  professional: SampleWording;
}

/** The samples. */
const SAMPLES: Readonly<Record<SampleQuestionType, Sample>> = {
  behavioural: {
    question: 'Tell me about a time you disagreed with a teammate.',
    plain: {
      line: 'We disagreed on how to cache our reports, so we tested both ideas and let the numbers decide.',
      bullets: [
        'A teammate wanted a hosted cache; I wanted a small one of our own.',
        'I suggested a one-day test of both on real traffic.',
        'Ours used far less memory and was easier to look after.',
        'My teammate agreed once we saw the results, and we shipped it.',
        'Since then we test ideas early instead of arguing about them.',
      ],
      script: [
        'A teammate and I disagreed on how to cache our reports.',
        'Rather than argue, I suggested we try both ideas on real traffic for a day.',
        'The numbers showed our own small cache used far less memory.',
        'My teammate agreed straight away, and we shipped it that week.',
        'We have tested ideas early like that ever since.',
      ],
    },
    professional: {
      line: 'We disagreed on the caching approach, so I proposed a measured comparison and we followed the data.',
      bullets: [
        'A colleague favoured a managed cache; I favoured a lightweight in-house one.',
        'I proposed a one-day comparison under production traffic.',
        'The in-house option used significantly less memory and was simpler to maintain.',
        'We reached agreement on the evidence and delivered that option.',
        'The team now validates such decisions early through short trials.',
      ],
      script: [
        'A colleague and I differed on the right caching approach for our reports.',
        'I proposed a one-day comparison of both options under production traffic.',
        'The results showed the in-house option used significantly less memory.',
        'We reached agreement on that evidence and delivered it within the week.',
        'The team has validated similar decisions through short trials since then.',
      ],
    },
  },
  coding: {
    question: 'Find the first repeated number in a list.',
    plain: {
      line: 'Walk through the list once and keep a set of the numbers you have seen.',
      bullets: [
        'Go through the numbers from the start.',
        'If a number is already in the set, that is the answer.',
        'Otherwise add it to the set and carry on.',
        'It takes one pass, so the time grows with the length of the list.',
        'The set can grow as long as the list, which is the trade-off.',
      ],
      script: [
        'I would walk through the list once and keep a set of what I have seen.',
        'If the next number is already in the set, I return it.',
        'Otherwise I add it and move on.',
        'That takes one pass, so the time grows with the length of the list.',
        'The cost is the extra memory for the set.',
      ],
    },
    professional: {
      line: 'A single pass with a hash set gives a linear-time solution.',
      bullets: [
        'Iterate over the list from the first element.',
        'Return the element if the set already contains it.',
        'Otherwise insert it and continue.',
        'Time complexity is O(n), since each lookup is constant on average.',
        'Space complexity is O(n) in the worst case.',
      ],
      script: [
        'I would use a single pass with a hash set for a linear-time solution.',
        'For each element, I check whether the set already contains it.',
        'If it does, I return it; otherwise I insert it and continue.',
        'Time complexity is O(n), since each lookup is constant on average.',
        'The trade-off is O(n) space in the worst case.',
      ],
    },
  },
  experience: {
    question: 'Have you worked with SQL?',
    plain: {
      line: 'Yes, I use SQL most days, mainly for reports and for finding out why numbers look wrong.',
      bullets: [
        'I write reports with joins and window functions.',
        'I look at slow queries and work out why they are slow.',
        'I have added indexes that made reports much faster.',
        'I check my numbers against the source before sharing them.',
        'I am comfortable reading other people’s queries too.',
      ],
      script: [
        'Yes, I use SQL most days, mainly for reports.',
        'I write joins and window functions without much trouble.',
        'When a query is slow, I work out why and fix it.',
        'I always check my numbers against the source before sharing them.',
        'I am comfortable picking up other people’s queries as well.',
      ],
    },
    professional: {
      line: 'Yes, SQL is part of my daily work, primarily for reporting and data investigation.',
      bullets: [
        'I build reports using joins and window functions.',
        'I diagnose slow queries by reading their execution plans.',
        'I have introduced indexes that substantially reduced report times.',
        'I reconcile results against the source before publishing them.',
        'I regularly review and maintain queries written by colleagues.',
      ],
      script: [
        'Yes, SQL is part of my daily work, primarily for reporting.',
        'I regularly build reports using joins and window functions.',
        'I diagnose slow queries by reading their execution plans.',
        'I reconcile results against the source before publishing them.',
        'I also review and maintain queries written by colleagues.',
      ],
    },
  },
  how: {
    question: 'How do you handle a tight deadline?',
    plain: {
      line: 'I work out what really has to ship, tell people early, and protect the time to finish it.',
      bullets: [
        'I list what must be done and what can wait.',
        'I tell people early if something will not fit.',
        'I do the riskiest part first, so surprises show up sooner.',
        'I keep updates short and regular.',
        'Afterwards I look at what made it tight, so next time is easier.',
      ],
      script: [
        'First I work out what really has to ship and what can wait.',
        'I tell people early if something will not fit.',
        'Then I do the riskiest part first, so surprises show up sooner.',
        'I keep updates short and regular while it is busy.',
        'Afterwards I look at what made it tight, so next time is easier.',
      ],
    },
    professional: {
      line: 'I prioritise the essential scope, communicate early, and protect delivery time.',
      bullets: [
        'I separate required scope from what can be deferred.',
        'I raise risks with stakeholders as soon as they appear.',
        'I address the highest-risk work first to surface problems early.',
        'I provide brief, regular progress updates.',
        'I review the causes afterwards to improve future planning.',
      ],
      script: [
        'I begin by separating the required scope from what can be deferred.',
        'I raise any risk with stakeholders as soon as it appears.',
        'I address the highest-risk work first, so problems surface early.',
        'I provide brief, regular updates throughout.',
        'I review the causes afterwards to improve future planning.',
      ],
    },
  },
  situational: {
    question: 'What would you do if a customer asked for a feature you can’t build in time?',
    plain: {
      line: 'I would be honest about the date, find out what they really need, and offer what we can do now.',
      bullets: [
        'I would ask what problem the feature is meant to solve.',
        'I would be straight about what can and can’t be done by then.',
        'I would offer a smaller version or a workaround for now.',
        'I would agree a date for the rest and write it down.',
        'I would keep them updated, so nothing is a surprise.',
      ],
      script: [
        'I would start by asking what problem the feature is meant to solve.',
        'Then I would be straight about what can and can’t be done by that date.',
        'I would offer a smaller version or a workaround for now.',
        'We would agree a date for the rest and write it down.',
        'I would keep them updated, so nothing comes as a surprise.',
      ],
    },
    professional: {
      line: 'I would be transparent about the timeline, clarify the underlying need, and propose an interim option.',
      bullets: [
        'I would clarify the business problem behind the request.',
        'I would state plainly what is achievable within the timeframe.',
        'I would propose a reduced scope or an interim solution.',
        'I would confirm a date for the remainder in writing.',
        'I would maintain regular communication until delivery.',
      ],
      script: [
        'I would first clarify the business problem behind the request.',
        'I would then state plainly what is achievable within the timeframe.',
        'Where possible, I would propose a reduced scope or an interim solution.',
        'I would confirm a date for the remainder in writing.',
        'I would maintain regular communication until delivery.',
      ],
    },
  },
  'system-design': {
    question: 'How would you design a link shortener?',
    plain: {
      line: 'Keep one table of short codes and full links, and put a cache in front because reads far outnumber writes.',
      bullets: [
        'Store each short code with its full link.',
        'Make codes from a counter, so two links never clash.',
        'Cache popular links, since most visits are to a few of them.',
        'Count clicks in the background, so redirects stay fast.',
        'Add a limit per user, so nobody can flood it.',
      ],
      script: [
        'I would keep one table of short codes and their full links.',
        'Codes come from a counter, so two links never clash.',
        'Reads far outnumber writes, so I would cache the popular links.',
        'Clicks get counted in the background, so redirects stay fast.',
        'I would also limit each user, so nobody can flood it.',
      ],
    },
    professional: {
      line: 'A key-value mapping behind a read-through cache suits this read-heavy workload.',
      bullets: [
        'Persist each short code and target URL in a key-value store.',
        'Generate codes from a distributed counter to avoid collisions.',
        'Serve popular links through a read-through cache.',
        'Record analytics asynchronously to keep redirect latency low.',
        'Apply per-user rate limits to prevent abuse.',
      ],
      script: [
        'I would persist each short code and target URL in a key-value store.',
        'Codes would come from a distributed counter to avoid collisions.',
        'As the workload is read-heavy, I would add a read-through cache.',
        'Analytics would be recorded asynchronously to keep redirect latency low.',
        'I would also apply per-user rate limits to prevent abuse.',
      ],
    },
  },
  technical: {
    question: 'What is an index in a database?',
    plain: {
      line: 'An index is a sorted lookup that lets the database find rows without reading the whole table.',
      bullets: [
        'It works like the index at the back of a book.',
        'Finding rows gets much faster.',
        'Writes get a little slower, because the index must be kept up to date.',
        'It helps most on columns you filter or join on.',
        'Too many indexes waste space and slow writes down.',
      ],
      script: [
        'An index is a sorted lookup that finds rows without reading the whole table.',
        'It works like the index at the back of a book.',
        'Reads get much faster, while writes get a little slower.',
        'It helps most on columns you filter or join on.',
        'Too many of them waste space and slow writes down.',
      ],
    },
    professional: {
      line: 'An index is an auxiliary data structure that allows rows to be located without a full table scan.',
      bullets: [
        'Most databases implement indexes as B-trees.',
        'Lookups move from a full scan to a logarithmic search.',
        'Each write must also update the index, which adds overhead.',
        'They are most effective on selective filter and join columns.',
        'Excess indexes increase storage and write costs.',
      ],
      script: [
        'An index is an auxiliary structure that locates rows without a full table scan.',
        'Most databases implement them as B-trees, which makes lookups logarithmic.',
        'The trade-off is overhead on each write, as the index must also be updated.',
        'They are most effective on selective filter and join columns.',
        'Excess indexes increase both storage and write costs.',
      ],
    },
  },
  about: {
    question: 'Tell me about yourself.',
    plain: {
      line: 'I’m a data analyst who likes turning messy numbers into decisions people can act on.',
      bullets: [
        'I’ve spent the last few years working on reporting for a logistics team.',
        'I build the reports people use each week to plan their work.',
        'Lately I’ve been moving those reports from spreadsheets to a proper model.',
        'I enjoy working closely with the people who use the numbers.',
        'That’s why this role caught my eye.',
      ],
      script: [
        'I’m a data analyst who likes turning messy numbers into decisions.',
        'I’ve spent the last few years on reporting for a logistics team.',
        'I build the reports people use each week to plan their work.',
        'Lately I’ve been moving those reports from spreadsheets to a proper model.',
        'I enjoy working closely with the people who use the numbers, which is why this role caught my eye.',
      ],
    },
    professional: {
      line: 'I am a data analyst focused on turning complex data into actionable decisions.',
      bullets: [
        'I have spent recent years leading reporting for a logistics team.',
        'I own the weekly reports the team relies on for planning.',
        'I am currently migrating that reporting to a governed data model.',
        'I work closely with business stakeholders on what they need.',
        'This role is a natural next step for that experience.',
      ],
      script: [
        'I am a data analyst focused on turning complex data into actionable decisions.',
        'I have spent recent years leading reporting for a logistics team.',
        'I own the weekly reports the team relies on for planning.',
        'I am currently migrating that reporting to a governed data model.',
        'This role is a natural next step, given how closely I work with stakeholders.',
      ],
    },
  },
};

/** A behavioural answer with STAR structure on: one labelled point per part. */
const STAR_BULLETS: Readonly<Record<'plain' | 'professional', readonly string[]>> = {
  plain: [
    'Situation: A teammate and I disagreed on how to cache our reports.',
    'Task: We had to pick one before the release.',
    'Action: I suggested testing both on real traffic for a day.',
    'Result: Ours used far less memory, and we shipped it that week.',
  ],
  professional: [
    'Situation: A colleague and I differed on the caching approach for our reports.',
    'Task: We needed to decide before the release.',
    'Action: I proposed a one-day comparison under production traffic.',
    'Result: The in-house option used significantly less memory and was delivered that week.',
  ],
};

/** How many points or sentences each length shows. */
const LENGTH_COUNT: Readonly<Record<AnswerStyle['length'], number>> = {
  short: 2,
  medium: 3,
  detailed: 5,
};

/** What the preview draws. */
export interface RenderedSample {
  /** The invented question. */
  question: string;
  /** A sentence or sentences to say, or null for bullets only. */
  text: string | null;
  /** The points, empty for "Read it out". */
  bullets: readonly string[];
}

/**
 * The sample for a question type and a set of preferences.
 *
 * @param type  The question type.
 * @param style The format, length, tone and STAR setting.
 * @returns What to draw.
 * Called from: AnswerPreferencesDialog.tsx; tests
 */
export function renderSample(type: SampleQuestionType, style: AnswerStyle): RenderedSample {
  const sample = SAMPLES[type];
  // Two wordings (spec S6): the technical tone reads like the professional one.
  const key = style.tone === 'simple' ? 'plain' : 'professional';
  const wording = sample[key];
  const count = LENGTH_COUNT[style.length];
  if (style.format === 'paragraph') {
    return {
      question: sample.question,
      text: wording.script.slice(0, count).join(' '),
      bullets: [],
    };
  }
  const bullets =
    style.star && type === 'behavioural' ? STAR_BULLETS[key] : wording.bullets.slice(0, count);
  return {
    question: sample.question,
    text: style.format === 'headline+bullets' ? wording.line : null,
    bullets,
  };
}
