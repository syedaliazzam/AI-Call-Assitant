/**
 * File: apps/web/src/features/admin/ai-settings/blocks.ts
 * Purpose: What Admin → AI settings says about each editable block (ADR-0083): its name, which model
 *          and requests it applies to, a short helper text, example instructions an admin can start
 *          from, and the sample the "Try it" box offers. Also the page's data types, filled by the
 *          server page.
 * Used by: src/features/admin/ai-settings/*.tsx, app/(app)/admin/ai-settings/page.tsx
 * Depends on: @kite/shared (AiInstructionBlock)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 */
import type { AiInstructionBlock } from '@kite/shared';

/** A card's classes, as on the Users and Usage pages. */
export const CARD = 'rounded-card border border-ui-border bg-ui-surface p-6 shadow-card';

/** The fixed words about one block. */
export interface BlockCopy {
  /** The tab's name. */
  label: string;
  /** The model and where it applies, in a few words. */
  model: string;
  /** One or two sentences under the title. */
  helper: string;
  /** Example lines an admin can write (shown, and insertable). */
  examples: readonly string[];
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
    helper:
      'Applies to every answer during a call, including typed questions, screenshots and private answers. Write how answers should sound and what they should know about the company. The locked rules below always come first and win where they differ.',
    examples: [
      'Tone: confident and warm; avoid jargon unless the other person uses it first.',
      'Keep answers short: the headline and at most three bullets unless asked for detail.',
      'Say "customers", never "users". Never say "cheap"; say "cost-effective".',
      'Company facts: we are <company>; we sell <product> to <kind of customer>; support is by email, weekdays.',
      'Behavioural questions: always use the STAR shape (Situation, Task, Action, Result).',
      'Pricing questions: give the headline price only and offer to send the full quote after the call.',
    ],
    sampleLabel: 'Sample question (as the other person asks it)',
    samplePlaceholder: 'Tell me about a time you handled a difficult client.',
  },
  notes: {
    label: 'AI notes',
    model: 'Claude Sonnet · after each call',
    helper:
      'Applies to the notes written when a call ends (and to Regenerate). Write what the notes should bring out and how they should be worded. The notes keep their fixed sections, and never add anything the call did not say.',
    examples: [
      'In the summary, always say whether a budget or a deadline was mentioned.',
      'Write next steps as short imperatives ("Send the proposal").',
      'Use British spelling.',
      'Call the other side "the client", not "them".',
    ],
    sampleLabel: 'Sample call (one turn per line, starting "Them:" or "You:")',
    samplePlaceholder:
      'Them: Thanks for joining. Can you walk me through your pricing?\nYou: Sure, our standard plan is per seat, billed monthly.\nThem: Great, can you send a proposal by Friday?\nYou: Yes, I will send it by Thursday.',
  },
  ask: {
    label: 'Ask AI',
    model: 'Claude Sonnet · Ask AI page and session reviews',
    helper:
      "Applies to the Ask AI page and to Ask AI in a session's review. Write the tone, length and company facts its replies should use.",
    examples: [
      'Answer in plain English, in at most five sentences unless asked for more.',
      'When asked about our products, use the official names: Paramount Voice, Paramount Notes.',
      'For code, prefer TypeScript unless the user names another language.',
    ],
    sampleLabel: 'Sample question',
    samplePlaceholder: 'Draft a short follow-up email after a sales call.',
  },
};

/** One saved version, as the page shows it. */
export interface VersionView {
  /** The version's id. */
  id: string;
  /** Its text ('' means no instructions). */
  text: string;
  /** Who saved it, or null when that account was deleted. */
  authorName: string | null;
  /** True for a restore of an earlier version. */
  restored: boolean;
  /** When it was saved (ISO 8601). */
  createdAt: string;
}

/** One locked part of a block's rules (read-only). */
export interface LockedView {
  /** What it is. */
  title: string;
  /** The exact text. */
  text: string;
}

/** Everything the page shows for one block. */
export interface BlockView {
  /** The version in force, or null when never saved. */
  activeId: string | null;
  /** The text in force ('' for none). */
  activeText: string;
  /** The history, newest first. */
  versions: VersionView[];
  /** The locked rules, in prompt order. */
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
}

/** What the save and restore actions return. */
export type InstructionsActionResult =
  | {
      /** It worked. */
      ok: true;
      /** False when nothing changed (the text equals the version in force). */
      created: boolean;
    }
  | {
      /** It did not. */
      ok: false;
      /** The message to show. */
      error: string;
    };

/** The server actions the page calls. */
export interface InstructionsActions {
  /** Saves a block's text as a new version in force. */
  save: (block: AiInstructionBlock, text: string) => Promise<InstructionsActionResult>;
  /** Restores an earlier version as a new version in force. */
  restore: (block: AiInstructionBlock, versionId: string) => Promise<InstructionsActionResult>;
}
