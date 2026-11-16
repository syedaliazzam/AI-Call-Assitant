/**
 * File: apps/web/src/features/admin/ai-settings/AiSettingsPage.tsx
 * Purpose: Admin → AI settings (ADR-0089): three tabs (Live answers, AI notes, Ask AI), each with ONE
 *          global system prompt for every user. Under the tabs: where the selected prompt is used, and its
 *          live version with who last edited it and when. Each tab's workspace stays mounted (hidden when
 *          not shown), so switching tabs keeps a draft; leaving the page with unsaved changes asks first.
 *          One toast for the page.
 * Used by: app/(app)/admin/ai-settings/page.tsx
 * Depends on: React, src/ui/Tabs.tsx, src/ui/Toast.tsx, ./PromptWorkspace.tsx, ./useLeaveWarning.ts,
 *             ./blocks.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 * Theme: tokens from src/ui/tokens/theme.css (light and dark)
 */
'use client';

import { useCallback, useState } from 'react';
import { AI_INSTRUCTION_BLOCKS, type AiInstructionBlock } from '@kite/shared';
import { Tabs } from '@/ui/Tabs';
import { Toast, useToast } from '@/ui/Toast';
import {
  BLOCK_COPY,
  formatWhen,
  type BlockView,
  type BudgetView,
  type InstructionsActions,
} from './blocks';
import { PromptWorkspace, type PromptWorkspaceProps } from './PromptWorkspace';
import { useLeaveWarning } from './useLeaveWarning';

/** Props for AiSettingsPage. */
export interface AiSettingsPageProps {
  /** Each tab's state, default prompt, contract and history. */
  blocks: Readonly<Record<AiInstructionBlock, BlockView>>;
  /** The live answers budget facts. */
  budget: BudgetView;
  /** The server actions (app/(app)/admin/ai-settings/actions.ts). */
  actions: InstructionsActions;
  /** The visual rig: the tab to start on and each workspace's starting state. */
  initialTab?: AiInstructionBlock;
  /** The visual rig: starting state per tab. */
  initial?: Partial<Record<AiInstructionBlock, PromptWorkspaceProps['initial']>>;
}

/** The tabs, in order. */
const TABS = AI_INSTRUCTION_BLOCKS.map((block) => ({
  value: block,
  label: BLOCK_COPY[block].label,
}));

/**
 * The status line of a tab: its live version, and who last edited it and when.
 *
 * @param props.view The tab's state.
 * @returns The line.
 * Rendered by: AiSettingsPage
 */
function LiveStatus({ view }: { /** The tab's state. */ view: BlockView }) {
  const active = view.versions.find((version) => version.id === view.activeId);
  if (!active) {
    return <span>Live version: default prompt · never edited</span>;
  }
  return (
    <span>
      Live version: {active.number}
      {active.prompt === null ? ' (default prompt)' : ''} · last edited by{' '}
      {active.authorName ?? 'a deleted account'}, {formatWhen(active.createdAt)}
    </span>
  );
}

/**
 * The AI settings page.
 *
 * @param props See AiSettingsPageProps.
 * @returns The tabs, the selected tab's description and status, the workspaces and the toast.
 * Rendered by: app/(app)/admin/ai-settings/page.tsx
 */
export function AiSettingsPage({
  blocks,
  budget,
  actions,
  initialTab = 'live',
  initial,
}: AiSettingsPageProps) {
  const [tab, setTab] = useState<AiInstructionBlock>(initialTab);
  const [dirty, setDirty] = useState<ReadonlySet<AiInstructionBlock>>(new Set());
  const toast = useToast();
  useLeaveWarning(dirty.size > 0);

  const onDirtyChange = useCallback((block: AiInstructionBlock, isDirty: boolean) => {
    setDirty((current) => {
      if (current.has(block) === isDirty) return current;
      const next = new Set(current);
      if (isDirty) next.add(block);
      else next.delete(block);
      return next;
    });
  }, []);

  const copy = BLOCK_COPY[tab];
  return (
    <section aria-label="AI settings" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-card-title text-ui-heading">AI settings</h2>
        <p className="text-[14px] text-ui-muted">
          One prompt per tab for every user&apos;s new calls. The app contract always comes first,
          and each user&apos;s own AI preferences win where they differ.
        </p>
      </div>
      <Tabs
        label="AI settings tabs"
        options={TABS.map((option) => ({
          ...option,
          label: dirty.has(option.value) ? `${option.label} •` : option.label,
        }))}
        value={tab}
        onChange={setTab}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-ui-muted">
        <span>
          <span className="font-medium text-ui-heading">{copy.description}</span> · {copy.model}
        </span>
        <LiveStatus view={blocks[tab]} />
      </div>
      {AI_INSTRUCTION_BLOCKS.map((block) => (
        <div key={block} hidden={block !== tab}>
          <PromptWorkspace
            block={block}
            view={blocks[block]}
            budget={block === 'live' ? budget : null}
            actions={actions}
            onToast={toast.show}
            onDirtyChange={onDirtyChange}
            {...(initial?.[block] ? { initial: initial[block] } : {})}
          />
        </div>
      ))}
      <Toast message={toast.current} />
    </section>
  );
}
