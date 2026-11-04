/**
 * File: apps/web/src/features/shell/pageTitles.ts
 * Purpose: The title and line of explanation the app header shows for each signed-in page (spec S1).
 * Used by: src/features/shell/AppHeader.tsx
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1)
 */

/** What the header says about a page. */
export interface PageTitle {
  /** The page's name. */
  title: string;
  /** One line about it. */
  subtitle: string;
}

/** The sessions page's words. */
const CALL_SESSIONS: PageTitle = {
  title: 'Call Sessions',
  subtitle: 'Your upcoming calls and everything you’ve done before.',
};

/** Pages with their own address. */
const EXACT: Readonly<Record<string, PageTitle>> = {
  '/': CALL_SESSIONS,
  // The wizard is a modal over the sessions page.
  '/sessions/new': CALL_SESSIONS,
  '/resumes': { title: 'Resumes', subtitle: 'Your resumes, ready to attach to a session.' },
  '/documents': { title: 'Documents', subtitle: 'Reference files the AI can use in your calls.' },
  '/ask-kite': { title: 'Ask AI', subtitle: 'Ask anything, outside a call.' },
  '/mock': { title: 'Mock Interview', subtitle: 'Practise out loud before the real call.' },
  '/question-bank': { title: 'Question bank', subtitle: 'Likely questions for a session.' },
  '/settings': { title: 'Settings', subtitle: 'Saved on this computer only.' },
  '/admin/users': { title: 'Users', subtitle: 'Create and manage accounts.' },
  '/admin/usage': { title: 'Usage', subtitle: 'Requests per person, per day.' },
  '/help': { title: 'Help', subtitle: 'How to use the app, from setup to review.' },
  '/profile': { title: 'Profile', subtitle: 'Your account.' },
};

/** Pages whose address has a part that changes, tested in order. */
const PATTERNS: readonly (readonly [RegExp, PageTitle])[] = [
  [/^\/sessions\/[^/]+\/edit$/, CALL_SESSIONS],
  [
    /^\/sessions\/[^/]+\/desktop$/,
    { title: 'Open in desktop app', subtitle: 'Move this session to the desktop app.' },
  ],
  [/^\/sessions\/[^/]+$/, { title: 'Session review', subtitle: 'Notes, answers and transcript.' }],
  [/^\/dev(?:\/|$)/, { title: 'Dev Tools', subtitle: 'For admins.' }],
];

/**
 * What the header says about a page.
 *
 * @param pathname The page's path.
 * @returns Its title and line, or the dashboard's words for an address not listed.
 * Called from: AppHeader.tsx; tests
 */
export function pageTitleFor(pathname: string): PageTitle {
  const exact = EXACT[pathname];
  if (exact) return exact;
  const match = PATTERNS.find(([pattern]) => pattern.test(pathname));
  return match?.[1] ?? { title: 'Paramount AI', subtitle: '' };
}

/**
 * Whether a page runs a call and fills the window: the header would take room from it.
 *
 * @param pathname The page's path.
 * @returns True for the live screen.
 * Called from: AppShell.tsx; tests
 */
export function isCallPage(pathname: string): boolean {
  return pathname.startsWith('/live/');
}
