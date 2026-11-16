/**
 * File: apps/web/src/features/admin/ai-settings/BuiltInChangeNotice.tsx
 * Purpose: Admin → AI settings' notice for a block whose custom full prompt was written against older
 *          built-in rules (ADR-0087): "Built-in rules were updated on <date> — your custom prompt doesn't
 *          include these changes", with "View changes" (a diff of the old built-in rules against today's)
 *          and "Reset to default" (after a confirmation). Shown in simple and advanced mode.
 * Used by: src/features/admin/ai-settings/AiSettingsPage.tsx
 * Depends on: React, lucide-react, src/ui (Button, Modal), ./blocks.ts, ./DiffView.tsx
 * Architecture: docs/decisions/ADR-0087-built-in-rules-change-notice.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useMemo, useState, useTransition } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { AiInstructionBlock } from '@kite/shared';
import type { ToastTone } from '@/ui/Toast';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import {
  BLOCK_COPY,
  builtInPrompt,
  promptAsText,
  type BlockView,
  type InstructionsActions,
} from './blocks';
import { DiffView } from './DiffView';

/** Month names for the notice's date (fixed, so the server and the page write the same words). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A YYYY-MM-DD day as "16 Nov 2026", with no time zone involved (it is a release day, not a moment).
 *
 * @param day The day (YYYY-MM-DD).
 * @returns The words; the input itself when it is not in that form.
 * Called from: builtInChangeText(); tests
 */
export function releaseDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return day;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * The notice's words.
 *
 * @param day The day the built-in rules changed (YYYY-MM-DD).
 * @returns For example "Built-in rules were updated on 16 Nov 2026 — your custom prompt doesn't include
 *          these changes".
 * Called from: BuiltInChangeNotice; tests
 */
export function builtInChangeText(day: string): string {
  return `Built-in rules were updated on ${releaseDay(day)} — your custom prompt doesn't include these changes`;
}

/** Props for BuiltInChangeNotice. */
export interface BuiltInChangeNoticeProps {
  /** Which block. */
  block: AiInstructionBlock;
  /** The change (BlockView.builtInChange, not null). */
  change: NonNullable<BlockView['builtInChange']>;
  /** Today's built-in parts. */
  locked: BlockView['locked'];
  /** Goes back to the built-in prompt. */
  resetPrompt: InstructionsActions['resetPrompt'];
  /** Shows the page's toast. */
  onToast: (text: string, tone?: ToastTone) => void;
}

/**
 * The notice, its "View changes" dialog and its reset confirmation.
 *
 * @param props See BuiltInChangeNoticeProps.
 * @returns The notice.
 * Rendered by: AiSettingsPage.tsx (above the block's editor, in both modes)
 */
export function BuiltInChangeNotice({
  block,
  change,
  locked,
  resetPrompt,
  onToast,
}: BuiltInChangeNoticeProps) {
  const [viewing, setViewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const label = BLOCK_COPY[block].label;
  const today = useMemo(() => promptAsText(block, builtInPrompt(locked)), [block, locked]);
  const before = change.previous ? promptAsText(block, change.previous) : null;

  /** Goes back to the built-in prompt, after the confirmation. */
  function reset() {
    setConfirming(false);
    startTransition(async () => {
      try {
        const result = await resetPrompt(block);
        if (result.ok) onToast(`${label}: back to the built-in prompt for new calls.`, 'success');
        else onToast(result.error, 'danger');
      } catch {
        onToast('Something went wrong. Please try again.', 'danger');
      }
    });
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-ui-warning bg-ui-warning-bg px-4 py-3"
      data-testid="built-in-change"
    >
      <p className="flex min-w-0 items-start gap-2 text-[14px] text-ui-text">
        <TriangleAlert
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-ui-warning"
        />
        <span>{builtInChangeText(change.date)}</span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" onClick={() => setViewing(true)}>
          View changes
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming(true)}
        >
          {pending ? 'Resetting…' : 'Reset to default'}
        </Button>
      </div>

      <Modal
        open={viewing}
        onClose={() => setViewing(false)}
        title="Changes to the built-in rules"
        subtitle={`${label} · updated on ${releaseDay(change.date)}`}
        width={760}
        // A fixed height, so the long rules scroll inside the dialog instead of being cut off (a
        // fit-content dialog is clipped at the window's height).
        height={760}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setViewing(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setViewing(false);
                setConfirming(true);
              }}
            >
              Reset to default
            </Button>
          </div>
        }
      >
        {before !== null ? (
          <DiffView
            before={before}
            after={today}
            beforeLabel="only in the built-in rules your prompt was written against"
            afterLabel="only in today's built-in rules"
            sameText="The built-in rules are the same as when your prompt was written."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-ui-muted">
              The built-in rules your prompt was written against were not recorded, so the changes
              cannot be shown. Today&rsquo;s built-in rules:
            </p>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-control border border-ui-border bg-ui-subtle p-3 font-mono text-[12px] leading-relaxed text-ui-text">
              {today}
            </pre>
          </div>
        )}
      </Modal>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Go back to the built-in prompt?"
        subtitle={label}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={reset}>Reset to default</Button>
          </div>
        }
      >
        <p className="text-[14px] text-ui-text">
          Calls that start from now use today&rsquo;s built-in prompt. Your custom prompt stays in
          the prompt history, so you can restore it.
        </p>
      </Modal>
    </div>
  );
}
