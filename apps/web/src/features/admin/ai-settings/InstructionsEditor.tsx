/**
 * File: apps/web/src/features/admin/ai-settings/InstructionsEditor.tsx
 * Purpose: One block of Admin → AI settings (ADR-0083): the editable company instructions with a live
 *          character counter (4,000 at most), the input-budget check (live answers), examples to add,
 *          Save and Discard, then "Try it" with the draft, the locked rules (read-only) and the version
 *          history.
 * Used by: src/features/admin/ai-settings/AiSettingsPage.tsx
 * Depends on: React, @kite/shared (limit, answerBudgetUse), src/ui (Button, Textarea),
 *             ./TryPanel.tsx, ./VersionHistory.tsx, ./LockedRules.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
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
 * One block's editor and its panels.
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
  const use = budget ? answerBudgetUse({ ...budget, chars: cleaned(draft).length }) : null;

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

  /**
   * Adds an example line at the end of the draft (on a new line), within the limit.
   *
   * @param line The example.
   */
  function addExample(line: string) {
    setDraft((current) => {
      const next = current.trim() ? `${current.replace(/\s+$/, '')}\n${line}` : line;
      return next.length <= MAX_AI_INSTRUCTIONS_CHARS ? next : current;
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
        <p className="mt-1 max-w-prose text-[13px] text-ui-muted">{copy.helper}</p>

        <div className="mt-4">
          <Textarea
            label="Company instructions"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_AI_INSTRUCTIONS_CHARS}
            counter
            rows={10}
            placeholder="Empty: no company instructions (the AI answers as it does today)."
            hint="Plain sentences or short bullet lines. Leave it empty for no company instructions."
            {...(error ? { error } : {})}
            className="font-[inherit]"
          />
        </div>

        {use && (
          <p
            role={use.near ? 'alert' : undefined}
            className={`mt-2 text-helper ${use.near ? 'text-ui-warning' : 'text-ui-muted'}`}
            data-testid="budget-line"
          >
            {use.blockTokens > 0
              ? `Adds about ${use.blockTokens.toLocaleString('en-US')} tokens to every answer request. `
              : 'Adds nothing to answer requests. '}
            The largest possible request would use about {Math.round(use.share * 100)}% of the{' '}
            {use.budgetTokens.toLocaleString('en-US')}-token input budget
            {use.near
              ? ': close to the limit. Shorten the instructions, or long calls with large documents may lose their oldest parts.'
              : '.'}
          </p>
        )}

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
            {dirty
              ? 'Unsaved changes: Try it uses this draft.'
              : view.activeId
                ? 'Live version.'
                : 'Not set yet.'}
          </span>
        </div>

        <details className="mt-5 group">
          <summary className="cursor-pointer text-[14px] font-medium text-ui-link">
            Examples of what to write
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {copy.examples.map((example) => (
              <li
                key={example}
                className="flex items-start justify-between gap-3 rounded-control bg-ui-subtle px-3 py-2"
              >
                <span className="text-[13px] text-ui-text">{example}</span>
                <Button
                  variant="plain"
                  size="sm"
                  className="shrink-0 gap-1"
                  onClick={() => addExample(example)}
                  aria-label={`Add example: ${example}`}
                >
                  <Plus aria-hidden="true" size={14} strokeWidth={1.75} />
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <TryPanel block={block} draft={draft} />
      <LockedRules parts={view.locked} />
      <VersionHistory
        block={block}
        versions={view.versions}
        activeId={view.activeId}
        activeText={view.activeText}
        restore={actions.restore}
        onToast={onToast}
      />
    </div>
  );
}
