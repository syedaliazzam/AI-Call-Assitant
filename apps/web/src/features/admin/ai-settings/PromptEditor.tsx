/**
 * File: apps/web/src/features/admin/ai-settings/PromptEditor.tsx
 * Purpose: Advanced mode of one block in Admin → AI settings (ADR-0086, "Edit full system prompt"):
 *          the block's complete system prompt, part by part, in editable boxes, starting from the
 *          prompt in force (the built-in one until a custom prompt is saved). What the app's output
 *          format needs is checked as the admin types and the missing rules are named; Save works only
 *          for a prompt that passes the check AND was tried exactly as it is. "Reset to default" goes
 *          back to the built-in prompt, and the prompt's version history restores an older one.
 * Used by: src/features/admin/ai-settings/AiSettingsPage.tsx
 * Depends on: React, @kite/shared (checkCustomPrompt, promptKey, limits, answerBudgetUse), src/ui
 *             (Button, Modal, Textarea), ./TryPanel.tsx, ./VersionHistory.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0086-full-system-prompt-editing.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  answerBudgetUse,
  checkCustomPrompt,
  MAX_PROMPT_PART_CHARS,
  PROMPT_PART_TITLES,
  PROMPT_PARTS,
  promptKey,
  type AiInstructionBlock,
  type CustomPrompt,
  type PromptPartKey,
} from '@kite/shared';
import type { ToastTone } from '@/ui/Toast';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { Textarea } from '@/ui/Textarea';
import {
  BLOCK_COPY,
  builtInPrompt,
  CARD,
  type BlockView,
  type BudgetView,
  type InstructionsActions,
} from './blocks';
import { TryPanel } from './TryPanel';
import { VersionHistory } from './VersionHistory';

/** Props for PromptEditor. */
export interface PromptEditorProps {
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

/** How tall each part's box starts, in rows (the long rules get the most room). */
const ROWS: Readonly<Record<PromptPartKey, number>> = {
  core: 22,
  reminder: 6,
  screenshot: 10,
  rules: 16,
  chat: 12,
  review: 10,
};

/**
 * The characters a prompt holds, all parts together.
 *
 * @param prompt The prompt.
 * @returns The count.
 */
function totalChars(prompt: CustomPrompt): number {
  return Object.values(prompt).reduce((sum, part) => sum + (part ?? '').length, 0);
}

/**
 * One block's full-prompt editor.
 *
 * @param props See PromptEditorProps.
 * @returns The block's cards and the reset dialog.
 * Rendered by: AiSettingsPage.tsx
 */
export function PromptEditor({ block, view, budget, actions, onToast }: PromptEditorProps) {
  const copy = BLOCK_COPY[block];
  const builtIn = useMemo(() => builtInPrompt(view.locked), [view.locked]);
  const baseline = view.activePrompt ?? builtIn;
  const [draft, setDraft] = useState<CustomPrompt>(baseline);
  // The last successful try: the key of the prompt it sent and the token proving it.
  const [tried, setTried] = useState<{ key: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, startTransition] = useTransition();
  // A save, reset or restore brings a new version: the editor shows its prompt (set during render,
  // as React recommends for state that follows a prop).
  const [shownId, setShownId] = useState(view.activeId);
  if (shownId !== view.activeId) {
    setShownId(view.activeId);
    setDraft(baseline);
    setTried(null);
    setError(null);
  }

  const key = promptKey(block, draft);
  const dirty = key !== promptKey(block, baseline);
  const problems = useMemo(() => checkCustomPrompt(block, draft), [block, draft]);
  const triedNow = tried !== null && tried.key === key;
  const canSave = dirty && problems.length === 0 && triedNow && !pending;
  const use = budget
    ? answerBudgetUse({
        ...budget,
        chars: view.activeText.length,
        extraChars: totalChars(draft) - budget.builtInPromptChars,
      })
    : null;

  /** Saves the tried draft as the prompt in force. */
  function save() {
    if (!tried) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await actions.savePrompt(block, draft, tried.token);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onToast(
          result.created
            ? `${copy.label}: full prompt saved. Calls that start from now use it.`
            : 'Nothing changed: this is already the live prompt.',
          'success',
        );
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  }

  /** Goes back to the built-in prompt (a new version), after the dialog's confirmation. */
  function reset() {
    setConfirmReset(false);
    setError(null);
    startTransition(async () => {
      try {
        const result = await actions.resetPrompt(block);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onToast(`${copy.label}: back to the built-in prompt for new calls.`, 'success');
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  }

  const status = !dirty
    ? view.activePrompt
      ? 'Custom prompt in force.'
      : 'Built-in prompt in force.'
    : problems.length > 0
      ? 'Add what is missing before trying.'
      : triedNow
        ? 'Tried: ready to save.'
        : 'Run Try it with this prompt before saving.';

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={`${copy.label} full system prompt`} className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[18px] font-semibold text-ui-heading">
            {copy.label}: full system prompt
          </h2>
          <span
            className={`inline-flex h-6 items-center rounded-full px-2.5 text-chip ${
              view.activePrompt
                ? 'bg-ui-warning-bg text-ui-warning'
                : 'bg-ui-accent-tint text-ui-link'
            }`}
            data-testid="prompt-kind"
          >
            {view.activePrompt ? 'Custom prompt live' : 'Built-in prompt live'}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ui-muted">
          Replaces the built-in prompt for calls that start after you save; running calls keep
          theirs. Your instructions are still added after it.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {PROMPT_PARTS[block].map((part: PromptPartKey) => {
            const partProblems = problems.filter((problem) => problem.part === part);
            return (
              <Textarea
                key={part}
                label={PROMPT_PART_TITLES[part]}
                value={draft[part] ?? ''}
                onChange={(event) => {
                  const text = event.target.value;
                  setDraft((current) => ({ ...current, [part]: text }));
                }}
                maxLength={MAX_PROMPT_PART_CHARS}
                counter
                rows={ROWS[part]}
                spellCheck={false}
                {...(partProblems.length > 0
                  ? { error: partProblems.map((problem) => problem.message).join(' ') }
                  : {})}
                {...(part === 'reminder' ? { hint: 'May be empty.' } : {})}
                className="font-mono text-[12.5px] leading-relaxed"
              />
            );
          })}
        </div>

        {problems.length > 0 && (
          <div
            role="alert"
            className="mt-4 rounded-control border border-ui-danger bg-ui-danger-bg px-4 py-3"
            data-testid="prompt-problems"
          >
            <p className="text-[14px] font-semibold text-ui-danger">
              Cannot be tried or saved: the app needs these rules to read the AI&rsquo;s replies.
            </p>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-ui-danger">
              {problems.map((problem) => (
                <li key={`${problem.part}:${problem.message}`}>
                  <span className="font-medium">{PROMPT_PART_TITLES[problem.part]}:</span>{' '}
                  {problem.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {use?.near && (
          <p role="alert" className="mt-2 text-helper text-ui-warning" data-testid="budget-line">
            Long prompt: the largest live request would use about {Math.round(use.share * 100)}% of
            the {use.budgetTokens.toLocaleString('en-US')}-token input budget.
          </p>
        )}

        <div className="mt-4">
          <TryPanel
            block={block}
            draft={view.activeText}
            prompt={draft}
            blockedReason={problems.length > 0 ? 'Add the missing rules first.' : null}
            buttonLabel="Try with this prompt"
            onTried={(token, sent) => {
              if (token && sent) setTried({ key: promptKey(block, sent), token });
            }}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-helper text-ui-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!canSave}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(baseline);
              setError(null);
            }}
            disabled={!dirty || pending}
          >
            Discard changes
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              // Nothing custom saved: going back to the built-in text is only a discard.
              if (view.activePrompt === null) setDraft(builtIn);
              else setConfirmReset(true);
            }}
            disabled={pending || (view.activePrompt === null && !dirty)}
          >
            Reset to default
          </Button>
          <span
            className="text-[13px] text-ui-muted"
            aria-live="polite"
            data-testid="prompt-status"
          >
            {status}
          </span>
        </div>
      </section>

      <VersionHistory
        block={block}
        mode="prompt"
        versions={view.versions}
        activeId={view.activeId}
        activeText={view.activeText}
        activePrompt={view.activePrompt}
        locked={view.locked}
        restore={actions.restore}
        onToast={onToast}
      />

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Go back to the built-in prompt?"
        subtitle={copy.label}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button onClick={reset}>Reset to default</Button>
          </div>
        }
      >
        <p className="text-[14px] text-ui-text">
          Calls that start from now use the built-in prompt. The custom prompt stays in the version
          history, so you can restore it.
        </p>
      </Modal>
    </div>
  );
}
