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
import { CLAUDE_UNAVAILABLE_MESSAGES } from '@kite/shared';
import { createRoot } from 'react-dom/client';
import type { CompactState } from '@/core/live/liveChannel';
import type { Session } from '@/core/storage/types';
import { createTranscript } from '@/core/transcript/transcript';
import { AudioMeter } from '@/features/live/AudioMeter';
import { CompactView } from '@/features/live/CompactView';
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
  type: 'sales',
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
  mic: 'Kite can\u2019t use your microphone. Allow microphone access for Kite, then click Connect again.',
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
      <div aria-hidden="true" className="h-16 shrink-0 bg-ui-nav md:h-auto md:w-60" />
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
        notices={VIEW === 'live-errors' ? <ThemSilentNotice /> : undefined}
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
 * The Connect view, model ready, not connected yet.
 *
 * @returns The view.
 */
function ConnectView() {
  return (
    <div className="k-dark min-h-screen bg-ui-bg pb-10 text-ui-text">
      <ConnectPanel
        call={{ title: 'Sales call', company: SESSION.company, role: SESSION.role }}
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
  line: { speaker: 'them', text: 'SO WHAT WOULD THE PROFESSIONAL PLAN COST FOR FORTY SEATS' },
  answer: {
    headline: 'Forty seats cost 2,080 dollars a month.',
    bullets: ['52 dollars per seat on Professional', 'Billed yearly'],
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

/** The same, when Claude is unavailable. */
const UNAVAILABLE_STATE: CompactState = {
  ...COMPACT_STATE,
  answer: {
    headline: '',
    bullets: [],
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
} else if (view === 'compact' || view === 'compact-unavailable') {
  root.render(
    <CompactView
      state={view === 'compact' ? COMPACT_STATE : UNAVAILABLE_STATE}
      protection={{ supported: true, on: true }}
      onCommand={() => undefined}
      onProtection={() => undefined}
    />,
  );
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
