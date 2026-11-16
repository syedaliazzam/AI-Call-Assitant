/**
 * File: apps/web/src/features/admin/ai-settings/InstructionsEditor.tsx
 * Purpose: Simple mode of one block in Admin → AI settings (ADR-0083, simplified in ADR-0086): one
 *          "Instructions for the AI" box with a character counter (4,000 at most), Try it with the draft,
 *          Save and Discard, then the built-in rules folded behind a link, and the instructions' version
 *          history. A warning appears only when long instructions bring live answers near the input
 *          budget.
 * Used by: src/features/admin/ai-settings/AiSettingsPage.tsx
 * Depends on: React, @kite/shared (limit, answerBudgetUse), src/ui (Button, Textarea),
 *             ./TryPanel.tsx, ./VersionHistory.tsx, ./LockedRules.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useState, useTransition } from 'react';
import { answerBudgetUse, MAX_AI_INSTRUCTIONS_CHARS, type AiInstructionBlock } from '@kite/shared';
import type { ToastTone } from '@/ui/Toast';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Textarea';
import {
  BLOCK_COPY,
  CARD,
  type BlockView,
  type BudgetView,
  type InstructionsActions,
} from './blocks';
import { LockedRules } from './LockedRules';
import { TryPanel } from './TryPanel';
import { VersionHistory } from './VersionHistory';

/** Props for InstructionsEditor. */
export interface InstructionsEditorProps {
  /** Which block. */
  block: AiInstructionBlock;
  /** Its state from the server. */
  view: BlockView;
  /** The budget facts (live answers only), or null. */
  budget: BudgetView | null;
  /** The server actions. */
  actions: InstructionsActions;
  /** Shows the page's toast. */
  onToast: (text: string, tone?: ToastTone) => void;
}

/**
 * Cleans text the way the server saves it (line endings, outer spaces), to tell whether the draft
 * really differs from the version in force.
 *
 * @param text The text.
 * @returns The cleaned text.
 */
function cleaned(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * One block's simple editor.
 *
 * @param props See InstructionsEditorProps.
 * @returns The block's cards.
 * Rendered by: AiSettingsPage.tsx
 */
export function InstructionsEditor({
  block,
  view,
  budget,
  actions,
  onToast,
}: InstructionsEditorProps) {
  const copy = BLOCK_COPY[block];
  const [draft, setDraft] = useState(view.activeText);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A save or a restore brings a new version from the server: the editor shows it (set during render,
  // as React recommends for state that follows a prop, rather than in an effect).
  const [shownId, setShownId] = useState(view.activeId);
  if (shownId !== view.activeId) {
    setShownId(view.activeId);
    setDraft(view.activeText);
    setError(null);
  }

  const dirty = cleaned(draft) !== cleaned(view.activeText);
  const use = budget
    ? answerBudgetUse({
        ...budget,
        chars: cleaned(draft).length,
        // A custom full prompt in force counts too (ADR-0086).
        extraChars: view.activePrompt
          ? Object.values(view.activePrompt).reduce((sum, part) => sum + (part ?? '').length, 0) -
            budget.builtInPromptChars
          : 0,
      })
    : null;

  /** Saves the draft as the new version in force. */
  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await actions.save(block, draft);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onToast(
          result.created
            ? `${copy.label}: saved. Calls that start from now use it.`
            : 'Nothing changed: this is already the live version.',
          'success',
        );
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={`${copy.label} instructions`} className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[18px] font-semibold text-ui-heading">{copy.label}</h2>
          <span className="inline-flex h-6 items-center rounded-full bg-ui-accent-tint px-2.5 text-chip text-ui-link">
            {copy.model}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ui-muted">{copy.helper}</p>

        <div className="mt-4">
          <Textarea
            label="Instructions for the AI"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_AI_INSTRUCTIONS_CHARS}
            counter
            rows={8}
            placeholder="For example: keep answers short and warm; say “customers”, never “users”."
            {...(error ? { error } : {})}
            className="font-[inherit]"
          />
        </div>

        {use?.near && (
          <p role="alert" className="mt-2 text-helper text-ui-warning" data-testid="budget-line">
            Long instructions: the largest live request would use about{' '}
            {Math.round(use.share * 100)}% of the {use.budgetTokens.toLocaleString('en-US')}-token
            input budget. Shorten them, or long calls with large documents may lose their oldest
            parts.
          </p>
        )}

        <div className="mt-4">
          <TryPanel block={block} draft={draft} prompt={view.activePrompt} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!dirty || pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(view.activeText);
              setError(null);
            }}
            disabled={!dirty || pending}
          >
            Discard changes
          </Button>
          <span className="text-[13px] text-ui-muted" aria-live="polite">
            {dirty ? 'Unsaved changes.' : view.activeId ? 'Live version.' : 'Not set yet.'}
          </span>
        </div>

        <div className="mt-5">
          <LockedRules parts={view.locked} replaced={view.activePrompt !== null} />
        </div>
      </section>

      <VersionHistory
        block={block}
        mode="text"
        versions={view.versions}
        activeId={view.activeId}
        activeText={view.activeText}
        activePrompt={view.activePrompt}
        locked={view.locked}
        restore={actions.restore}
        onToast={onToast}
      />
    </div>
  );
}
