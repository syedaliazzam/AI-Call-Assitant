/**
 * File: apps/web/tests/visual/rig-live.tsx
 * Purpose: The overlay rig's simulated call (v1.0.4 visual checks): the REAL full call window (the
 *          real sidebar, LiveCallLayout, TranscriptStrip and LiveAnswers, with the real answer hook,
 *          channel, platform and hotkeys) on an invented session. Only the ends are simulated: the
 *          driver feeds Them and You lines through window.rig instead of a speech engine, and
 *          answers come from the rig server's mocked /api/answer (overlay-rig.ts) unless it is
 *          started with real answers. An in-memory store starts with answers saved "before clean
 *          questions existed" (raw text, no cleaned question, one duplicate). Calls start in the
 *          overlay as in the app, so the real desktop shell opens the real overlay window. Served at
 *          / by overlay-rig.ts.
 * Used by: tests/visual/overlay-rig.ts (bundled with esbuild); apps/desktop/tests/visual/*-shots.ts
 * Depends on: src/features/live, src/core/transcript/transcript.ts, src/ui/Sidebar.tsx
 * Architecture: docs/decisions/ADR-0040-full-call-window-and-one-entry-per-question.md
 *
 * Invented data only; nothing is saved but this rig's own browser storage.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { displayTerms } from '@/core/transcript/display';
import { createTranscript, type Speaker } from '@/core/transcript/transcript';
import type { Session, StoredAnswer } from '@/core/storage/types';
import { groupWords, type TranscriptGroup } from '@/core/transcript/group';
import { AudioMeter } from '@/features/live/AudioMeter';
import { LiveAnswers, type AnswerThisBridge } from '@/features/live/LiveAnswers';
import { BrowserCallLayout } from '@/features/live/BrowserCallLayout';
import { LiveCallLayout } from '@/features/live/LiveCallLayout';
import { TranscriptStrip } from '@/features/live/TranscriptStrip';
import type { AnswerStore } from '@/features/live/useLiveAnswers';
import { Sidebar } from '@/ui/Sidebar';

/** The session id the rig uses (the overlay page is /compact/<this>). */
const SESSION_ID = 'harness-session';

/** When the invented call started: 4 min 12 s ago. */
const STARTED_AT = Date.now() - 252_000;

