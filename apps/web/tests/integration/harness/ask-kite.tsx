/**
 * File: apps/web/tests/integration/harness/ask-kite.tsx
 * Purpose: Test page for the Ask Kite harness test: the real AskKitePage with its real storage, on
 *          an invented library and session. All text is invented.
 * Used by: tests/integration/ask-kite.spec.ts
 * Depends on: src/features/ask-kite/AskKitePage.tsx, src/core/storage
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */
import { createRoot } from 'react-dom/client';
import { addLibraryItem } from '@/core/storage/library';
import { createSession, listSessions } from '@/core/storage/sessions';
import { AskKitePage } from '@/features/ask-kite/AskKitePage';
import '@/ui/tokens/theme.css';

/**
 * Adds the invented items once, then shows the page.
 *
 * @returns Resolves when the page is shown.
 */
async function start(): Promise<void> {
  if ((await listSessions()).length === 0) {
    await addLibraryItem('resume', 'invented-cv.txt', 'Sam Okafor, frontend engineer, 5 years.');
    await createSession({
      type: 'interview',
      company: 'Quillon Labs (invented)',
      role: 'Frontend Engineer',
      description: 'An invented interview.',
      preferences: {
        language: 'en',
        model: 'fast',
        style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
        keyTerms: '',
      },
      instructions: '',
      saveTranscript: false,
      autoAnswer: false,
    });
  }
  createRoot(document.getElementById('root')!).render(<AskKitePage />);
}

void start();
