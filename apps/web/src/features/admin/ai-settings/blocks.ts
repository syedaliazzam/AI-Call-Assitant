/**
 * File: apps/web/src/features/admin/ai-settings/blocks.ts
 * Purpose: What Admin → AI settings says about each editable block (ADR-0083): its name, which model
 *          and requests it applies to, one short helper line, and the sample the "Try it" box offers.
 *          Also the page's data types, filled by the server page, including (ADR-0086) each block's
 *          built-in and custom full system prompt, and helpers to compare prompts.
 * Used by: src/features/admin/ai-settings/*.tsx, app/(app)/admin/ai-settings/page.tsx
 * Depends on: @kite/shared (AiInstructionBlock, prompt parts)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 */
import {
  PROMPT_PART_TITLES,
  PROMPT_PARTS,
  promptKey,
  type AiInstructionBlock,
  type CustomPrompt,
  type PromptPartKey,
} from '@kite/shared';

/** A card's classes, as on the Users and Usage pages. */
export const CARD = 'rounded-card border border-ui-border bg-ui-surface p-6 shadow-card';

/** The fixed words about one block. */
export interface BlockCopy {
  /** The tab's name. */
  label: string;
  /** The model and where it applies, in a few words. */
  model: string;
  /** One short line under the title. */
  helper: string;
  /** The label of the try's sample box. */
  sampleLabel: string;
  /** The sample box's placeholder. */
  samplePlaceholder: string;
}

/** The words for each block. */
export const BLOCK_COPY: Readonly<Record<AiInstructionBlock, BlockCopy>> = {
  live: {
    label: 'Live answers',
    model: 'Claude Haiku · during calls',
    helper: 'Tone, length, words to use or avoid, and company facts for answers during calls.',
    sampleLabel: 'Sample question (as the other person asks it)',
    samplePlaceholder: 'Tell me about a time you handled a difficult client.',
  },
  notes: {
    label: 'AI notes',
    model: 'Claude Sonnet · after each call',
    helper: 'What the notes written after each call should bring out, and how they are worded.',
    sampleLabel: 'Sample call (one turn per line, starting "Them:" or "You:")',
    samplePlaceholder:
      'Them: Thanks for joining. Can you walk me through your pricing?\nYou: Sure, our standard plan is per seat, billed monthly.\nThem: Great, can you send a proposal by Friday?\nYou: Yes, I will send it by Thursday.',
  },
  ask: {
    label: 'Ask AI',
    model: 'Claude Sonnet · Ask AI page and session reviews',
    helper: 'Tone, length and company facts for Ask AI replies.',
    sampleLabel: 'Sample question',
    samplePlaceholder: 'Draft a short follow-up email after a sales call.',
  },
};

/** One saved version, as the page shows it. */
export interface VersionView {
  /** The version's id. */
  id: string;
  /** Its instructions ('' means none). */
  text: string;
  /** Its custom full prompt (ADR-0086), or null for the built-in prompt. */
  prompt: CustomPrompt | null;
  /** Who saved it, or null when that account was deleted. */
  authorName: string | null;
  /** True for a restore of an earlier version. */
  restored: boolean;
  /** When it was saved (ISO 8601). */
  createdAt: string;
}

/** One part of a block's built-in prompt (read-only in simple mode; the start of advanced mode). */
export interface LockedView {
  /** Which part (the key a custom prompt uses). */
  key: PromptPartKey;
  /** What it is. */
  title: string;
  /** The exact text. */
  text: string;
}

/** Everything the page shows for one block. */
export interface BlockView {
  /** The version in force, or null when never saved. */
  activeId: string | null;
  /** The instructions in force ('' for none). */
  activeText: string;
  /** The custom full prompt in force, or null for the built-in prompt (ADR-0086). */
  activePrompt: CustomPrompt | null;
  /** The history, newest first. */
  versions: VersionView[];
  /** The built-in prompt, in prompt order. */
  locked: LockedView[];
}

/** The live block's budget facts (from the server; see answerBudgetUse() in @kite/shared). */
export interface BudgetView {
  /** The largest live-answer request without company instructions, tokens. */
  baseTokens: number;
  /** The budget, tokens. */
  budgetTokens: number;
  /** Characters a token, as the server counts. */
  charsPerToken: number;
  /** The characters the heading adds. */
  overheadChars: number;
  /** The built-in live prompt's length, all parts (ADR-0086). */
  builtInPromptChars: number;
}

/** What the save, reset and restore actions return. */
export type InstructionsActionResult =
  | {
      /** It worked. */
      ok: true;
      /** False when nothing changed (equal to the version in force). */
      created: boolean;
    }
  | {
      /** It did not. */
      ok: false;
      /** The message to show. */
      error: string;
    };

/** The server actions the page calls (app/(app)/admin/ai-settings/actions.ts). */
export interface InstructionsActions {
  /** Saves a block's instructions as a new version in force. */
  save: (block: AiInstructionBlock, text: string) => Promise<InstructionsActionResult>;
  /** Saves a block's tried custom prompt as a new version in force (ADR-0086). */
  savePrompt: (
    block: AiInstructionBlock,
    prompt: CustomPrompt,
    token: string,
  ) => Promise<InstructionsActionResult>;
  /** Goes back to the block's built-in prompt (ADR-0086). */
  resetPrompt: (block: AiInstructionBlock) => Promise<InstructionsActionResult>;
  /** Restores an earlier version's instructions or prompt as a new version in force. */
  restore: (
    block: AiInstructionBlock,
    versionId: string,
    part: 'text' | 'prompt',
  ) => Promise<InstructionsActionResult>;
}

/**
 * A block's built-in prompt as a CustomPrompt (part by part).
 *
 * @param locked The block's built-in parts.
 * @returns The prompt.
 * Called from: PromptEditor.tsx, VersionHistory.tsx
 */
export function builtInPrompt(locked: readonly LockedView[]): CustomPrompt {
  const prompt: CustomPrompt = {};
  for (const part of locked) prompt[part.key] = part.text;
  return prompt;
}

/**
 * A full prompt as one text, part by part under its title: what the version history compares.
 *
 * @param block  The block.
 * @param prompt The prompt.
 * @returns The text.
 * Called from: VersionHistory.tsx
 */
export function promptAsText(block: AiInstructionBlock, prompt: CustomPrompt): string {
  return PROMPT_PARTS[block]
    .map((part) => `## ${PROMPT_PART_TITLES[part]}\n${prompt[part] ?? ''}`)
    .join('\n\n');
}

/**
 * The key of the prompt a version uses (the built-in one when it has none), to compare versions.
 *
 * @param block   The block.
 * @param prompt  The version's prompt, or null.
 * @param builtIn The built-in prompt.
 * @returns The key.
 * Called from: VersionHistory.tsx, PromptEditor.tsx
 */
export function effectivePromptKey(
  block: AiInstructionBlock,
  prompt: CustomPrompt | null,
  builtIn: CustomPrompt,
): string {
  return promptKey(block, prompt ?? builtIn);
}
