/**
 * Tests for apps/web/src/features/shell/pageTitles.ts and initials() in UserMenu.tsx: the header's words
 * for each kind of address (spec S1), which pages fill the window, and the avatar's initials (spec S2).
 */
import { describe, expect, it } from 'vitest';
import { isCallPage, pageTitleFor } from '@/features/shell/pageTitles';
import { initials } from '@/features/shell/UserMenu';

describe('pageTitleFor', () => {
  it('uses the spec’s words for Call Sessions', () => {
    expect(pageTitleFor('/')).toEqual({
      title: 'Call Sessions',
      subtitle: 'Your upcoming calls and everything you’ve done before.',
    });
  });

  it('names pages with their own address', () => {
    expect(pageTitleFor('/resumes').title).toBe('Resumes');
    expect(pageTitleFor('/ask-kite').title).toBe('Ask AI');
    expect(pageTitleFor('/help').title).toBe('Help');
    expect(pageTitleFor('/profile').title).toBe('Profile');
  });

  it('tells a new session, an edit, a hand-off and a review apart', () => {
    expect(pageTitleFor('/sessions/new').title).toBe('Create session');
    expect(pageTitleFor('/sessions/abc/edit').title).toBe('Edit session');
    expect(pageTitleFor('/sessions/abc/desktop').title).toBe('Open in desktop app');
    expect(pageTitleFor('/sessions/abc').title).toBe('Session review');
  });

  it('covers the admin pages and every Dev Tools page', () => {
    expect(pageTitleFor('/admin/users').title).toBe('Users');
    expect(pageTitleFor('/dev').title).toBe('Dev Tools');
    expect(pageTitleFor('/dev/ui').title).toBe('Dev Tools');
    expect(pageTitleFor('/developer').title).toBe('Paramount AI');
  });
});

describe('isCallPage', () => {
  it('is true for the live screen only', () => {
    expect(isCallPage('/live/abc')).toBe(true);
    expect(isCallPage('/')).toBe(false);
    expect(isCallPage('/sessions/abc')).toBe(false);
  });
});

describe('initials', () => {
  it('takes up to two', () => {
    expect(initials('Sam Lee')).toBe('SL');
    expect(initials('  ana  ')).toBe('A');
    expect(initials('Ana Maria de la Cruz')).toBe('AM');
    expect(initials('   ')).toBe('?');
  });
});
