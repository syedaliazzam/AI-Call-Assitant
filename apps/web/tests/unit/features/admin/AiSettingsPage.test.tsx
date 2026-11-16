/**
 * Tests for Admin → AI settings' page (ADR-0089: src/features/admin/ai-settings/AiSettingsPage.tsx and
 * PromptWorkspace.tsx), as the server renders them:
 * - three tabs with the selected tab's description and live-version status (number, editor, time);
 * - the editor is not a bare text box: a toolbar (undo, redo, find, line numbers), a character counter;
 * - Save is disabled until this exact draft was tried, with the reason shown; a tried draft enables it;
 * - Preview renders the prompt as a document (headings, lists, quoted examples);
 * - the lint hint shows for an edited line that sets layout or preferences, not for the default text;
 * - the app contract is a folded, read-only "View app contract" with the locked text;
 * - the actions bar holds Try it, Quality check (live answers only), History, Discard, Reset and Save.
 * All data is invented.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BlockView, BudgetView } from '@/features/admin/ai-settings/blocks';

vi.mock('@/core/admin/aiTry', () => ({
  listTrySessions: vi.fn(async () => []),
  runAiTry: vi.fn(),
  runQualityCheck: vi.fn(),
}));
const { AiSettingsPage } = await import('@/features/admin/ai-settings/AiSettingsPage');
const { PromptWorkspace } = await import('@/features/admin/ai-settings/PromptWorkspace');

/** An invented default prompt. */
const DEFAULT = 'How to answer for the call:\n- Answer the question.\n  An example line.';

/**
 * An invented tab state.
 *
 * @param overrides Fields to replace.
 * @returns The view.
 */
function view(overrides: Partial<BlockView> = {}): BlockView {
  return {
    activeId: 'v2',
    activePrompt: 'How to answer for the call:\n- Say customers.',
    defaultPrompt: DEFAULT,
    contract: [{ title: 'Every live answer', text: 'App contract. [[type|for|source]]' }],
    versions: [
      {
        id: 'v2',
        number: 2,
        prompt: 'How to answer for the call:\n- Say customers.',
        note: 'Wording',
        authorName: 'Ana Admin',
        restored: false,
        legacy: false,
        createdAt: '2026-11-16T09:05:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** Invented budget facts. */
const BUDGET: BudgetView = {
  baseTokens: 60_000,
  budgetTokens: 95_000,
  charsPerToken: 3,
  headingChars: 150,
};

/** Actions that are never called by a server render. */
const ACTIONS = { save: vi.fn(), reset: vi.fn(), restore: vi.fn() };

/**
 * Renders one workspace.
 *
 * @param initial Its starting state.
 * @param block   The tab.
 * @returns The HTML.
 */
function workspace(
  initial: Parameters<typeof PromptWorkspace>[0]['initial'] = {},
  block: 'live' | 'notes' = 'live',
): string {
  return renderToString(
    <PromptWorkspace
      block={block}
      view={view()}
      budget={block === 'live' ? BUDGET : null}
      actions={ACTIONS}
      onToast={() => undefined}
      onDirtyChange={() => undefined}
      initial={initial}
    />,
  );
}

describe('AiSettingsPage', () => {
  const html = renderToString(
    <AiSettingsPage
      blocks={{
        live: view(),
        notes: view({ activeId: null, activePrompt: null, versions: [] }),
        ask: view(),
      }}
      budget={BUDGET}
      actions={ACTIONS}
    />,
  );

  it('shows the three tabs, the description and the live version status', () => {
    for (const label of ['Live answers', 'AI notes', 'Ask AI']) expect(html).toContain(label);
    expect(html).toContain('Used during calls');
    expect(html).toContain('Live version: <!-- -->2');
    expect(html).toContain('Ana Admin');
  });
});

describe('PromptWorkspace', () => {
  it('is a writing editor with a toolbar and a counter, not a bare text box', () => {
    const html = workspace();
    for (const name of ['Undo', 'Redo', 'Find', 'Line numbers']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).toMatch(/characters/);
    expect(html).toContain('font-sans');
  });

  it('keeps Save disabled until this exact draft was tried, and says why', () => {
    const untried = workspace({ draft: 'How to answer for the call:\n- Say customers, always.' });
    expect(untried).toMatch(/<button(?=[^>]*disabled="")[^>]*>Save<\/button>/);
    expect(untried).toContain(
      'Save unlocks after Try it or Quality check runs on this exact draft.',
    );
    expect(untried).toContain('Unsaved changes');
    const tried = workspace({
      draft: 'How to answer for the call:\n- Say customers, always.',
      tried: true,
    });
    expect(tried).not.toMatch(/<button(?=[^>]*disabled="")[^>]*>Save<\/button>/);
    expect(tried).toContain('Tried');
  });

  it('renders the prompt as a document in Preview', () => {
    const html = workspace({ mode: 'preview', draft: DEFAULT });
    expect(html).toMatch(/<h3[^>]*>.*How to answer for the call/);
    expect(html).toContain('<li');
    expect(html).toContain('<blockquote');
  });

  it('shows the lint hint for an edited layout line only', () => {
    expect(workspace({ draft: DEFAULT })).not.toContain('Structure and personal preferences');
    const hinted = workspace({ draft: `${DEFAULT}\n- Use five bullet points with a headline.` });
    expect(hinted).toContain('Structure and personal preferences are set elsewhere');
    expect(hinted).toContain('Line 4 (headline, bullet)');
  });

  it('folds the read-only app contract behind "View app contract"', () => {
    const html = workspace();
    expect(html).toMatch(/<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('View app contract');
    expect(html).toContain('[[type|for|source]]');
  });

  it('offers Quality check for live answers only', () => {
    expect(workspace()).toContain('Quality check');
    expect(workspace({}, 'notes')).not.toContain('Quality check');
    for (const label of ['Try it', 'History', 'Discard', 'Reset to default', 'Save']) {
      expect(workspace({}, 'notes')).toContain(label);
    }
  });
});

describe('foldUnchanged (the comparison)', () => {
  it('folds long unchanged runs and keeps three lines next to each change', async () => {
    const { foldUnchanged } = await import('@/features/admin/ai-settings/SideBySideDiff');
    const { diffLines } = await import('@/core/admin/textDiff');
    const before = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    const rows = diffLines(before, `${before}\nNew line`);
    const items = foldUnchanged(rows, new Set());
    expect(items[0]).toEqual({ kind: 'fold', from: 0, count: 17 });
    expect(items.filter((item) => item.kind === 'row')).toHaveLength(4);
    expect(foldUnchanged(rows, new Set([0]))).toHaveLength(21);
  });
});
