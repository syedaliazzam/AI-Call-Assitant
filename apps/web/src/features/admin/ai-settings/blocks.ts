/**
 * File: apps/web/src/features/admin/ai-settings/blocks.ts
 * Purpose: What Admin → AI settings says about each tab (ADR-0089): its name, the one-line description,
 *          the model, and the sample the "Try it" box offers. Also the page's data types, filled by the
 *          server page (each tab's version in force, default prompt, app contract and history), the
 *          server actions' shapes, and small helpers (version labels, dates).
 * Used by: src/features/admin/ai-settings/*.tsx, app/(app)/admin/ai-settings/page.tsx
 * Depends on: @kite/shared (AiInstructionBlock)
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 */
import type { AiInstructionBlock } from '@kite/shared';

/** A card's classes, as on the Users and Usage pages. */
export const CARD = 'rounded-card border border-ui-border bg-ui-surface shadow-card';

/** The fixed words about one tab. */
export interface BlockCopy {
  /** The tab's name. */
  label: string;
  /** One line under the tabs: where this prompt is used. */
  description: string;
  /** The model, in a few words. */
  model: string;
  /** The label of the try's sample box. */
  sampleLabel: string;
  /** The sample box's placeholder. */
  samplePlaceholder: string;
}

/** The words for each tab. */
export const BLOCK_COPY: Readonly<Record<AiInstructionBlock, BlockCopy>> = {
  live: {
    label: 'Live answers',
    description: 'Used during calls',
    model: 'Claude Haiku',
    sampleLabel: 'Sample question (as the other person asks it)',
    samplePlaceholder: 'Tell me about a time you handled a difficult client.',
  },
  notes: {
    label: 'AI notes',
    description: 'Used for after-call notes',
    model: 'Claude Sonnet',
    sampleLabel: 'Sample call (one turn per line, starting "Them:" or "You:")',
    samplePlaceholder:
      'Them: Thanks for joining. Can you walk me through your pricing?\nYou: Sure, our standard plan is per seat, billed monthly.\nThem: Great, can you send a proposal by Friday?\nYou: Yes, I will send it by Thursday.',
  },
  ask: {
    label: 'Ask AI',
    description: 'Used in Ask AI',
    model: 'Claude Sonnet',
    sampleLabel: 'Sample question',
    samplePlaceholder: 'Draft a short follow-up email after a sales call.',
  },
};

/** One saved version, as the page shows it. */
export interface VersionView {
  /** The version's id. */
  id: string;
  /** Its number in the tab's history (1 = the first ever saved). */
  number: number;
  /** Its global prompt, or null for the default prompt. */
  prompt: string | null;
  /** The admin's note, or null. */
  note: string | null;
  /** Who saved it, or null when that account was deleted. */
  authorName: string | null;
  /** True for a restore of an earlier version. */
  restored: boolean;
  /** True for a version saved before ADR-0089 (moved from the old AI settings). */
  legacy: boolean;
  /** When it was saved (ISO 8601). */
  createdAt: string;
}

/** One part of a tab's app contract (read-only). */
export interface ContractView {
  /** Where it applies. */
  title: string;
  /** The exact text sent. */
  text: string;
}

/** Everything the page shows for one tab. */
export interface BlockView {
  /** The version in force, or null when never saved (the default prompt). */
  activeId: string | null;
  /** The global prompt in force, or null for the default prompt. */
  activePrompt: string | null;
  /** The tab's default prompt (what "Reset to default" goes back to). */
  defaultPrompt: string;
  /** The app contract, sent before the prompt (read-only). */
  contract: ContractView[];
  /** The history, newest first. */
  versions: VersionView[];
}

/** The live answers budget facts (from the server; see answerBudgetUse() in @kite/shared). */
export interface BudgetView {
  /** The largest live-answer request without a global prompt, tokens. */
  baseTokens: number;
  /** The budget, tokens. */
  budgetTokens: number;
  /** Characters a token, as the server counts. */
  charsPerToken: number;
  /** The characters the global prompt's heading adds. */
  headingChars: number;
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
  /** Saves a tab's tried global prompt as a new version in force, with an optional note. */
  save: (
    block: AiInstructionBlock,
    prompt: string,
    token: string,
    note: string,
  ) => Promise<InstructionsActionResult>;
  /** Goes back to the tab's default prompt (a new version). */
  reset: (block: AiInstructionBlock) => Promise<InstructionsActionResult>;
  /** Restores an earlier version as a new version in force. */
  restore: (block: AiInstructionBlock, versionId: string) => Promise<InstructionsActionResult>;
}

/**
 * The text a version sends: its own prompt, or the default one.
 *
 * @param version The version.
 * @param fallback The tab's default prompt.
 * @returns The text.
 * Called from: VersionHistory.tsx, PromptWorkspace.tsx
 */
export function versionText(version: Pick<VersionView, 'prompt'> | null, fallback: string): string {
  return version?.prompt ?? fallback;
}

/**
 * A date and time for the page, in the viewer's own settings ("16 Nov 2026, 14:05").
 *
 * @param iso The time (ISO 8601).
 * @returns The words.
 * Called from: AiSettingsPage.tsx, VersionHistory.tsx
 */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
