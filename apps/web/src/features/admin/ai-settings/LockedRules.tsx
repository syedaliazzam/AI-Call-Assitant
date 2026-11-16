/**
 * File: apps/web/src/features/admin/ai-settings/LockedRules.tsx
 * Purpose: Admin → AI settings' read-only view of a block's built-in rules (ADR-0083), behind a small
 *          "View built-in rules" link, folded by default (ADR-0086): the exact text that comes first in
 *          the prompt (the answer format the app reads, honesty, privacy and safety rules). In simple
 *          mode instructions are added after it; "Edit full system prompt" edits it.
 * Used by: src/features/admin/ai-settings/InstructionsEditor.tsx
 * Depends on: React, lucide-react, ./blocks.ts (LockedView)
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { ChevronRight } from 'lucide-react';
import type { LockedView } from './blocks';

/** Props for LockedRules. */
export interface LockedRulesProps {
  /** The built-in parts, in prompt order. */
  parts: readonly LockedView[];
  /** True when a custom full prompt replaces these rules for new calls. */
  replaced: boolean;
}

/**
 * The built-in rules, folded behind a link.
 *
 * @param props See LockedRulesProps.
 * @returns The folded section.
 * Rendered by: InstructionsEditor.tsx
 */
export function LockedRules({ parts, replaced }: LockedRulesProps) {
  return (
    <details className="group" data-testid="built-in-rules">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ui-link [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          size={14}
          strokeWidth={1.75}
          className="transition-transform group-open:rotate-90"
        />
        View built-in rules
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-[13px] text-ui-muted">
          {replaced
            ? 'A custom full prompt replaces these rules for new calls (Edit full system prompt).'
            : 'Always first in the prompt; your instructions come after them.'}
        </p>
        {parts.map((part) => (
          <div key={part.key} className="rounded-control border border-ui-border">
            <p className="px-3 py-2 text-[13px] font-medium text-ui-heading">{part.title}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-ui-border bg-ui-subtle px-3 py-2 font-mono text-[12px] leading-relaxed text-ui-text">
              {part.text}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
