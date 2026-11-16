/**
 * File: apps/web/app/(app)/admin/ai-settings/page.tsx
 * Purpose: The /admin/ai-settings route (ADR-0083, redesigned in ADR-0089): one global prompt per tab
 *          (live answers, AI notes, Ask AI) with its default prompt, its read-only app contract and its
 *          version history. Kept thin: loads the data (admins only) and passes it, with the server
 *          actions, to the feature UI.
 * Used by: Next.js App Router (admins only, see ../layout.tsx)
 * Depends on: src/server/guard.ts, src/server/aiInstructions.ts, src/server/aiBudget.ts (budgetFacts),
 *             src/server/prompts/contract.ts, src/server/prompts/defaults.ts, src/server/db.ts,
 *             src/features/admin/ai-settings/AiSettingsPage.tsx, ./actions.ts, src/ui/PageShell.tsx
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 */
import { AI_INSTRUCTION_BLOCKS, type AiInstructionBlock } from '@kite/shared';
import { AiSettingsPage } from '@/features/admin/ai-settings/AiSettingsPage';
import type { BlockView } from '@/features/admin/ai-settings/blocks';
import { loadAiInstructions, type InstructionsDb } from '@/server/aiInstructions';
import { budgetFacts } from '@/server/aiBudget';
import { db } from '@/server/db';
import { requireAdmin } from '@/server/guard';
import { contractFor } from '@/server/prompts/contract';
import { DEFAULT_PROMPTS } from '@/server/prompts/defaults';
import { PageShell } from '@/ui/PageShell';
import { resetPromptAction, restoreVersionAction, savePromptAction } from './actions';

/** Next.js route setting: always show the versions in force now, never a cached page. */
export const dynamic = 'force-dynamic';

/**
 * Admin AI settings page.
 *
 * @returns The three tabs.
 */
export default async function AdminAiSettingsPage() {
  // The layout already checked; cached per request. loadAiInstructions() checks the role again.
  const session = await requireAdmin();
  const loaded = await loadAiInstructions(db as unknown as InstructionsDb, session.user);
  const blocks = {} as Record<AiInstructionBlock, BlockView>;
  for (const block of AI_INSTRUCTION_BLOCKS) {
    const state = loaded[block];
    // Numbered from the oldest: the newest is number `total` (the list holds at most the last 50).
    const total = state.total;
    blocks[block] = {
      activeId: state.activeId,
      activePrompt: state.activePrompt,
      defaultPrompt: DEFAULT_PROMPTS[block],
      contract: contractFor(block),
      versions: state.versions.map((version, index) => ({
        id: version.id,
        number: total - index,
        prompt: version.globalPrompt,
        note: version.note,
        authorName: version.authorName,
        restored: version.restoredFrom !== null,
        legacy: version.legacy,
        createdAt: version.createdAt,
      })),
    };
  }
  return (
    <PageShell title="AI settings" width="lg">
      <AiSettingsPage
        blocks={blocks}
        budget={budgetFacts()}
        actions={{
          save: savePromptAction,
          reset: resetPromptAction,
          restore: restoreVersionAction,
        }}
      />
    </PageShell>
  );
}
