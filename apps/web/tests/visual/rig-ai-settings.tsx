/**
 * File: apps/web/tests/visual/rig-ai-settings.tsx
 * Purpose: The real Admin → AI settings page (ADR-0086) for the visual check, in the browser with invented
 *          data: simple mode by default, advanced mode with ?mode=advanced, dark with ?theme=dark. The
 *          built-in rules come from the server code
 *          (ai-settings-shots.ts puts them in window.__AI_SETTINGS__); the actions only answer "saved".
 * Used by: tests/visual/ai-settings-shots.ts (bundled and served there)
 * Depends on: src/features/admin/ai-settings/AiSettingsPage.tsx, react-dom
 * Architecture: docs/decisions/ADR-0086-full-system-prompt-editing.md
 *
 * Invented data only.
 */
import { createRoot } from 'react-dom/client';
import type { AiInstructionBlock } from '@kite/shared';
import { AiSettingsPage } from '@/features/admin/ai-settings/AiSettingsPage';
import type {
  BlockView,
  BudgetView,
  InstructionsActions,
  LockedView,
} from '@/features/admin/ai-settings/blocks';

/** What the shots script puts on the page. */
interface RigData {
  /** Each block's built-in parts. */
  locked: Record<AiInstructionBlock, LockedView[]>;
  /** The budget facts. */
  budget: BudgetView;
}

/** The data from ai-settings-shots.ts. */
const data = (window as unknown as { __AI_SETTINGS__: RigData }).__AI_SETTINGS__;

/** Invented version ids. */
const IDS = ['6f0c1b2a-0000-4000-8000-000000000003', '6f0c1b2a-0000-4000-8000-000000000002'];

/** The invented instructions in force for live answers. */
const LIVE_TEXT =
  'Keep answers short and warm.\nSay "customers", never "users".\nWe are Northwind Robotics (invented); support is by email on weekdays.';

/** Each block's invented state. */
const blocks: Record<AiInstructionBlock, BlockView> = {
  live: {
    activeId: IDS[0]!,
    activeText: LIVE_TEXT,
    activePrompt: null,
    versions: [
      {
        id: IDS[0]!,
        text: LIVE_TEXT,
        prompt: null,
        authorName: 'Alex Admin (invented)',
        restored: false,
        createdAt: '2026-11-16T10:05:00.000Z',
      },
      {
        id: IDS[1]!,
        text: 'Keep answers short.',
        prompt: null,
        authorName: 'Alex Admin (invented)',
        restored: false,
        createdAt: '2026-11-15T14:40:00.000Z',
      },
    ],
    locked: data.locked.live,
  },
  notes: {
    activeId: null,
    activeText: '',
    activePrompt: null,
    versions: [],
    locked: data.locked.notes,
  },
  ask: {
    activeId: null,
    activeText: '',
    activePrompt: null,
    versions: [],
    locked: data.locked.ask,
  },
};

/** ?mode=advanced and ?theme=dark. */
const params = new URLSearchParams(window.location.search);

/** Actions that only say "saved" (nothing is stored). */
const actions: InstructionsActions = {
  save: async () => ({ ok: true, created: true }),
  savePrompt: async () => ({ ok: true, created: true }),
  resetPrompt: async () => ({ ok: true, created: true }),
  restore: async () => ({ ok: true, created: true }),
};

if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-ui-bg px-6 py-8">
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-[24px] font-semibold text-ui-heading">AI settings</h1>
      <AiSettingsPage
        blocks={blocks}
        budget={data.budget}
        actions={actions}
        initialAdvanced={params.get('mode') === 'advanced'}
      />
    </div>
  </main>,
);
