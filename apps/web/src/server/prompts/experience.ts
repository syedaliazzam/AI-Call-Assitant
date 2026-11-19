/**
 * File: apps/web/src/server/prompts/experience.ts
 * Purpose: The CV match signal against claimed experience in live answers (ADR-0108): whether a question asks
 *          about the user's own past, and whether a project in the CV really matches it, scored with the
 *          document search's BM25 (core/documents/chunks.ts) over the CV's clauses. When an own-experience
 *          question has no matching CV project, NO_CV_MATCH_LINE goes after the end reminder (on by default).
 *          Also the smart-model choice for own-experience questions, measured but off (option B: only
 *          scripts/eval-answers.ts --experience-model=sonnet uses it; later, typed questions only).
 * Used by: src/server/prompt.ts (tailText()), scripts/eval-answers.ts
 * Depends on: src/core/documents/chunks.ts (terms(), BM25 constants; pure functions, no browser APIs)
 * Architecture: docs/decisions/ADR-0108-live-prompt-v6-and-cv-match-signal.md; docs/testing/answer-eval.md
 */
import 'server-only';
import type { AnswerRequest, SessionContext } from '@kite/shared';
import { BM25_B, BM25_K1, terms } from '@/core/documents/chunks';

/** Options for buildPrompt(); the app passes none, so every one has its default. */
export interface PromptOptions {
  /**
   * The CV match signal (NO_CV_MATCH_LINE). On unless false: only the evaluation turns it off
   * (--no-cv-match), to compare.
   */
  cvMatchSignal?: boolean;
}

/**
 * The CV match signal's line, the developer's wording, added after the end reminder when it fires.
 */
export const NO_CV_MATCH_LINE =
  'No CV project matches this question: answer only with your approach (I would…), with no past-tense claims.';

/**
 * The minimum BM25 score of the best CV clause for a CV project to count as matching the question
 * (the CV match signal). Chosen from the evaluation's 19 own-experience questions in interview sessions (answer-eval.md,
 * 19 Nov 2026): a CV clause sharing one specific word with the question scores 0.65 or more, and with none
 * 0, so 0.5 means "at least one specific word in common". Words alone miss a match worded differently
 * ("difficult client" against "retail customer"): 3 of its 10 firings there had a fitting CV project.
 */
export const CV_MATCH_THRESHOLD = 0.5;

/**
 * Words that say a question is about the person's own past. Generic, so they never count as a CV match
 * on their own.
 */
const GENERIC_PAST_WORDS: ReadonlySet<string> = new Set(
  terms(
    'experience time project projects work worked working role team example situation difficult biggest hardest proudest led lead handled manage managed used use',
  ),
);

/**
 * Whether a question asks about the user's own past (experience, a time when, what they did): second
 * person plus a past or experience cue. Rules only; no request is spent on it.
 *
 * @param question The question.
 * @returns True for an own-experience question.
 * Called from: noCvMatchLines(), usesExperienceModel(); tests
 */
