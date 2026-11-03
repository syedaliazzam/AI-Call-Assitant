/**
 * File: apps/web/tests/visual/rig-pages.tsx
 * Purpose: Two more real screens for the v1.0.4 visual checks, chosen by the path: /ask is the real
 *          Ask Kite page, to check it stays solid; /history is the real Review transcript section
 *          over saved answers that repeat a question, to check there is one entry per question and
 *          that the clean question shows. Served by overlay-rig.ts.
 * Used by: tests/visual/overlay-rig.ts (bundled); apps/desktop/tests/visual/call-window-shots.ts
 * Depends on: src/features/ask-kite/AskKitePage.tsx, src/features/review/ConversationSection.tsx
 * Architecture: docs/decisions/ADR-0040-full-call-window-and-one-entry-per-question.md
 *
 * Invented data only.
 */
import { createRoot } from 'react-dom/client';
import type { Session, StoredAnswer, StoredUtterance } from '@/core/storage/types';
import { AskKitePage } from '@/features/ask-kite/AskKitePage';
import { ConversationSection } from '@/features/review/ConversationSection';

/** An invented session. */
const SESSION: Session = {
  id: 'rig-history-session',
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
  saveTranscript: true,
  autoAnswer: false,
  createdAt: 1,
  status: 'ended',
  lastActiveAt: null,
};

/** When the invented call started. */
const AT = Date.now() - 600_000;

/** The saved lines. */
const LINES: StoredUtterance[] = [
  {
    id: 'l1',
    sessionId: SESSION.id,
    speaker: 'them',
    text: 'TELL ME ABOUT YOURSELF',
    tStart: AT,
    tEnd: AT + 2_000,
  },
  {
    id: 'l2',
    sessionId: SESSION.id,
    speaker: 'you',
    text: 'SURE I BUILD AI SYSTEMS',
    tStart: AT + 5_000,
    tEnd: AT + 8_000,
  },
  {
    id: 'l3',
    sessionId: SESSION.id,
    speaker: 'them',
    text: 'HOW WOULD YOU DESIGN A VOICE AGENT',
    tStart: AT + 60_000,
    tEnd: AT + 63_000,
  },
  {
    id: 'l4',
    sessionId: SESSION.id,
    speaker: 'you',
    text: 'I WOULD START WITH LATENCY',
    tStart: AT + 90_000,
    tEnd: AT + 94_000,
  },
];

/**
 * A saved answer.
 *
 * @param id     Its id.
 * @param after  When it was asked, in ms after the call started.
 * @param fields Its question, cleaned question and text.
 * @returns The answer.
 */
function saved(id: string, after: number, fields: Partial<StoredAnswer>): StoredAnswer {
  return {
    id,
    sessionId: SESSION.id,
    mode: 'answer',
    question: '',
    text: '',
    model: 'fast',
    msFirstToken: 900,
    msTotal: 3_000,
    createdAt: AT + after,
    rating: null,
    note: '',
    ...fields,
  };
}

/** Five saved answers for two questions: the same one three times, a near-identical one twice. */
const ANSWERS: StoredAnswer[] = [
  saved('a', 3_000, {
    question: 'TELL ME ABOUT YOURSELF? OKAY AND THEN WE CAN MOVE ON',
    text: 'First answer to the first question, which must not show.',
  }),
  saved('b', 10_000, {
    question: 'TELL ME ABOUT YOURSELF? OKAY AND THEN WE CAN MOVE ON',
    text: 'I build AI systems that answer questions from company documents.\n- Search with a vector database\n- People review what Claude drafts',
  }),
  saved('c', 64_000, {
    question: 'HOW WOULD YOU DESIGN A VOICE',
    text: 'Second answer to the second question, which must not show.',
  }),
  saved('d', 70_000, {
    question: 'HOW WOULD YOU DESIGN A VOICE AGENT',
    cleanQuestion: 'How would you design a voice agent?',
    text: 'Start from latency: speech in, Claude, speech out, under a second.\n- Streaming speech recognition\n- Interruptions stop the voice at once',
  }),
];

const root = createRoot(document.getElementById('root')!);
if (window.location.pathname.startsWith('/ask')) {
  root.render(<AskKitePage />);
} else {
  root.render(
    <div className="min-h-screen bg-ui-bg p-6 text-ui-text">
      <ConversationSection
        session={SESSION}
        lines={LINES}
        answers={ANSWERS}
        terms={[]}
        onChanged={() => undefined}
      />
    </div>,
  );
}
