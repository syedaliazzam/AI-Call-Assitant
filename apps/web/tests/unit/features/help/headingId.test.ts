/**
 * Tests for apps/web/src/features/help/HelpPage.tsx (headingId) and the user guide: the Connect card's
 * tips link to /help#zoom and /help#private, so the guide has those two headings (ADR-0055).
 */
import { describe, expect, it } from 'vitest';
import { markdownBlocks } from '@/core/answer/markdown';
import { headingId } from '@/features/help/HelpPage';
import { USER_GUIDE_MD } from '@/features/help/guideText';

describe('headingId', () => {
  it('turns words into an address', () => {
    expect(headingId('Private')).toBe('private');
    expect(headingId('Zoom')).toBe('zoom');
    expect(headingId('Between calls: the home panel (desktop app)')).toBe(
      'between-calls-the-home-panel-desktop-app',
    );
  });
});

describe('the user guide', () => {
  it('has the sections the Connect card links to', () => {
    const ids = markdownBlocks(USER_GUIDE_MD)
      .filter((block) => block.kind === 'heading')
      .map((block) => headingId(block.text));
    expect(ids).toContain('private');
    expect(ids).toContain('zoom');
  });

  it('says how to turn on window filtering in Zoom, and how to test with a phone', () => {
    expect(USER_GUIDE_MD).toContain('Advanced capture with window filtering');
    expect(USER_GUIDE_MD).toContain('Test it with your phone before a real call');
  });
});
