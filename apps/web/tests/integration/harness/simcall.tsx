/**
 * File: apps/web/tests/integration/harness/simcall.tsx
 * Purpose: The browser side of the simulated calls (v1.1.0, item 27): the real answer panel, transcript,
 *          overlay link and home panel on invented sessions, with no sign-in. Lines come from the test
 *          instead of a microphone, and answers from the test server's mocked /api/answer. Screenshots
 *          come from a small drawn image, through the desktop bridge's method.
 * Used by: tests/integration/sim-calls.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/live/LiveAnswers.tsx, TranscriptStrip.tsx, src/features/home/HomePanel.tsx,
 *             src/core/live/hygiene.ts, src/core/transcript/transcript.ts, src/core/storage, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); ADR-0041, ADR-0043, ADR-0044
 *
 * Why a harness: the live page needs a signed-in user (database, secrets) and a microphone. This uses
 * the same components and modules, and does what LivePage.tsx does for hygiene. All text is invented.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { hygieneState, type HygieneState } from '@/core/live/hygiene';
import { createSession } from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { createTranscript } from '@/core/transcript/transcript';
import { displayTerms } from '@/core/transcript/display';
import { groupWords } from '@/core/transcript/group';
import { HomePanel } from '@/features/home/HomePanel';
import { LiveAnswers, type AnswerThisBridge } from '@/features/live/LiveAnswers';
import { TranscriptStrip } from '@/features/live/TranscriptStrip';

/** What the Playwright test does through the page. */
export interface KiteSimHarness {
  /**
   * Adds a finished line.
   *
   * @param speaker    Who spoke.
   * @param text       What they said.
   * @param secondsAgo When it ended.
   */
  say: (speaker: 'you' | 'them', text: string, secondsAgo: number) => void;
  /** How many times listening was paused. */
  pauses: () => number;
  /** How many times listening was resumed. */
  resumes: () => number;
}

declare global {
  interface Window {
    /** Set by this harness when the page loads. */
    kiteSim: KiteSimHarness;
    /** The desktop bridge, on the views that use it. */
    kiteDesktop?: Window['kiteDesktop'];
  }
}