/** An invented session. */
const SESSION: Session = {
  id: SESSION_ID,
  type: 'interview',
  company: 'Northwind Robotics (invented)',
  role: 'AI engineer',
  description: 'Invented rig session.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: '',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

/**
 * An answer saved before clean questions existed: raw words, no cleaned question.
 *
 * @param id        Its id.
 * @param createdAt When it was asked.
 * @param question  The raw words.
 * @param text      The answer.
 * @returns The saved answer.
 */
function oldAnswer(id: string, createdAt: number, question: string, text: string): StoredAnswer {
  return {
    id,
    sessionId: SESSION_ID,
    mode: 'answer',
    question,
    text,
    model: 'fast',
    msFirstToken: 900,
    msTotal: 3_000,
    createdAt,
    rating: null,
    note: '',
  };
}

/** The store's rows: an old answer, and a near-identical one 20 s later. */
const saved: StoredAnswer[] = [
  oldAnswer(
    'old-1',
    STARTED_AT - 40_000,
    'TELL ME ABOUT YOURSELF? OKAY AND THEN WE CAN MOVE ON TO THE NEXT PART',
    'I build AI systems that answer questions from company documents.\n- Search with a vector database',
  ),
  oldAnswer(
    'old-2',
    STARTED_AT - 20_000,
    'UM TELL ME ABOUT YOURSELF? OKAY AND THEN WE CAN MOVE ON TO THE NEXT PART',
    'I build AI systems that answer questions from company documents.\n- Search with a vector database\n- Claude drafts, people review',
  ),
];

/** An in-memory answer store, so each run starts from the same rows. */
const store: AnswerStore = {
  save: async (answer) => {
    saved.push(answer);
  },
  list: async () => [...saved],
  rate: async () => undefined,
  report: async () => undefined,
  note: async () => undefined,
};

/** The call's transcript; the driver feeds it. */
const transcript = createTranscript();

/** What the driver can do from outside the page. */
export interface RigControls {
  /**
   * Feeds a line as the speech engine would.
   *
   * @param speaker Who speaks.
   * @param text    The words, in the engine's capitals.
   * @param final   False for words still being heard (grey).
   */
  say: (speaker: Speaker, text: string, final?: boolean) => void;
}

(window as unknown as { rig: RigControls }).rig = {
  say(speaker, text, final = true) {
    if (!final) {
      transcript.addPartial(speaker, text, Date.now() - 800);
      return;
    }
    const now = Date.now();
    transcript.addFinal({ speaker, text, tStart: now - 1_500, tEnd: now });
  },
};

/**
 * The call screen, wired as LivePage wires it.
 *
 * @returns The screen.
 */
function CallRig() {
  const lines = useSyncExternalStore(
    transcript.subscribe,
    transcript.displayLines,
    transcript.displayLines,
  );
  const terms = useMemo(() => displayTerms(SESSION), []);
  const [bridge, setBridge] = useState<AnswerThisBridge | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  // Dictation's state only: the rig has no speech engine, so nothing is ever heard.
  const [listening, setListening] = useState(false);
  const setOnText = useCallback(() => undefined, []);
  const dictation = useMemo(
    () => ({
      supported: true,
      listening,
      notice: null,
      start: () => setListening(true),
      stop: () => setListening(false),
      setOnText,
    }),
    [listening, setOnText],
  );
  const meters = (['you', 'them'] as const).map((speaker) => (
    <AudioMeter
      key={speaker}
      speaker={speaker}
      level={speaker === 'you' ? 0.3 : 0.55}
      inactive={false}
      compact
    />
  ));
  const transcriptNode = (
    <TranscriptStrip
      lines={lines}
      health="ok"
      terms={terms}
      {...(bridge
        ? {
            onAnswerThis: (group: TranscriptGroup) =>
              bridge.answerThis(groupWords(group), { start: group.tStart, end: group.tEnd }),
            answeredSpans: bridge.answeredSpans,
          }
        : {})}
    />
  );
  /**
   * The answers panel.
   *
   * @param startInOverlay True to open the overlay when the call starts, as the desktop app does.
   * @returns The panel.
   */
  const answersNode = (startInOverlay: boolean) => (
    <LiveAnswers
      session={SESSION}
      documents={[]}
      transcript={transcript}
      callStartedAt={STARTED_AT}
      startInOverlay={startInOverlay}
      ending={false}
      onEnd={() => undefined}
      store={store}
      copy={async () => undefined}
      onAnswerThis={setBridge}
      dictation={dictation}
      topBarSlot={slot}
    />
  );
  // ?layout=browser: the browser's call view around the same transcript and answers.
  if (new URLSearchParams(window.location.search).get('layout') === 'browser') {
    return (
      <BrowserCallLayout
        title="Interview call"
        name={SESSION.company}
        status={{ tone: 'success', label: 'Connected' }}
        meters={meters}
        topBarSlot={setSlot}
        preview={{
          stream: null,
          themLabel: 'the shared tab',
          micOn: true,
          language: 'en',
          onLanguage: () => undefined,
          onStop: () => undefined,
          onClear: () => undefined,
          onMinimize: () => undefined,
          onChangeTab: () => undefined,
        }}
        transcript={transcriptNode}
        answers={answersNode(false)}
      />
    );
  }
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar user={{ name: 'Rig user', email: 'rig@invented.example', role: 'user' }} />
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <LiveCallLayout
          title="Interview call"
          name={SESSION.company}
          themSource="your computer's sound"
          status={{ tone: 'success', label: 'Connected' }}
          meters={meters}
          topBarSlot={setSlot}
          transcript={transcriptNode}
          answers={answersNode(true)}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<CallRig />);
