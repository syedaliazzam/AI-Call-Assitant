/**
 * File: apps/web/tests/integration/harness/live.tsx
 * Purpose: Browser side of the live screens harness (UI theme stage U3). Renders the real dark
 *          call screens for invented data, chosen by the page's ?view=:
 *          - live: inside a stand-in of the app shell (same width as in the app), LiveCallLayout
 *            with the real TranscriptStrip (a provisional line included)
 *            and LiveAnswers (answers come from the test server's mocked /api/answer); ?view=auto turns
 *            auto-answer on and adds window.addThemLine() for the rate-limit test;
 *          - connect: the Connect view (ConnectPanel), model ready, not connected;
 *          - gate: the live page's phone check (platform supportsLiveCalls()), showing
 *            LiveCallsUnsupported on a phone or tablet;
 *          - compact / compact-unavailable: CompactView with a live answer, or with the
 *            "Claude unavailable" message.
 *          No sign-in, no microphone, no speech model and no Claude call.
 * Used by: tests/integration/live.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/live (LiveCallLayout, TranscriptStrip, LiveAnswers, AudioMeter,
 *             ConnectPanel, CompactView, LiveCallsUnsupported), src/core/transcript, src/platform
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing);
 *               docs/design/kite-ui-theme.md §6
 */
import { useState } from 'react';
import { CLAUDE_UNAVAILABLE_MESSAGES } from '@kite/shared';
import { createRoot } from 'react-dom/client';
import type { CompactState } from '@/core/live/liveChannel';
import type { OverlayPanels } from '@/core/storage/overlayPrefs';
import type { Session } from '@/core/storage/types';
import { createTranscript } from '@/core/transcript/transcript';
import { AudioMeter } from '@/features/live/AudioMeter';
import { CompactView } from '@/features/live/CompactView';
import { BrowserCallLayout } from '@/features/live/BrowserCallLayout';
import { ConnectPanel } from '@/features/live/ConnectPanel';
import { LiveAnswers } from '@/features/live/LiveAnswers';
import { ThemSilentNotice } from '@/features/live/ThemSilentNotice';
import { LiveCallLayout } from '@/features/live/LiveCallLayout';
import { LiveCallsUnsupported } from '@/features/live/LiveCallsUnsupported';
import { TranscriptStrip } from '@/features/live/TranscriptStrip';
import { getPlatform } from '@/platform';

