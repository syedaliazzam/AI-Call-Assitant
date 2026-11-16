/**
 * File: apps/web/app/(app)/admin/ai-settings/page.tsx
 * Purpose: The /admin/ai-settings route (ADR-0083): the company AI instructions for live answers, AI
 *          notes and Ask AI, with each block's built-in rules, "Try it" and version history, and
 *          (ADR-0086) each block's full system prompt for advanced mode. Kept thin: loads the data
 *          (admins only) and passes it, with the server actions, to the feature UI.
 * Used by: Next.js App Router (admins only, see ../layout.tsx)
 * Depends on: src/server/guard.ts, src/server/aiInstructions.ts, src/server/aiTry.ts, src/server/db.ts,
 *             src/features/admin/ai-settings/AiSettingsPage.tsx, ./actions.ts, src/ui/PageShell.tsx
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 */
import { AI_INSTRUCTION_BLOCKS, type AiInstructionBlock } from '@kite/shared';
import { AiSettingsPage } from '@/features/admin/ai-settings/AiSettingsPage';
import type { BlockView } from '@/features/admin/ai-settings/blocks';
import { loadAiInstructions, type InstructionsDb } from '@/server/aiInstructions';
import { budgetFacts, lockedRulesFor } from '@/server/aiTry';
import { db } from '@/server/db';
import { requireAdmin } from '@/server/guard';
import { PageShell } from '@/ui/PageShell';
import {
  resetPromptAction,
  restoreInstructionsAction,
  saveInstructionsAction,
  savePromptAction,
} from './actions';

/** Next.js route setting: always show the versions in force now, never a cached page. */
export const dynamic = 'force-dynamic';

/**
 * Admin AI settings page.
 *
 * @returns The three blocks' editors.
 */
export default async function AdminAiSettingsPage() {
  // The layout already checked; cached per request. loadAiInstructions() checks the role again.
  const session = await requireAdmin();
  const loaded = await loadAiInstructions(db as unknown as InstructionsDb, session.user);
  const blocks = {} as Record<AiInstructionBlock, BlockView>;
  for (const block of AI_INSTRUCTION_BLOCKS) {
    const state = loaded[block];
    blocks[block] = {
      activeId: state.activeId,
      activeText: state.activeText,
      activePrompt: state.activePrompt,
      builtInChange: state.builtInChange,
      versions: state.versions.map((version) => ({
        id: version.id,
        text: version.text,
        prompt: version.prompt,
        authorName: version.authorName,
        restored: version.restoredFrom !== null,
        createdAt: version.createdAt,
      })),
      locked: lockedRulesFor(block),
    };
  }
  return (
    <PageShell title="AI settings" width="lg">
      <AiSettingsPage
        blocks={blocks}
        budget={budgetFacts()}
        actions={{
          save: saveInstructionsAction,
          savePrompt: savePromptAction,
          resetPrompt: resetPromptAction,
          restore: restoreInstructionsAction,
        }}
      />
    </PageShell>
  );
}
