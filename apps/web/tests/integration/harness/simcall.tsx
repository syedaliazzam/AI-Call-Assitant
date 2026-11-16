/**
 * File: apps/web/tests/integration/harness/simcall.tsx
 * Purpose: The browser side of the simulated calls (v1.1.0, item 27): the real answer panel, transcript,
 *          and overlay link on invented sessions, with no sign-in. Lines come from the test
 *          instead of a microphone, and answers from the test server's mocked /api/answer. Screenshots
 *          come from a small drawn image, through the desktop bridge's method. Batch D: ?rules=newest runs
 *          the cloud-transcription question rules, with turn() for grey lines and engine end-of-turn lines.
 * Used by: tests/integration/sim-calls.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/live/LiveAnswers.tsx, TranscriptStrip.tsx,
 *             src/core/live/hygiene.ts, src/core/transcript/transcript.ts, src/core/storage, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); ADR-0041, ADR-0043, ADR-0044
 *
 * Why a harness: the live page needs a signed-in user (database, secrets) and a microphone. This uses
 * the same components and modules, and does what LivePage.tsx does for hygiene. All text is invented.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { hygieneState, type HygieneState } from '@/core/live/hygiene';
import { listAnswers } from '@/core/storage/answers';
import type { Session } from '@/core/storage/types';
import { createTranscript } from '@/core/transcript/transcript';
import { displayTerms } from '@/core/transcript/display';
import { groupWords } from '@/core/transcript/group';
import { LiveAnswers, type AnswerThisBridge } from '@/features/live/LiveAnswers';
import { useCallDictation, type DictationRoute } from '@/features/live/useCallDictation';
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
  /** Speech on the microphone, as a finished line, through the call's dictation. */
  dictate: (text: string) => void;
  /**
   * v1.4: adds a finished line that ends now (for the timed auto-answer checks).
   *
   * @param speaker    Who spoke.
   * @param text       What they said.
   * @param durationMs How long it took to say.
   * @param nonEnglish True to add it as another language (core/stt/language.ts decided so).
   */
  speak: (speaker: 'you' | 'them', text: string, durationMs: number, nonEnglish?: boolean) => void;
  /**
   * Batch D: a line as cloud transcription gives it (for ?rules=newest), ending now.
   *
   * @param speaker Who spoke.
   * @param text    What they said.
   * @param options.startAfterThemMs Start this long after the last "Them" line ended (default: now − 1.5 s).
   * @param options.grey             Add it as grey words still being spoken (a partial line).
   * @param options.endOfTurn        The engine's own end of turn ended it (Flux EndOfTurn).
   */
  turn: (
    speaker: 'you' | 'them',
    text: string,
    options?: { startAfterThemMs?: number; grey?: boolean; endOfTurn?: boolean },
  ) => void;
  /** Batch D: the saved answers of this session: whether each is a re-ask on a card of its own. */
  saved: () => Promise<{ rerunOf: boolean }[]>;
}

declare global {
  interface Window {
    /** Set by this harness when the page loads. */
    kiteSim: KiteSimHarness;
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

/**
 * Puts a fake desktop bridge on the page, as the shell's preload would (platform/index.ts then picks
 * the desktop platform). Only the methods a view uses.
 *
 * @param bridge The bridge.
 */
function installBridge(bridge: object): void {
  (window as unknown as { kiteDesktop: object }).kiteDesktop = bridge;
}

/**
 * The view asked for in the address: 'call' (the default) or 'desktop'. ADR-0092: the classic home panel
 * view is gone (the desktop window is the launcher; tests/integration/launcher.spec.ts covers it).
 */
const VIEW = new URLSearchParams(window.location.search).get('view') ?? 'call';

/** v1.4: auto-answer on for this page (?auto=1), for the timed checks. */
const AUTO = new URLSearchParams(window.location.search).get('auto') === '1';

/** Batch D: the question rules of calls with cloud transcription (?rules=newest). */
const NEWEST = new URLSearchParams(window.location.search).get('rules') === 'newest';

/** Batch D: when the last "Them" line ended (Unix ms), for turn()'s startAfterThemMs. */
let lastThemEnd = Date.now();

// Screenshots go through the desktop bridge's method, which a browser cannot be scripted to answer.
// The same small image each time: the mocked server replies by what the test told it to expect.
if (VIEW === 'desktop') {
  installBridge({
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
  });
}

const transcript = createTranscript();
const callStartedAt = Date.now() - 60_000;
let pauses = 0;
let resumes = 0;

/** Bumped by a line from the test, so hygiene hears that someone spoke. */
let lastThemAt = Date.now();

/** Where the microphone's words go, as LivePage.tsx routes them (spec S14). */
let dictationRoute: DictationRoute | null = null;

window.kiteSim = {
  say: (speaker, text, secondsAgo) => {
    const end = Date.now() - secondsAgo * 1000;
    if (speaker === 'them') lastThemAt = Date.now();
    transcript.addFinal({ speaker, text, tStart: end - 1_500, tEnd: end });
  },
  pauses: () => pauses,
  resumes: () => resumes,
  dictate: (text) => dictationRoute?.final(text),
  speak: (speaker, text, durationMs, nonEnglish) => {
    const end = Date.now();
    if (speaker === 'them') lastThemAt = end;
    transcript.addFinal({
      speaker,
      text,
      tStart: end - durationMs,
      tEnd: end,
      ...(nonEnglish ? { nonEnglish: true } : {}),
    });
  },
  turn: (speaker, text, options = {}) => {
    const end = Date.now();
    const start =
      options.startAfterThemMs !== undefined ? lastThemEnd + options.startAfterThemMs : end - 1_500;
    if (speaker === 'them') lastThemAt = end;
    if (options.grey) {
      transcript.addPartial(speaker, text, start, end);
      return;
    }
    if (speaker === 'them') lastThemEnd = end;
    transcript.addFinal({
      speaker,
      text,
      tStart: start,
      tEnd: end,
      ...(options.endOfTurn ? { endOfTurn: true } : {}),
    });
  },
  saved: async () =>
    (await listAnswers(SESSION.id)).map((answer) => ({ rerunOf: answer.rerunOf !== undefined })),
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
  const lastActivity = useRef(callStartedAt);
  // The real dictation, as LivePage.tsx has it; the test speaks through window.kiteSim.dictate.
  const { dictation, route } = useCallDictation({ available: true });
  useEffect(() => {
    dictationRoute = route;
  }, [route]);
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
        dictation={dictation}
        onAnswerThis={setBridge}
        hygiene={hygiene}
        echoCount={transcript.echoStats().count}
        {...(AUTO ? { autoAnswer: true } : {})}
        {...(NEWEST ? { rules: 'newest' as const } : {})}
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

createRoot(document.getElementById('root')!).render(<SimCall />);