/** An invented session. */
const SESSION: Session = {
  id: 'live-harness-session',
  type: 'regular',
  company: 'Harbor Lane Freight (invented)',
  role: 'Pilot review',
  description: 'Invented harness session.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: 'Harbor Lane\nProfessional plan',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

/** Which view the test asked for (?view=…). */
const VIEW = new URLSearchParams(window.location.search).get('view') ?? 'live';

/** Error texts for ?view=connect-errors (Day 6 Stage 4e), as the app words them. */
const CONNECT_ERRORS = {
  /** core/audio/capture.ts micError(), permission denied. */
  mic: 'Paramount AI can\u2019t use your microphone. Allow microphone access for Paramount AI, then click Connect again.',
  /** core/stt/download.ts, quota exceeded. */
  model:
    'Not enough disk space to store the speech model (about 205 MB needed). Free some space, then try again.',
};

/** ?view=auto: auto-answer on (Day 6 Stage 4f), with a hook to add a finished Them question. */
const AUTO_VIEW = new URLSearchParams(window.location.search).get('view') === 'auto';

const callStartedAt = Date.now() - 120_000;
const transcript = createTranscript();
const at = (seconds: number) => callStartedAt + seconds * 1000;
transcript.addFinal({
  speaker: 'you',
  text: 'THANKS FOR JOINING LET US GO THROUGH THE PILOT',
  tStart: at(5),
  tEnd: at(8),
});
transcript.addFinal({
  speaker: 'them',
  text: 'GREAT THE OPERATIONS TEAM LIKED THE RESULTS',
  tStart: at(20),
  tEnd: at(24),
});
transcript.addFinal({
  speaker: 'you',
  text: 'GOOD TO HEAR THE NIGHT SHIFT FELT IT TOO',
  tStart: at(26),
  tEnd: at(29),
});
transcript.addFinal({
  speaker: 'them',
  text: 'SO WHAT WOULD THE PROFESSIONAL PLAN COST',
  tStart: at(32),
  tEnd: at(35),
});
transcript.addFinal({ speaker: 'them', text: 'FOR FORTY SEATS', tStart: at(37), tEnd: at(38) });
// Still being heard: shown grey and in italics.
transcript.addPartial('you', 'LET ME CHECK THE PRICE LIST', Date.now() - 2_000);

/**
 * The app shell's shape around the live page (app/(app)/layout.tsx): a 240 px navigation
 * column from 768 px, a top bar below that. A stand-in, so the live view gets the same width
 * as in the app (next/navigation, which the real Sidebar needs, is not available here).
 *
 * @param props.children The page.
 * @returns The shell.
 */
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div aria-hidden="true" className="h-16 shrink-0 bg-ui-surface md:h-auto md:w-60" />
      <main className="relative min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

/**
 * The live call view in the app shell.
 *
 * @returns The view.
 */
function LiveView() {
  return (
    <AppShell>
      <LiveCallLayout
        title="Sales call"
        name={SESSION.company}
        themSource="the shared tab's audio"
        status={{ tone: 'success', label: 'Connected' }}
        notices={
          VIEW === 'live-errors' ? (
            <>
              <ThemSilentNotice />
              {/* Day 6 Stage 4: the note the watchdog shows after restarting a stuck engine. */}
              <p
                role="status"
                className="rounded-control border border-ui-border bg-ui-surface px-3 py-2 text-[13px] text-ui-muted"
              >
                Transcription restarted.
              </p>
            </>
          ) : undefined
        }
        meters={(['you', 'them'] as const).map((speaker) => (
          <AudioMeter
            key={speaker}
            speaker={speaker}
            level={speaker === 'you' ? 0.35 : 0.6}
            inactive={false}
            compact
          />
        ))}
        transcript={<TranscriptStrip lines={transcript.lines()} health="ok" />}
        answers={
          <LiveAnswers
            session={SESSION}
            documents={[]}
            transcript={transcript}
            callStartedAt={callStartedAt}
            autoAnswer={AUTO_VIEW}
            ending={false}
            onEnd={() => undefined}
            copy={async () => undefined}
          />
        }
      />
    </AppShell>
  );
}

/**
 * A moving picture as a stream, in place of a shared tab: 1920 × 950, about what a browser tab
 * measures.
 *
 * @returns The stream, with one video track.
 */
function fakeTabStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 950;
  const context = canvas.getContext('2d')!;
  let frame = 0;
  // A stream only carries frames while the canvas keeps changing.
  setInterval(() => {
    frame += 1;
    context.fillStyle = frame % 2 ? '#334155' : '#475569';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, 100);
  return canvas.captureStream(10);
}

/**
 * The browser split call view (live-ui-split): the shared-tab preview and transcript on the left,
 * the answers on the right. With ?novideo the preview has no stream and shows its placeholder.
 *
 * @returns The view.
 */
function SplitView() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [stream] = useState(() =>
    new URLSearchParams(window.location.search).has('novideo') ? null : fakeTabStream(),
  );
  return (
    <AppShell>
      <BrowserCallLayout
        title="Sales call"
        name={SESSION.company}
        status={{ tone: 'success', label: 'Connected' }}
        meters={(['you', 'them'] as const).map((speaker) => (
          <AudioMeter
            key={speaker}
            speaker={speaker}
            level={speaker === 'you' ? 0.35 : 0.6}
            inactive={false}
            compact
          />
        ))}
        topBarSlot={setSlot}
        preview={{
          stream,
          themLabel: "the shared tab's audio",
          micOn: true,
          language: 'en',
          onLanguage: () => undefined,
          onStop: () => undefined,
          onClear: () => undefined,
          onMinimize: () => undefined,
          onChangeTab: () => undefined,
        }}
        transcript={<TranscriptStrip lines={transcript.lines()} health="ok" flush />}
        answers={
          <LiveAnswers
            session={SESSION}
            documents={[]}
            transcript={transcript}
            callStartedAt={callStartedAt}
            ending={false}
            onEnd={() => undefined}
            copy={async () => undefined}
            topBarSlot={slot}
            slimTopBar
          />
        }
      />
    </AppShell>
  );
}

