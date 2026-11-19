/**
 * Tests for apps/web/src/server/prompts/experience.ts and its use in src/server/prompt.ts (ADR-0108): the
 * own-experience check, the CV match score against the threshold, the CV match line (only for an
 * own-experience question with no matching CV clause, in a session with the experience rules; on by default,
 * last in the uncached tail, off only when the evaluation asks), and the measured smart-model choice (off in
 * the app). Every CV and question is invented.
 */
import type { AnswerRequest, SessionContext } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/server/prompt';
import {
  CV_MATCH_THRESHOLD,
  cvMatchScore,
  isOwnExperienceQuestion,
  NO_CV_MATCH_LINE,
  noCvMatchLines,
  usesExperienceModel,
} from '@/server/prompts/experience';

/** An invented CV. */
const CV =
  'Ada Lin. Backend engineer, 5 years. Pine Ridge Freight: packaged four Go services in Docker; moved the billing service off a monolith. Earlier: built a queue-based SMS sender.';

/** An invented interview session with that CV. */
const SESSION: SessionContext = {
  type: 'interview',
  company: 'Invented Co',
  role: 'Backend engineer',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'cv.txt', text: CV }],
};

/**
 * An answer request for a question from the other person.
 *
 * @param question The question.
 * @param session  The session (SESSION by default).
 * @returns The request.
 */
function ask(question: string, session: SessionContext = SESSION): AnswerRequest {
  return {
    mode: 'answer',
    session,
    conversation: [],
    tail: [{ speaker: 'them', text: question, at: 10 }],
    question,
  };
}

/**
 * The prompt's text, every block joined.
 *
 * @param request The request.
 * @param options buildPrompt()'s options.
 * @returns The text.
 */
function promptText(request: AnswerRequest, options = {}): string {
  const built = buildPrompt(request, undefined, options);
  const user = built.messages[0]!.content as { type: string; text?: string }[];
  return [
    ...built.system.map((block) => block.text),
    ...user.map((block) => block.text ?? ''),
  ].join('\n');
}

describe('isOwnExperienceQuestion', () => {
  it('finds questions about the person’s own past', () => {
    expect(
      isOwnExperienceQuestion('Tell me about a time you led a team through a migration.'),
    ).toBe(true);
    expect(isOwnExperienceQuestion('What is your experience with Kubernetes?')).toBe(true);
    expect(isOwnExperienceQuestion('Which queue did you use for the SMS sender?')).toBe(true);
  });

  it('leaves out questions that are not about the person’s past', () => {
    expect(isOwnExperienceQuestion('What is a message queue?')).toBe(false);
    expect(isOwnExperienceQuestion('How would you design a rate limiter?')).toBe(false);
    expect(isOwnExperienceQuestion('What salary are you asking for?')).toBe(false);
  });
});

describe('cvMatchScore', () => {
  it('scores a shared specific word above the threshold', () => {
    expect(
      cvMatchScore('How big was the team when you moved billing off the monolith?', CV),
    ).toBeGreaterThanOrEqual(CV_MATCH_THRESHOLD);
  });

  it('scores no shared specific word at 0, and generic words alone do not count', () => {
    expect(
      cvMatchScore('Tell me about your experience running Kubernetes in production.', CV),
    ).toBe(0);
    expect(cvMatchScore('Tell me about a project where you worked with a team.', CV)).toBe(0);
    expect(cvMatchScore('Any question', '')).toBe(0);
  });
});

describe('noCvMatchLines (the CV match signal)', () => {
  it('fires for an own-experience question with no matching CV clause', () => {
    expect(noCvMatchLines(ask('What is your experience with HIPAA audits?'), true)).toEqual([
      NO_CV_MATCH_LINE,
    ]);
  });

  it('stays quiet when a CV clause matches, outside the experience rules, and for other questions', () => {
    expect(noCvMatchLines(ask('Which queue did you use for the SMS sender?'), true)).toEqual([]);
    expect(noCvMatchLines(ask('What is your experience with HIPAA audits?'), false)).toEqual([]);
    expect(noCvMatchLines(ask('What is a message queue?'), true)).toEqual([]);
  });

  it('is added last in the tail by default, and only there', () => {
    const request = ask('What is your experience with HIPAA audits?');
    const built = buildPrompt(request);
    expect(built.system.map((block) => block.text).join(' ')).not.toContain(NO_CV_MATCH_LINE);
    expect(promptText(request).trimEnd().endsWith(NO_CV_MATCH_LINE)).toBe(true);
    expect(promptText(request, { cvMatchSignal: false })).not.toContain(NO_CV_MATCH_LINE);
    expect(promptText(ask('Which queue did you use for the SMS sender?'))).not.toContain(
      NO_CV_MATCH_LINE,
    );
  });
});

describe('usesExperienceModel (option B, off in the app)', () => {
  it('picks own-experience questions in sessions with the experience rules', () => {
    expect(usesExperienceModel(ask('Tell me about a time you fixed an outage.'), true)).toBe(true);
    expect(usesExperienceModel(ask('Tell me about a time you fixed an outage.'), false)).toBe(
      false,
    );
    expect(usesExperienceModel(ask('What is a message queue?'), true)).toBe(false);
  });
});
