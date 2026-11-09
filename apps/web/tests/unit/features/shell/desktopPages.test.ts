/**
 * Tests for apps/web/src/features/shell/desktopPages.ts: a desktop app with account sync keeps only the
 * call page in its own windows (ADR-0055); every other page goes to the browser with its query and
 * fragment.
 */
import { describe, expect, it } from 'vitest';
import { browserPathFor, desktopKeepsPage } from '@/features/shell/desktopPages';

describe('desktopKeepsPage', () => {
  it('keeps the live call page', () => {
    expect(desktopKeepsPage('/live/2f1c7d1e-1111-4222-8333-444455556666')).toBe(true);
  });

  it('sends the dashboard and every other page to the browser', () => {
    for (const page of [
      '/',
      '/sessions/new',
      '/sessions/2f1c7d1e-1111-4222-8333-444455556666',
      '/sessions/2f1c7d1e-1111-4222-8333-444455556666/edit',
      '/settings',
      '/ask-kite',
      '/resumes',
      '/documents',
      '/help',
      '/admin/users',
      '/live',
    ]) {
      expect(desktopKeepsPage(page)).toBe(false);
    }
  });
});

describe('browserPathFor', () => {
  it('keeps the query and the fragment', () => {
    expect(browserPathFor('/help', '', '#zoom')).toBe('/help#zoom');
    expect(browserPathFor('/sessions/new', '?type=mock', '')).toBe('/sessions/new?type=mock');
    expect(browserPathFor('/', '', '')).toBe('/');
  });
});
