/**
 * File: apps/web/src/features/admin/ai-settings/AiSettingsPage.tsx
 * Purpose: Admin → AI settings: a tab per block (Live answers, AI notes, Ask AI). Simple mode (default,
 *          ADR-0083 simplified in ADR-0086) shows each block's instructions box with Try it and Save;
 *          the "Edit full system prompt" switch shows advanced mode, the block's whole system prompt in
 *          an editor (ADR-0086). Every editor stays mounted (hidden when not shown), so switching tabs or
 *          modes keeps a draft. One toast for the page. ADR-0087: a block whose custom prompt predates
 *          the built-in rules shows the built-in change notice above its editor, in both modes.
 * Used by: app/(app)/admin/ai-settings/page.tsx
 * Depends on: React, src/ui/Tabs.tsx, src/ui/Toggle.tsx (Switch), src/ui/Toast.tsx,
 *             ./InstructionsEditor.tsx, ./PromptEditor.tsx, ./BuiltInChangeNotice.tsx, ./blocks.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md,
 *               docs/decisions/ADR-0086-full-system-prompt-editing.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useId, useState } from 'react';
import { AI_INSTRUCTION_BLOCKS, type AiInstructionBlock } from '@kite/shared';
import { Tabs } from '@/ui/Tabs';
import { Toast, useToast } from '@/ui/Toast';
import { Switch } from '@/ui/Toggle';
import { BLOCK_COPY, type BlockView, type BudgetView, type InstructionsActions } from './blocks';
import { BuiltInChangeNotice } from './BuiltInChangeNotice';
import { InstructionsEditor } from './InstructionsEditor';
import { PromptEditor } from './PromptEditor';

/** Props for AiSettingsPage. */
export interface AiSettingsPageProps {
  /** Each block's state, built-in prompt and history. */
  blocks: Readonly<Record<AiInstructionBlock, BlockView>>;
  /** The live block's budget facts. */
  budget: BudgetView;
  /** The server actions (app/(app)/admin/ai-settings/actions.ts). */
  actions: InstructionsActions;
  /** Start in advanced mode (the visual rig; the page itself starts in simple mode). */
  initialAdvanced?: boolean;
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
 * @returns The tabs, the mode switch, the editors and the toast.
 * Rendered by: app/(app)/admin/ai-settings/page.tsx
 */
export function AiSettingsPage({
  blocks,
  budget,
  actions,
  initialAdvanced = false,
}: AiSettingsPageProps) {
  const [tab, setTab] = useState<AiInstructionBlock>('live');
  const [advanced, setAdvanced] = useState(initialAdvanced);
  const toast = useToast();
  const switchLabel = useId();
  return (
    <section aria-label="AI settings" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Instruction blocks" options={TABS} value={tab} onChange={setTab} />
        <label className="inline-flex cursor-pointer items-center gap-2 text-[14px] text-ui-text">
          <Switch checked={advanced} onChange={setAdvanced} labelledBy={switchLabel} />
          <span id={switchLabel}>Edit full system prompt</span>
        </label>
      </div>
      {AI_INSTRUCTION_BLOCKS.map((block) => (
        <div key={block} hidden={block !== tab}>
          {blocks[block].builtInChange && (
            <BuiltInChangeNotice
              block={block}
              change={blocks[block].builtInChange}
              locked={blocks[block].locked}
              resetPrompt={actions.resetPrompt}
              onToast={toast.show}
            />
          )}
          <div hidden={advanced}>
            <InstructionsEditor
              block={block}
              view={blocks[block]}
              budget={block === 'live' ? budget : null}
              actions={actions}
              onToast={toast.show}
            />
          </div>
          <div hidden={!advanced}>
            <PromptEditor
              block={block}
              view={blocks[block]}
              budget={block === 'live' ? budget : null}
              actions={actions}
              onToast={toast.show}
            />
          </div>
        </div>
      ))}
      <Toast message={toast.current} />
    </section>
  );
}