/** An invented session, in a mock interview. */
const SESSION: Session = {
  id: 'harness-session',
  type: 'mock',
  company: 'Harbor Lane Freight (invented)',
  role: 'Backend engineer (practice interview)',
  description: 'A mock interview, for practice.',
  contactName: 'Dana',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: 'Harbor Lane\nKubernetes',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

/** The view asked for in the address: 'call' (the default), 'desktop' or 'home'. */
const VIEW = new URLSearchParams(window.location.search).get('view') ?? 'call';

// Screenshots go through the desktop bridge's method, which a browser cannot be scripted to answer.
// The same small image each time: the mocked server replies by what the test told it to expect.
if (VIEW === 'desktop') {
  window.kiteDesktop = {
    version: '1.1.0',
    os: 'windows',
    captureScreenshot: async () => {
      const canvas = new OffscreenCanvas(640, 360);
      const context = canvas.getContext('2d')!;
      context.fillRect(0, 0, 640, 360);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const png = new Uint8Array(await blob.arrayBuffer());
      return { ok: true as const, png, width: 640, height: 360, ms: 1 };
    },
  } as unknown as Window['kiteDesktop'];
}

const transcript = createTranscript();
const callStartedAt = Date.now() - 60_000;
let pauses = 0;
let resumes = 0;

/** Bumped by a line from the test, so hygiene hears that someone spoke. */
let lastThemAt = Date.now();

window.kiteSim = {
  say: (speaker, text, secondsAgo) => {
    const end = Date.now() - secondsAgo * 1000;
    if (speaker === 'them') lastThemAt = Date.now();
    transcript.addFinal({ speaker, text, tStart: end - 1_500, tEnd: end });
  },
  pauses: () => pauses,
  resumes: () => resumes,
};

/**
 * The live view: what LivePage.tsx puts together, without the microphone.
 *
 * @returns The transcript and the answer panel, side by side.
 */
function SimCall() {
  const terms = displayTerms(SESSION);
  const lines = useSyncExternalStore(transcript.subscribe, transcript.lines, transcript.lines);
  const [clearedAt, setClearedAt] = useState(0);
  const [bridge, setBridge] = useState<AnswerThisBridge | null>(null);
  const [hygiene, setHygiene] = useState<HygieneState>('ok');
  const lastActivity = useRef(Date.now());
  // As LivePage.tsx: the prompt follows the time since the other person spoke or an answer was asked.
  useEffect(() => {
    const timer = setInterval(() => {
      lastActivity.current = Math.max(lastActivity.current, lastThemAt);
      setHygiene((current) => {
        const next =
          current === 'paused' ? 'paused' : hygieneState(lastActivity.current, Date.now());
        if (next === 'paused' && current !== 'paused') pauses += 1;
        return next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, []);
  const stillHere = () => {
    lastActivity.current = Date.now();
    setHygiene('ok');
  };
  const shown = clearedAt > 0 ? lines.filter((line) => line.tStart >= clearedAt) : lines;
  return (
    <div className="k-dark grid h-screen grid-cols-2 gap-3 bg-ui-bg p-3 text-ui-text">
      <TranscriptStrip
        lines={shown}
        terms={terms}
        health="ok"
        themName={SESSION.contactName}
        answeredSpans={bridge?.answeredSpans ?? []}
        onAnswerThis={(group) =>
          bridge?.answerThis(groupWords(group), { start: group.tStart, end: group.tEnd })
        }
      />
      <LiveAnswers
        session={SESSION}
        documents={[]}
        transcript={transcript}
        callStartedAt={callStartedAt}
        ending={false}
        onEnd={() => undefined}
        startInOverlay={false}
        onAnswerThis={setBridge}
        hygiene={hygiene}
        echoCount={transcript.echoStats().count}
        transcriptClearedAt={clearedAt}
        onClearTranscript={() => setClearedAt(Date.now())}
        onStillHere={stillHere}
        onActivity={() => {
          lastActivity.current = Date.now();
        }}
        onResume={() => {
          resumes += 1;
          stillHere();
        }}
        copy={async () => undefined}
      />
    </div>
  );
}

/**
 * The home panel, on two invented sessions in this browser's real IndexedDB.
 *
 * @returns The panel, once they are stored.
 */
function SimHome() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const preferences = SESSION.preferences;
    const base = { preferences, instructions: '', saveTranscript: true, autoAnswer: false };
    void (async () => {
      await createSession(
        {
          ...base,
          type: 'mock',
          company: 'Harbor Lane (invented)',
          role: 'Practice interview',
          description: 'A mock interview.',
        },
        1_000,
      );
      await createSession(
        {
          ...base,
          type: 'regular',
          company: 'Northwind Routes (invented)',
          role: 'Pilot review',
          description: 'A client call.',
        },
        2_000,
      );
      setReady(true);
    })();
  }, []);
  return ready ? <HomePanel name="Sam Lee" email="sam@example.com" /> : null;
}

if (VIEW === 'home') {
  // The panel shows only in a desktop app from 1.1.0.
  window.kiteDesktop = {
    version: '1.1.0',
    os: 'windows',
    openPagesWindow: async (path: string) => {
      (window as unknown as { opened: string[] }).opened.push(path);
    },
    windowControl: async () => undefined,
    setOverlayLayout: async () => undefined,
    getShareProtection: async () => ({ on: false, supported: true, scope: 'all' }),
    setShareProtection: async (on: boolean) => ({ on, supported: true, scope: 'all' }),
  } as unknown as Window['kiteDesktop'];
  (window as unknown as { opened: string[] }).opened = [];
}

createRoot(document.getElementById('root')!).render(VIEW === 'home' ? <SimHome /> : <SimCall />);