/**
 * The Connect view, model ready, not connected yet.
 *
 * @returns The view.
 */
function ConnectView() {
  return (
    <div className="min-h-full bg-ui-bg pb-10 text-ui-text">
      <ConnectPanel
        call={{
          title: 'Regular call',
          company: SESSION.company,
          role: SESSION.role,
          summary: `This is a Regular session about ${SESSION.role} with ${SESSION.company}.`,
        }}
        hotwordCount={6}
        platform="browser"
        model={
          VIEW === 'connect-errors'
            ? { status: 'error', progress: null, error: CONNECT_ERRORS.model }
            : { status: 'ready', progress: null, error: null }
        }
        connection="idle"
        levels={{ you: 0, them: 0 }}
        channelErrors={VIEW === 'connect-errors' ? { you: CONNECT_ERRORS.mic } : {}}
        soundCheck={null}
        health="ok"
        onConnect={() => undefined}
        onRetryModel={() => undefined}
        onContinue={() => undefined}
      />
    </div>
  );
}

/** The compact view's state: a live line and answer. */
const COMPACT_STATE: CompactState = {
  audio: { you: true, them: true },
  chips: [
    { id: 'l1:0', speaker: 'them', text: 'So what would' },
    { id: 'l1:1', speaker: 'them', text: 'the Professional plan' },
    { id: 'l1:2', speaker: 'them', text: 'cost for forty' },
    { id: 'l1:3', speaker: 'them', text: 'seats' },
  ],
  liveQuestion: 'What would the Professional plan cost for forty seats?',
  themName: 'Dana',
  groups: [
    {
      id: 'g1',
      speaker: 'them',
      finalText: 'Great, the operations team liked the results.',
      provisionalText: '',
      tStart: Date.now() - 60_000,
      question: false,
      answered: false,
      unclear: false,
    },
    {
      id: 'g2',
      speaker: 'you',
      finalText: 'Good to hear. The night shift felt it too.',
      provisionalText: '',
      tStart: Date.now() - 50_000,
      question: false,
      answered: false,
      unclear: false,
    },
    {
      id: 'g3',
      speaker: 'them',
      finalText: 'So what would the Professional plan cost for forty seats?',
      provisionalText: '',
      tStart: Date.now() - 40_000,
      question: true,
      answered: false,
      unclear: false,
    },
  ],
  index: 1,
  total: 2,
  answer: {
    id: 'a2',
    question: 'What would the Professional plan cost for forty seats?',
    text: [
      'Forty seats cost 2,080 dollars a month.',
      '- 52 dollars per seat on Professional',
      '- Billed yearly',
      'Tip: I can also send the annual comparison after this call.',
      'Note: Check the discount for two years with finance.',
    ].join('\n'),
    headline: 'Forty seats cost 2,080 dollars a month.',
    claims: [],
    meta: { type: 'sales', target: 'call', source: 'docs' },
    askedAt: Date.now(),
    rating: 'up',
    reported: false,
    auto: false,
    status: 'done',
    mode: 'answer',
    error: null,
    unavailable: false,
  },
  answering: false,
  capturing: false,
  notice: null,
  ended: false,
};

/**
 * The compact view on a fixed state, with its Chat button working (CompactLive holds this state in
 * the app).
 *
 * @param props.state What to show.
 * @returns The view.
 * Rendered by: the bottom of this file
 */
