/**
 * File: apps/web/tests/integration/harness/compact.tsx
 * Purpose: The compact view side of the answer harness test (Day 5): renders the real
 *          CompactLive for the harness session, so a second page in the same browser shows
 *          what the live page (harness/answers.tsx) publishes and sends its commands back over
 *          the session's channel, as the desktop compact window does.
 * Used by: tests/integration/answers.spec.ts (bundled with esbuild, served at /compact-harness)
 * Depends on: src/features/live/CompactLive.tsx, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view), §11;
 *               day-05-overlay-screenshots-notes.md Stage 3
 */
import { createRoot } from 'react-dom/client';
import { CompactLive } from '@/features/live/CompactLive';

createRoot(document.getElementById('root')!).render(<CompactLive sessionId="harness-session" />);
