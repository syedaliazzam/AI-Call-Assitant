/**
 * File: apps/web/src/features/admin/ai-settings/ContractView.tsx
 * Purpose: Admin → AI settings' read-only "View app contract" for one tab (ADR-0089), folded by default:
 *          the part of the system prompt the app owns (the hidden lines and fields it reads), always sent
 *          first, before the global prompt, and not editable.
 * Used by: src/features/admin/ai-settings/PromptWorkspace.tsx
 * Depends on: React, lucide-react, ./PromptPreview.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { Lock } from 'lucide-react';
import type { ContractView as ContractPart } from './blocks';
import { PromptPreview } from './PromptPreview';

/** Props for ContractView. */
export interface ContractViewProps {
  /** The tab's contract, in prompt order. */
  parts: readonly ContractPart[];
}

/**
 * The folded contract.
 *
 * @param props See ContractViewProps.
 * @returns A details element.
 * Rendered by: PromptWorkspace.tsx
 */
export function ContractView({ parts }: ContractViewProps) {
  return (
    <details className="group rounded-control border border-ui-border bg-ui-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] font-medium text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [&::-webkit-details-marker]:hidden">
        <Lock aria-hidden="true" size={14} className="text-ui-muted" />
        View app contract
        <span className="font-normal text-ui-muted">
          · locked, always sent first, overrides everything else
        </span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-ui-border px-4 py-4">
        <p className="text-[13px] text-ui-muted">
          The app reads these lines to show answers, so they cannot be edited. Your prompt comes
          after them, then each user&apos;s own preferences, which win over your prompt on format,
          length, tone, language and focus.
        </p>
        {parts.map((part) => (
          <section key={part.title} aria-label={part.title}>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ui-muted">
              {part.title}
            </h3>
            <div className="rounded-control bg-ui-subtle px-4 py-3">
              <PromptPreview text={part.text} />
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
