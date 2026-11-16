/**
 * File: apps/web/tests/visual/rig-ai-settings.tsx
 * Purpose: The real Admin → AI settings page (ADR-0089, ADR-0091) for the visual check, in the browser
 *          with invented data and the real default prompts and app contracts (ai-settings-shots.ts puts
 *          them in window.__AI_SETTINGS__). Query: ?tab=live|notes|ask, ?mode=preview, ?history=1,
 *          ?edited=1 (an edited draft, so Save is enabled), ?theme=dark. The actions only answer "saved".
 * Used by: tests/visual/ai-settings-shots.ts (bundled and served there)
 * Depends on: src/features/admin/ai-settings/AiSettingsPage.tsx, react-dom
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * Invented data only.
 */
import { createRoot } from 'react-dom/client';
import { AI_INSTRUCTION_BLOCKS, type AiInstructionBlock } from '@kite/shared';
import { AiSettingsPage } from '@/features/admin/ai-settings/AiSettingsPage';
import type {
  BlockView,
  BudgetView,
  ContractView,
  InstructionsActions,
  VersionView,
} from '@/features/admin/ai-settings/blocks';
import type { Mode } from '@/features/admin/ai-settings/PromptWorkspace';

/** What the shots script puts on the page. */
interface RigData {
  /** Each tab's default prompt. */
  defaults: Record<AiInstructionBlock, string>;
  /** Each tab's app contract. */
  contracts: Record<AiInstructionBlock, ContractView[]>;
  /** The budget facts. */
  budget: BudgetView;
}

/** The data from ai-settings-shots.ts. */
const data = (window as unknown as { __AI_SETTINGS__: RigData }).__AI_SETTINGS__;

/** The page's query. */
const params = new URLSearchParams(window.location.search);

/** An invented company line added to each default prompt for the version in force. */
const COMPANY: Record<AiInstructionBlock, string> = {
  live: '\n\nCompany facts:\n- We are Northwind Robotics (invented); support is by email on weekdays.\n- Say "customers", never "users".',
  notes: '\n\nCompany facts:\n- Bring out every pricing question as its own next step.',
  ask: '\n\nCompany facts:\n- Follow-up emails are signed "The Northwind team" (invented).',
};

/**
 * Invented versions for a tab: 3 is live (edited), 2 a reset to the default, 1 moved from the old page.
 *
 * @param block The tab.
 * @returns The versions, newest first.
 */
function versions(block: AiInstructionBlock): VersionView[] {
  const base = data.defaults[block];
  return [
    {
      id: `6f0c1b2a-0000-4000-8000-00000000000${AI_INSTRUCTION_BLOCKS.indexOf(block)}3`,
      number: 3,
      prompt: base + COMPANY[block],
      note: 'Company facts and wording',
      authorName: 'Ana Admin (invented)',
      restored: false,
      legacy: false,
      createdAt: '2026-11-16T14:05:00.000Z',
    },
    {
      id: `6f0c1b2a-0000-4000-8000-00000000000${AI_INSTRUCTION_BLOCKS.indexOf(block)}2`,
      number: 2,
      prompt: null,
      note: null,
      authorName: 'Ben Admin (invented)',
      restored: false,
      legacy: false,
      createdAt: '2026-11-16T11:20:00.000Z',
    },
    {
      id: `6f0c1b2a-0000-4000-8000-00000000000${AI_INSTRUCTION_BLOCKS.indexOf(block)}1`,
      number: 1,
      prompt: `${base}\n\nCompany instructions:\nKeep answers short and warm.`,
      note: null,
      authorName: 'Ana Admin (invented)',
      restored: false,
      legacy: true,
      createdAt: '2026-11-15T09:40:00.000Z',
    },
  ];
}

/** Each tab's state. */
const blocks = Object.fromEntries(
  AI_INSTRUCTION_BLOCKS.map((block): [AiInstructionBlock, BlockView] => {
    const list = versions(block);
    return [
      block,
      {
        activeId: list[0]!.id,
        activePrompt: list[0]!.prompt,
        defaultPrompt: data.defaults[block],
        contract: data.contracts[block],
        versions: list,
      },
    ];
  }),
) as Record<AiInstructionBlock, BlockView>;

/** Actions that only say "saved" (nothing is stored). */
const actions: InstructionsActions = {
  save: async () => ({ ok: true, created: true }),
  reset: async () => ({ ok: true, created: true }),
  restore: async () => ({ ok: true, created: true }),
};

const tab = (params.get('tab') ?? 'live') as AiInstructionBlock;
const mode = (params.get('mode') ?? 'edit') as Mode;
const history = params.get('history') === '1';
const edited = params.get('edited') === '1';

if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-ui-bg px-6 py-8">
    <div className="mx-auto max-w-5xl">
      <AiSettingsPage
        blocks={blocks}
        budget={data.budget}
        actions={actions}
        initialTab={tab}
        initial={{
          [tab]: {
            mode,
            history,
            ...(edited
              ? {
                  draft: `${blocks[tab].activePrompt ?? ''}\n- Keep every answer to two bullet points.`,
                }
              : {}),
          },
        }}
      />
    </div>
  </main>,
);
