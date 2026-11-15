/**
 * File: apps/web/src/features/admin/ai-settings/AiSettingsPage.tsx
 * Purpose: Admin → AI settings (ADR-0083): a tab per editable block (Live answers, AI notes, Ask AI),
 *          each with its editor, "Try it", locked rules and version history, and one toast for the page.
 *          All three editors stay mounted (hidden when not shown), so switching tabs keeps a draft.
 * Used by: app/(app)/admin/ai-settings/page.tsx
 * Depends on: React, src/ui/Tabs.tsx, src/ui/Toast.tsx, ./InstructionsEditor.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useState } from 'react';
import { AI_INSTRUCTION_BLOCKS, type AiInstructionBlock } from '@kite/shared';
import { Tabs } from '@/ui/Tabs';
import { Toast, useToast } from '@/ui/Toast';
import { BLOCK_COPY, type BlockView, type BudgetView, type InstructionsActions } from './blocks';
import { InstructionsEditor } from './InstructionsEditor';

/** Props for AiSettingsPage. */
export interface AiSettingsPageProps {
  /** Each block's state, locked rules and history. */
  blocks: Readonly<Record<AiInstructionBlock, BlockView>>;
  /** The live block's budget facts. */
  budget: BudgetView;
  /** The server actions (app/(app)/admin/ai-settings/actions.ts). */
  actions: InstructionsActions;
}

/** The tabs, in block order. */
const TABS = AI_INSTRUCTION_BLOCKS.map((block) => ({
  value: block,
  label: BLOCK_COPY[block].label,
}));

/**
 * The AI settings page.
 *
 * @param props See AiSettingsPageProps.
 * @returns The tabs, the three editors and the toast.
 * Rendered by: app/(app)/admin/ai-settings/page.tsx
 */
export function AiSettingsPage({ blocks, budget, actions }: AiSettingsPageProps) {
  const [tab, setTab] = useState<AiInstructionBlock>('live');
  const toast = useToast();
  return (
    <section aria-label="AI settings" className="flex flex-col gap-4">
      <p className="max-w-prose text-[14px] text-ui-muted">
        Company instructions change how the AI answers, without code or a release. Saving makes them
        the live version for calls that start after it; a call already running keeps the version it
        started with. An empty block means no company instructions.
      </p>
      <Tabs label="Instruction blocks" options={TABS} value={tab} onChange={setTab} />
      {AI_INSTRUCTION_BLOCKS.map((block) => (
        <div key={block} hidden={block !== tab}>
          <InstructionsEditor
            block={block}
            view={blocks[block]}
            budget={block === 'live' ? budget : null}
            actions={actions}
            onToast={toast.show}
          />
        </div>
      ))}
      <Toast message={toast.current} />
    </section>
  );
}
