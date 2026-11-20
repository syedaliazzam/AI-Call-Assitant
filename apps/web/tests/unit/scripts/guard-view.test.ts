/**
 * Tests guardCheck() and pipeReply() in apps/web/scripts/lib/guard-view.ts (ADR-0112, the evaluation's
 * --guard check): what the user sees for a raw reply after the live route's template stop and the page's
 * silent retry. The second request is a mock here; no Claude call is made.
 */
import { describe, expect, it, vi } from 'vitest';
import { guardCheck, pipeReply } from '../../../scripts/lib/guard-view';

/** A compliant reply. */
const GOOD =
  '[[sales|call|docs]]\nOur notice period is 30 days.\n[[question|What is the notice period?]]';

describe('pipeReply', () => {
  it('passes a compliant reply as the page receives it', async () => {
    const piped = await pipeReply(GOOD);
    expect(piped.text.trim()).toBe('Our notice period is 30 days.');
    expect(piped.meta?.type).toBe('sales');
    expect(piped.templated).toBe(false);
  });

  it('stops a templated reply with nothing shown', async () => {
    const piped = await pipeReply('[[type|for|source]]\nHmm.\n[[sales|call|docs]]\nAnswer.');
    expect(piped).toMatchObject({ text: '', meta: null, templated: true });
  });
});

describe('guardCheck', () => {
  it('shows a compliant reply without a second request', async () => {
    const again = vi.fn(async () => GOOD);
    const check = await guardCheck(GOOD, again);
    expect(check).toMatchObject({ outcome: 'card', retried: false, templateVisible: false });
    expect(again).not.toHaveBeenCalled();
  });

  it('asks again after a templated first line, and shows the retry when it answers', async () => {
    const again = vi.fn(async () => GOOD);
    const check = await guardCheck('[[type|for|source]]\nThe notice is 30 days.', again);
    expect(again).toHaveBeenCalledTimes(1);
    expect(check).toMatchObject({ firstTemplated: true, retried: true, outcome: 'card' });
  });

  it('asks again after an empty reply, and shows the notice when the retry is empty too', async () => {
    const empty = '[[sales|call|docs]]\n[[question|What is the notice period?]]';
    const again = vi.fn(async () => empty);
    const check = await guardCheck(empty, again);
    expect(again).toHaveBeenCalledTimes(1);
    expect(check).toMatchObject({ firstEmpty: true, retried: true, outcome: 'notice' });
  });

  it('leaves garbled and none replies to the page (no card, no retry)', async () => {
    const again = vi.fn(async () => GOOD);
    const check = await guardCheck('[[garbled|call|call]]\n[[question|?]]', again);
    expect(check.outcome).toBe('dropped');
    expect(again).not.toHaveBeenCalled();
  });

  it('marks a card shown without its own hidden line', async () => {
    const check = await guardCheck('Our notice period is 30 days.', async () => GOOD);
    expect(check).toMatchObject({ outcome: 'card', cardWithoutMeta: true, retried: false });
  });
});
