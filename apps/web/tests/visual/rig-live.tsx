/**
 * File: apps/web/tests/visual/rig-live.tsx
 * Purpose: The overlay rig's stand-in for the live call page (v1.0.3 visual checks): it publishes
 *          a realistic overlay state (invented call: live words with fillers, a transcript, two
 *          answers, the call start) on the session's real channel, answers the overlay's commands
 *          (hello, latest, clear, prev, next, show, script-bar, dictate) the way LiveAnswers does,
 *          and asks the desktop shell to open the overlay through the real bridge. Served at / by
 *          overlay-rig.ts, so the real desktop shell (dev build) opens the real overlay window.
 * Used by: tests/visual/overlay-rig.ts (bundled with esbuild); apps/desktop/tests/visual/overlay-shots.ts
 * Depends on: src/core/live/liveChannel.ts, @kite/shared (desktop bridge type)
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 *
 * Invented data only; nothing is sent anywhere.
 */
import type { KiteDesktopApi } from '@kite/shared';
import { sentenceCase, transcriptChips } from '@/core/transcript/display';
import type { Utterance } from '@/core/transcript/transcript';
import { openLiveChannel, type CompactAnswer, type CompactState } from '@/core/live/liveChannel';

/** The session id the rig uses (the overlay page is /compact/<this>). */
const SESSION = 'harness-session';

/** When the invented call started: 4 min 12 s ago. */
const STARTED_AT = Date.now() - 252_000;

/** The two invented answers, oldest first. */
const ANSWERS: CompactAnswer[] = [
  {
    id: 'a1',
    question: 'TELL ME ABOUT YOURSELF',
    cleanQuestion: 'Tell me about yourself.',
    text: [
      'I build AI systems that answer questions from company documents.',
      '- Search with a vector database over internal files',
      '- Claude drafts, people review before sending',
    ].join('\n'),
    headline: 'I build AI systems that answer questions from company documents.',
    claims: [],
    meta: { type: 'behavioural', target: 'call', source: 'docs' },
    askedAt: STARTED_AT + 60_000,
    rating: null,
    reported: false,
    auto: false,
    status: 'done',
    mode: 'answer',
    error: null,
    unavailable: false,
  },
  {
    id: 'a2',
    question: 'UM WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU BUILT',
    cleanQuestion: 'What production-grade applications have you built?',
    text: [
      'A document search assistant and real-time voice agents, both in production.',
      '- Document search: vector database, Claude drafts, human review',
      '- Voice agents: Deepgram speech and ElevenLabs voices',
      '- Deployed with Docker on Azure Kubernetes Service',
      'Tip: Offer to walk through the search pipeline in more detail.',
    ].join('\n'),
    headline: 'A document search assistant and real-time voice agents, both in production.',
    claims: [],
    meta: { type: 'behavioural', target: 'call', source: 'docs' },
    askedAt: STARTED_AT + 240_000,
    rating: null,
    reported: false,
    auto: false,
    status: 'done',
    mode: 'answer',
    error: null,
    unavailable: false,
  },
];

/** The invented transcript (the last line has fillers, as the speech engine writes them). */
const LINES: Utterance[] = [
  {
    id: 'l1',
    speaker: 'them',
    text: 'Tell me about yourself',
    final: true,
    tStart: STARTED_AT + 50_000,
    tEnd: STARTED_AT + 52_000,
  },
  {
    id: 'l2',
    speaker: 'you',
    text: 'Sure. I build AI systems',
    final: true,
    tStart: STARTED_AT + 62_000,
    tEnd: STARTED_AT + 64_000,
  },
  {
    id: 'l2b',
    speaker: 'you',
    text: 'that answer questions from documents',
    final: true,
    tStart: STARTED_AT + 65_000,
    tEnd: STARTED_AT + 68_000,
  },
  {
    id: 'l3',
    speaker: 'them',
    text: 'UM WHAT PRODUCTION GRADE APPLICATIONS HAVE YOU UH BUILT',
    final: true,
    tStart: STARTED_AT + 230_000,
    tEnd: STARTED_AT + 236_000,
  },
];

/** The live state; the commands change it. */
let index = ANSWERS.length - 1;
let scriptBar = false;
let dictating = false;

/**
 * The overlay state for the current index and switches.
 *
 * @returns The state.
 */
function state(): CompactState {
  const answer = index >= 0 ? (ANSWERS[index] ?? null) : null;
  return {
    audio: { you: true, them: true },
    // Live words as LiveAnswers makes them (transcriptChips): the fillers in the line must not show.
    chips: transcriptChips(LINES),
    lines: LINES.map((line) => ({ ...line, text: sentenceCase(line.text) })),
    answer,
    earlier: ANSWERS.filter((other) => other.id !== answer?.id)
      .reverse()
      .map((other) => ({
        id: other.id,
        question: other.cleanQuestion ?? other.question,
        headline: other.headline,
      })),
    chatTarget: 'auto',
    sessionType: 'interview',
    index,
    total: ANSWERS.length,
    answering: false,
    capturing: false,
    notice: null,
    ended: false,
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    scriptBar,
    dictationSupported: true,
    dictating,
    startedAt: STARTED_AT,
  };
}

const channel = openLiveChannel(SESSION);
/**
 * Sends the current state to the overlay.
 *
 * @returns Nothing.
 */
const publish = () => {
  channel.publish(state());
};
channel.onCommand((command) => {
  if (command.type === 'latest') index = ANSWERS.length - 1;
  else if (command.type === 'clear') index = -1;
  else if (command.type === 'prev')
    index = index === -1 ? ANSWERS.length - 1 : Math.max(0, index - 1);
  else if (command.type === 'next')
    index = index === -1 ? -1 : Math.min(ANSWERS.length - 1, index + 1);
  else if (command.type === 'show') index = ANSWERS.findIndex((answer) => answer.id === command.id);
  else if (command.type === 'script-bar') scriptBar = command.on;
  else if (command.type === 'dictate') dictating = command.on;
  publish();
});
// The overlay asks with 'hello' when it opens; publish now and then too, like a live page.
setInterval(publish, 1_000);

/** The desktop bridge (absent in a plain browser). */
const bridge = (window as unknown as { kiteDesktop?: KiteDesktopApi }).kiteDesktop;
document.body.insertAdjacentHTML(
  'beforeend',
  `<p style="font:16px sans-serif;padding:16px">Overlay rig (live page stand-in). Bridge: ${bridge ? 'yes' : 'no'}</p>`,
);
// As the real live page does when a call starts in the overlay: open it, then step aside.
void bridge?.openCompactView?.(SESSION).then(() => bridge.minimizeMainWindow?.());
