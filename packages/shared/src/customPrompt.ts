/**
 * File: packages/shared/src/customPrompt.ts
 * Purpose: The full system prompt an admin may edit per block in Admin → AI settings (ADR-0086): the
 *          parts of each block's prompt, how a custom prompt is cleaned, the key that tells whether
 *          two prompts send the same bytes, and the check that refuses a prompt missing the output
 *          format the app reads (the hidden first and last lines, the garbled and none rules, the
 *          notes' fields).
 * Used by: apps/web/src/server/aiInstructions.ts, apps/web/src/server/aiTry.ts,
 *          apps/web/src/server/validate.ts, apps/web/src/features/admin/ai-settings/*
 * Depends on: ./aiInstructions.ts (AiInstructionBlock)
 * Architecture: docs/decisions/ADR-0086-full-system-prompt-editing.md
 *
 * A custom prompt is company content: it goes into prompts only, never into a log.
 */
import type { AiInstructionBlock } from './aiInstructions';

/**
 * The parts of each block's full system prompt, in prompt order. An admin may replace them all
 * (advanced mode); the built-in text is used for a block with no custom prompt.
 * - live: 'core' (the rules, first cached system block), 'reminder' (after the question) and
 *   'screenshot' (added for a screenshot question);
 * - notes: 'rules' (the notes rules);
 * - ask: 'chat' (the Ask AI page) and 'review' (Ask AI in a session's review).
 */
export const PROMPT_PARTS = {
  live: ['core', 'reminder', 'screenshot'],
  notes: ['rules'],
  ask: ['chat', 'review'],
} as const satisfies Readonly<Record<AiInstructionBlock, readonly string[]>>;

/** One part of a full system prompt (see PROMPT_PARTS). */
export type PromptPartKey = (typeof PROMPT_PARTS)[AiInstructionBlock][number];

/** A block's custom full system prompt: the text of each of its parts (PROMPT_PARTS[block]). */
export type CustomPrompt = Partial<Record<PromptPartKey, string>>;

/** Most characters one part may hold (the built-in live rules are about 14,000). */
export const MAX_PROMPT_PART_CHARS = 40_000;

/** What each part is called on the page and in the check's messages. */
export const PROMPT_PART_TITLES: Readonly<Record<PromptPartKey, string>> = {
  core: 'Rules for every live answer',
  reminder: 'Reminder added after the question',
  screenshot: 'Added for a screenshot',
  rules: 'Rules for the AI notes',
  chat: 'Rules for the Ask AI page',
  review: "Rules for Ask AI in a session's review",
};

/**
 * Cleans a custom prompt the same way everywhere (page, try, save): only the block's parts are kept,
 * each with "\n" line endings and no blank space at either end; a missing part becomes ''. So the
 * same prompt always gives the same bytes, and so the same prompt cache.
 *
 * @param block  The block.
 * @param prompt The prompt as edited.
 * @returns The cleaned prompt, with every part of the block present.
 * Called from: checkCustomPrompt(), promptKey(); apps/web/src/server/aiInstructions.ts (saving)
 */
export function normalisePrompt(block: AiInstructionBlock, prompt: CustomPrompt): CustomPrompt {
  const cleaned: CustomPrompt = {};
  for (const part of PROMPT_PARTS[block]) {
    cleaned[part] = (prompt[part] ?? '').replace(/\r\n?/g, '\n').trim();
  }
  return cleaned;
}

/**
 * One string that is equal for two prompts exactly when they send the same bytes: the cleaned parts
 * in PROMPT_PARTS order. Ties a try to the text saved, and tells whether a draft changed.
 *
 * @param block  The block.
 * @param prompt The prompt.
 * @returns The key (a JSON array).
 * Called from: apps/web/src/server/aiTry.ts (the try token), aiInstructions.ts (same-as-live check),
 *              the admin page (tried and unsaved checks)
 */
export function promptKey(block: AiInstructionBlock, prompt: CustomPrompt): string {
  const cleaned = normalisePrompt(block, prompt);
  return JSON.stringify(PROMPT_PARTS[block].map((part) => cleaned[part] ?? ''));
}

/** One reason a custom prompt cannot be tried or saved. */
export interface PromptProblem {
  /** The part it is about. */
  part: PromptPartKey;
  /** What is missing or wrong, in words an admin can act on. */
  message: string;
}

/** A required piece of a part: a test, and what to say when it fails. */
interface Requirement {
  /** True when the part has it. */
  test: (text: string) => boolean;
  /** What is missing. */
  message: string;
}

