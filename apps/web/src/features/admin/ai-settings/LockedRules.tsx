/**
 * File: apps/web/src/features/admin/ai-settings/LockedRules.tsx
 * Purpose: Admin → AI settings' read-only view of a block's locked rules (ADR-0083): the exact text
 *          that always comes first in the prompt and that company instructions cannot change (the
 *          answer format the app reads, honesty, privacy and safety rules). Folded by default.
 * Used by: src/features/admin/ai-settings/InstructionsEditor.tsx
 * Depends on: React, lucide-react, ./blocks.ts (LockedView, CARD)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { Lock } from 'lucide-react';
import { CARD, type LockedView } from './blocks';

/** Props for LockedRules. */
export interface LockedRulesProps {
  /** The locked parts, in prompt order. */
  parts: readonly LockedView[];
}

/**
 * The locked rules, read-only.
 *
 * @param props See LockedRulesProps.
 * @returns The card.
 * Rendered by: InstructionsEditor.tsx
 */
export function LockedRules({ parts }: LockedRulesProps) {
  return (
    <section aria-label="Locked rules" className={CARD}>
      <div className="flex items-center gap-2">
        <Lock aria-hidden="true" size={16} strokeWidth={1.75} className="text-ui-muted" />
        <h2 className="text-[18px] font-semibold text-ui-heading">Locked rules</h2>
      </div>
      <p className="mt-1 max-w-prose text-[13px] text-ui-muted">
        Always first in the prompt and not editable: the answer format the app reads, honesty
        (claims about the user only from the CV and documents), privacy and safety. Company
        instructions come after them, then the session&rsquo;s own instructions.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {parts.map((part) => (
          <details key={part.title} className="rounded-control border border-ui-border">
            <summary className="cursor-pointer px-3 py-2 text-[14px] font-medium text-ui-heading">
              {part.title}
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-ui-border bg-ui-subtle px-3 py-2 font-mono text-[12px] leading-relaxed text-ui-text">
              {part.text}
            </pre>
          </details>
        ))}
      </div>
    </section>
  );
}
