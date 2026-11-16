/**
 * Tests for apps/web/src/features/admin/ai-settings/BuiltInChangeNotice.tsx (ADR-0087): the notice says
 * "Built-in rules were updated on <date> — your custom prompt doesn't include these changes" with the
 * release day written as "16 Nov 2026" (no time zone can move it), and offers "View changes" and "Reset
 * to default"; the AI settings page shows it only for a block whose custom prompt predates the built-in
 * rules, in simple and in advanced mode.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiSettingsPage } from '@/features/admin/ai-settings/AiSettingsPage';
import {
  BuiltInChangeNotice,
  builtInChangeText,
  releaseDay,
} from '@/features/admin/ai-settings/BuiltInChangeNotice';
import type { BlockView, InstructionsActions } from '@/features/admin/ai-settings/blocks';

/** Invented built-in parts. */
const LOCKED: BlockView['locked'] = [
  { key: 'core', title: 'Rules for every live answer', text: 'Rules today.' },
  { key: 'reminder', title: 'Reminder added after the question', text: 'Reminder.' },
  { key: 'screenshot', title: 'Added for a screenshot', text: 'Screenshot.' },
];

/** Actions that do nothing. */
const ACTIONS: InstructionsActions = {
  save: async () => ({ ok: true, created: true }),
  savePrompt: async () => ({ ok: true, created: true }),
  resetPrompt: async () => ({ ok: true, created: true }),
  restore: async () => ({ ok: true, created: true }),
};

/**
 * A block's view.
 *
 * @param change The built-in change, or null.
 * @returns The view.
 */
function view(change: BlockView['builtInChange']): BlockView {
  return {
    activeId: null,
    activeText: '',
    activePrompt: change ? { core: 'Custom.', reminder: '', screenshot: 'S.' } : null,
    builtInChange: change,
    versions: [],
    locked: LOCKED,
  };
}

/** Invented budget facts. */
const BUDGET = {
  baseTokens: 1,
  budgetTokens: 100,
  charsPerToken: 3,
  overheadChars: 1,
  builtInPromptChars: 1,
};

describe('BuiltInChangeNotice', () => {
  it('writes the release day as a date, whatever the time zone', () => {
    expect(releaseDay('2026-11-16')).toBe('16 Nov 2026');
    expect(releaseDay('2027-01-05')).toBe('5 Jan 2027');
    expect(releaseDay('not a day')).toBe('not a day');
  });

  it('says what changed and offers the two actions', () => {
    expect(builtInChangeText('2026-12-01')).toBe(
      "Built-in rules were updated on 1 Dec 2026 — your custom prompt doesn't include these changes",
    );
    const html = renderToString(
      <BuiltInChangeNotice
        block="live"
        change={{ date: '2026-12-01', previous: { core: 'Rules before.' } }}
        locked={LOCKED}
        resetPrompt={ACTIONS.resetPrompt}
        onToast={() => undefined}
      />,
    );
    expect(html).toContain('Built-in rules were updated on 1 Dec 2026');
    expect(html).toContain('View changes');
    expect(html).toContain('Reset to default');
  });

  it('shows on the page only for a block whose custom prompt predates the rules, in both modes', () => {
    const change = { date: '2026-12-01', previous: null };
    for (const initialAdvanced of [false, true]) {
      const html = renderToString(
        <AiSettingsPage
          blocks={{ live: view(change), notes: view(null), ask: view(null) }}
          budget={BUDGET}
          actions={ACTIONS}
          initialAdvanced={initialAdvanced}
        />,
      );
      expect(html.match(/data-testid="built-in-change"/g)).toHaveLength(1);
    }
    const none = renderToString(
      <AiSettingsPage
        blocks={{ live: view(null), notes: view(null), ask: view(null) }}
        budget={BUDGET}
        actions={ACTIONS}
      />,
    );
    expect(none).not.toContain('built-in-change');
  });
});