/**
 * Whether one line of the text matches every pattern, so a rule and what it requires stay together
 * (for example "garbled" and "only the two hidden lines").
 *
 * @param text     The part's text.
 * @param patterns The patterns one line must all match.
 * @returns True when such a line exists.
 * Called from: REQUIREMENTS
 */
function someLine(text: string, patterns: readonly RegExp[]): boolean {
  return text.split('\n').some((line) => patterns.every((pattern) => pattern.test(line)));
}

/** The words that make a reply of hidden lines only, which the app shows as "no answer". */
const ONLY_HIDDEN = /only the two hidden lines/i;

/** The notes' fields, which the app reads one by one (the reply's shape is fixed by a JSON schema). */
const NOTES_FIELDS = ['summary', 'questions', 'answerId', 'nextSteps', 'unclear', 'lessons'];

/**
 * What each part must keep, because the app reads the reply's shape. A part with no entry only has to
 * be non-empty (and the live reminder may be empty).
 */
const REQUIREMENTS: Readonly<Partial<Record<PromptPartKey, readonly Requirement[]>>> = {
  core: [
    {
      test: (text) => text.includes('[[type|for|source]]'),
      message:
        'The hidden first line is missing: keep the rule that every reply starts with the line [[type|for|source]].',
    },
    {
      test: (text) => text.includes('[[question|'),
      message:
        'The hidden last line is missing: keep the rule that every reply ends with the line [[question|the question you answered]].',
    },
    {
      test: (text) => someLine(text, [/\bgarbled\b/i, ONLY_HIDDEN]),
      message:
        'The garbled rule is missing: keep a line saying that for garbled words the reply is "only the two hidden lines".',
    },
    {
      // "none:" starts the rule's own line ("- none: when the words ask the user nothing…").
      test: (text) => someLine(text, [/(^|[^a-z])none:/i, ONLY_HIDDEN]),
      message:
        'The none rule is missing: keep a line starting "none:" saying that when the words ask nothing the reply is "only the two hidden lines".',
    },
  ],
  screenshot: [
    {
      test: (text) => text.includes('[[type|for|source]]'),
      message:
        'The hidden first line is missing: keep the rule that a screenshot reply starts with the line [[type|for|source]], with the kind of screen as the type.',
    },
  ],
  rules: NOTES_FIELDS.map((field): Requirement => ({
    test: (text) => new RegExp(`\\b${field}\\b`).test(text),
    message: `The "${field}" field is not explained: keep a rule that says what goes in ${field}.`,
  })),
  chat: [
    {
      test: (text) => text.includes('[[type|kite|source]]'),
      message:
        'The hidden first line is missing: keep the rule that every reply starts with the line [[type|kite|source]].',
    },
  ],
};

/**
 * Checks a custom prompt before it is tried or saved: every part within the length limit, every part
 * but the live reminder non-empty, and the output-format rules the app reads still present. The page
 * shows the problems as the admin types; the server refuses a try or a save that has any.
 *
 * @param block  The block.
 * @param prompt The prompt (cleaned here).
 * @returns The problems, in part order ([] when it can be saved).
 * Called from: apps/web/src/server/aiTry.ts (handleTry), apps/web/src/server/aiInstructions.ts
 *              (savePrompt, restoreInstructions), features/admin/ai-settings/PromptEditor.tsx; tests
 */
export function checkCustomPrompt(
  block: AiInstructionBlock,
  prompt: CustomPrompt,
): PromptProblem[] {
  const cleaned = normalisePrompt(block, prompt);
  const problems: PromptProblem[] = [];
  for (const part of PROMPT_PARTS[block]) {
    const text = cleaned[part] ?? '';
    if (text.length > MAX_PROMPT_PART_CHARS) {
      problems.push({
        part,
        message: `Too long: use at most ${MAX_PROMPT_PART_CHARS.toLocaleString('en-US')} characters.`,
      });
      continue;
    }
    if (text === '') {
      // An empty reminder only leaves the reminder out; every other part is needed.
      if (part !== 'reminder') problems.push({ part, message: 'Empty: this part is needed.' });
      continue;
    }
    for (const requirement of REQUIREMENTS[part] ?? []) {
      if (!requirement.test(text)) problems.push({ part, message: requirement.message });
    }
  }
  return problems;
}

/**
 * The problems as one message, naming each part: what the server returns and the page shows.
 *
 * @param problems From checkCustomPrompt().
 * @returns For example 'Rules for every live answer: The hidden first line is missing: …'.
 * Called from: apps/web/src/server/aiTry.ts, app/(app)/admin/ai-settings/actions.ts; tests
 */
export function describePromptProblems(problems: readonly PromptProblem[]): string {
  return problems
    .map((problem) => `${PROMPT_PART_TITLES[problem.part]}: ${problem.message}`)
    .join(' ');
}