export function isOwnExperienceQuestion(question: string): boolean {
  const text = question.toLowerCase();
  if (!/\b(you|your|you've|you're|you'd|yourself)\b/.test(text)) return false;
  return /\b(experience|a time|tell me about|walk me through|have you|did you|were you|when you|example of|biggest|proudest|hardest|most difficult|your (last|previous|current|past|role|team|project|background)|you (have |had )?(led|built|ran|run|managed|handled|deployed|moved|caused|used|worked|shipped|designed|migrated|fixed|dealt))\b/.test(
    text,
  );
}

/**
 * The session's CV text: a document of kind 'resume', or (evaluation scenarios name it) one named like
 * a CV or resume.
 *
 * @param documents The session's documents.
 * @returns The CV text, or '' with no CV.
 */
function cvText(documents: SessionContext['documents']): string {
  const cv =
    documents.find((document) => document.kind === 'resume') ??
    documents.find((document) => /\b(cv|resume|résumé)\b/i.test(document.name));
  return cv?.text ?? '';
}

/**
 * The best BM25 score of a CV clause (split at line ends, full stops and semicolons) for a question,
 * counting only the question's specific words (not GENERIC_PAST_WORDS). The same formula and constants
 * as rankChunks() in core/documents/chunks.ts, over the CV's clauses instead of document parts.
 *
 * @param question The question.
 * @param cv       The CV text.
 * @returns The best clause's score (0 with no CV or no shared specific word).
 * Called from: noCvMatchLines(); tests
 */
export function cvMatchScore(question: string, cv: string): number {
  const wanted = [...new Set(terms(question))].filter((word) => !GENERIC_PAST_WORDS.has(word));
  const clauses = cv
    .split(/[\n;]|\.(?=\s|$)/)
    .map((clause) => terms(clause))
    .filter((words) => words.length > 0);
  if (wanted.length === 0 || clauses.length === 0) return 0;
  const frequency = new Map<string, number>();
  for (const words of clauses)
    for (const word of new Set(words)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const averageLength = clauses.reduce((total, words) => total + words.length, 0) / clauses.length;
  let best = 0;
  for (const words of clauses) {
    let score = 0;
    for (const word of wanted) {
      const count = words.filter((w) => w === word).length;
      if (count === 0) continue;
      const containing = frequency.get(word) ?? 0;
      const idf = Math.log(1 + (clauses.length - containing + 0.5) / (containing + 0.5));
      const norm = 1 - BM25_B + BM25_B * (words.length / (averageLength || 1));
      score += (idf * count * (BM25_K1 + 1)) / (count + BM25_K1 * norm);
    }
    best = Math.max(best, score);
  }
  return best;
}

/**
 * The question a request answers: its question, or the newest line from the other person.
 *
 * @param request The request.
 * @returns The question text ('' with none).
 */
function questionOf(request: AnswerRequest): string {
  const typed = request.question?.trim();
  if (typed) return typed;
  const them = [...(request.tail ?? [])].reverse().find((line) => line.speaker === 'them');
  return them?.text ?? '';
}

/**
 * Whether the CV match signal or the smart-model choice applies to a request at all: a spoken or typed question (not a screenshot) in a
 * session that has the experience rules (interview, mock or blank, not "Full example story").
 *
 * @param request         The request.
 * @param experienceRules Whether the session gets the experience rules (prompt.ts experienceApplies()).
 * @returns True when the question is about the user's own past in such a session.
 * Called from: noCvMatchLines(), usesExperienceModel()
 */
function ownExperienceRequest(request: AnswerRequest, experienceRules: boolean): boolean {
  return (
    experienceRules &&
    request.styleVersion !== 'previous' &&
    (request.mode === 'answer' || request.mode === 'chat') &&
    isOwnExperienceQuestion(questionOf(request))
  );
}

/**
 * The CV match signal: [NO_CV_MATCH_LINE] when an own-experience question has no CV clause scoring at least
 * CV_MATCH_THRESHOLD (or there is no CV); else [].
 *
 * @param request         The request.
 * @param experienceRules Whether the session gets the experience rules.
 * @returns The lines to add after the end reminder.
 * Called from: tailText() in prompt.ts (unless PromptOptions.cvMatchSignal is false); scripts/eval-answers.ts
 */
export function noCvMatchLines(request: AnswerRequest, experienceRules: boolean): string[] {
  if (!request.session || !ownExperienceRequest(request, experienceRules)) return [];
  const score = cvMatchScore(questionOf(request), cvText(request.session.documents));
  return score < CV_MATCH_THRESHOLD ? [NO_CV_MATCH_LINE] : [];
}

/**
 * The smart-model choice (option B, measured 19 Nov 2026, off in the app): whether a request is an own-experience question that would go to the smart model.
 *
 * @param request         The request.
 * @param experienceRules Whether the session gets the experience rules.
 * @returns True for the smart model.
 * Called from: scripts/eval-answers.ts (--experience-model=sonnet)
 */
export function usesExperienceModel(request: AnswerRequest, experienceRules: boolean): boolean {
  return ownExperienceRequest(request, experienceRules);
}
