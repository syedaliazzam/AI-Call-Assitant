/**
 * File: apps/web/tests/visual/rig-extra.tsx
 * Purpose: The overlay rig's v1.1.0 pages (visual checks): the real home panel (/home, on invented
 *          sessions in this browser's IndexedDB) and the real snap zones (/overlay-zones).
 * Used by: tests/visual/overlay-rig.ts (bundled with esbuild); tests/visual/v110-shots.ts
 * Depends on: src/features/home/HomePanel.tsx, src/features/live/overlay/SnapZones.tsx,
 *             src/core/storage/sessions.ts, react-dom
 * Architecture: docs/decisions/ADR-0041-home-panel-and-stacked-overlay.md
 *
 * All text is invented.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createSession } from '@/core/storage/sessions';
import { getDb } from '@/core/storage/db';
import type { SessionPreferences } from '@/core/storage/types';
import { HomePanel } from '@/features/home/HomePanel';
import { SnapZones } from '@/features/live/overlay/SnapZones';

/** The same preferences for each invented session. */
const PREFERENCES: SessionPreferences = {
  language: 'en',
  model: 'fast',
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  keyTerms: '',
};

/**
 * The home panel, on invented sessions: one ended with a length, the others ready.
 *
 * @returns The panel, once they are stored.
 */
function RigHome() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const base = {
        preferences: PREFERENCES,
        instructions: '',
        saveTranscript: true,
        autoAnswer: false,
      };
      const count = await getDb().table('sessions').count();
      if (count === 0) {
        const now = Date.now();
        const ended = await createSession(
          {
            ...base,
            type: 'mock',
            company: 'Harbor Lane Freight',
            role: 'Backend engineer practice',
            description: 'A mock interview, for practice.',
          },
          now - 86_400_000,
        );
        await getDb()
          .table('sessions')
          .update(ended.id, { status: 'ended', lastCallMs: 1_470_000 });
        await createSession(
          {
            ...base,
            type: 'regular',
            company: 'Northwind Routes',
            role: 'Pilot review',
            description: 'Results of the route planning pilot.',
          },
          now - 3_600_000,
        );
        await createSession(
          {
            ...base,
            type: 'interview',
            company: 'Bluefin Logistics',
            role: 'Practice: platform engineer',
            description: 'A practice round with a friend.',
          },
          now,
        );
      }
      setReady(true);
    })();
  }, []);
  return ready ? <HomePanel email="sam@example.com" /> : null;
}

const zones = new URLSearchParams(window.location.search).get('zones');
createRoot(document.getElementById('root')!).render(
  window.location.pathname.startsWith('/overlay-zones') ? <SnapZones zones={zones} /> : <RigHome />,
);