function CompactHarness({
  state,
}: {
  /** What to show. */
  state: CompactState;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const params = new URLSearchParams(window.location.search);
  // ?panels=transcript,answer: which panels start open (the answer panel by default here).
  const [panels, setPanels] = useState<OverlayPanels>(() => {
    const open = params.get('panels') ?? 'answer';
    return { transcript: open.includes('transcript'), answer: open.includes('answer') };
  });
  // ?alpha=0.4|0.7: the panel-background opacity, so the overlay look test can render the slider's
  // settings (ADR-0033). The desktop window's settings are only present with the glass panel.
  const alphaParam = params.get('alpha');
  const alpha = alphaParam === null ? null : Number(alphaParam);
  return (
    <CompactView
      state={state}
      protection={{ supported: true, on: true }}
      onCommand={() => undefined}
      onProtection={() => undefined}
      chatOpen={chatOpen}
      onChatOpen={setChatOpen}
      panels={panels}
      onPanels={setPanels}
      // ?glass=1: the see-through panel of the desktop window (the overlay look test).
      glass={params.has('glass')}
      // ?theme=light: the overlay's light theme.
      resolvedTheme={params.get('theme') === 'light' ? 'light' : 'dark'}
      {...(alpha !== null
        ? {
            windowSettings: {
              opacity: alpha,
              panelAlpha: alpha,
              onOpacity: () => undefined,
            },
          }
        : {})}
    />
  );
}

/** The compact view with a coding answer, a figure to check and other answers (ADR-0030). */
const CODING_STATE: CompactState = {
  ...COMPACT_STATE,
  chatTarget: 'kite',
  sessionType: 'interview',
  answer: {
    ...COMPACT_STATE.answer!,
    id: 'a4',
    question: 'Reverse a list, please.',
    text: [
      'I would walk the list once and swap from both ends.',
      '- Steps: keep two pointers, swap, and move them inward.',
      '- Complexity: O(n) time, O(1) space.',
      '- Edge cases: an empty list and a single item.',
      '```python',
      'def reverse(items):',
      '    left, right = 0, len(items) - 1',
      '    while left < right:',
      '        items[left], items[right] = items[right], items[left]',
      '        left, right = left + 1, right - 1',
      '    return items',
      '```',
      'Say: I swap from both ends, so it takes one pass, and last year that saved 37 percent.',
    ].join('\n'),
    headline: 'I would walk the list once and swap from both ends.',
    claims: ['37'],
    meta: { type: 'coding', target: 'call', source: 'general' },
  },
};

/** The compact view with a private answer (ADR-0030). */
const PRIVATE_STATE: CompactState = {
  ...CODING_STATE,
  answer: {
    ...CODING_STATE.answer!,
    id: 'a5',
    question: 'What is 17% of 2,340?',
    text: '**397.8**\n\nWorking:\n1. 10% of 2,340 is 234.\n2. 7% of 2,340 is 163.8.\n3. 234 + 163.8 = 397.8.',
    headline: '397.8',
    claims: [],
    meta: { type: 'concept', target: 'kite', source: 'general' },
  },
};

/** The same, when Claude is unavailable. */
const UNAVAILABLE_STATE: CompactState = {
  ...COMPACT_STATE,
  answer: {
    id: 'a3',
    question: '',
    text: '',
    headline: '',
    claims: [],
    askedAt: Date.now(),
    rating: null,
    reported: false,
    auto: false,
    status: 'error',
    mode: 'answer',
    error: CLAUDE_UNAVAILABLE_MESSAGES.usageLimit,
    unavailable: true,
  },
};

const view = new URLSearchParams(window.location.search).get('view') ?? 'live';
const root = createRoot(document.getElementById('root')!);
if (view === 'connect' || view === 'connect-errors') {
  root.render(<ConnectView />);
} else if (view === 'gate') {
  // The live page's check (LiveSession.tsx), through the real platform adapter.
  root.render(
    getPlatform().supportsLiveCalls() ? (
      <p>Live calls are supported here.</p>
    ) : (
      <LiveCallsUnsupported />
    ),
  );
} else if (
  view === 'compact' ||
  view === 'compact-unavailable' ||
  view === 'compact-coding' ||
  view === 'compact-private'
) {
  root.render(
    <CompactHarness
      state={
        view === 'compact'
          ? COMPACT_STATE
          : view === 'compact-coding'
            ? CODING_STATE
            : view === 'compact-private'
              ? PRIVATE_STATE
              : UNAVAILABLE_STATE
      }
    />,
  );
} else if (view === 'split') {
  root.render(<SplitView />);
} else {
  if (AUTO_VIEW) {
    // The test adds a finished "Them" line that ended just now (invented text).
    (window as unknown as { addThemLine: (text: string) => void }).addThemLine = (text) => {
      const now = Date.now();
      transcript.addFinal({ speaker: 'them', text, tStart: now - 1_500, tEnd: now });
    };
  }
  root.render(<LiveView />);
}
