/**
 * File: apps/web/tests/integration/harness/review.tsx
 * Purpose: Browser side of the session review harness test (day-05 Stage 6). Seeds invented
 *          sessions into this browser's real IndexedDB (core/storage) and renders the real
 *          SessionReview for one of them, with no sign-in. Regenerate posts to the test
 *          server's mocked /api/notes. After Delete the page goes to /dashboard (the test's
 *          stand-in for the dashboard). Exposes seed, show, count and lessons on
 *          `window.kiteReviewHarness`.
 * Used by: tests/integration/review.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/review/SessionReview.tsx, src/features/settings/LearnedLessons.tsx, src/core/storage (sessions, documents,
 *             utterances, answers, notes), src/core/review/load.ts, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing);
 *               day-05-overlay-screenshots-notes.md Stage 6
 *
 * Why a harness: the review route needs a signed-in user (database, secrets), which CI does
 * not have. The harness uses the same component and storage modules. All text is invented.
 */
import { createRoot, type Root } from 'react-dom/client';
import { loadReview } from '@/core/review/load';
import { saveAnswer } from '@/core/storage/answers';
import { addDocument } from '@/core/storage/documents';
import { listLessons } from '@/core/storage/lessons';
import { saveNotes } from '@/core/storage/notes';
import { createSession } from '@/core/storage/sessions';
import { saveUtterance } from '@/core/storage/utterances';
import { SessionReview } from '@/features/review/SessionReview';
import { LearnedLessons } from '@/features/settings/LearnedLessons';

/** Which fixture to seed. */
export type ReviewFixture = 'full' | 'transcript-off';

/** What a session still has stored, counted by the test after Delete. */
export interface StoredCounts {
  /** 1 when the session exists, else 0. */
  sessions: number;
  /** Transcript lines. */
  lines: number;
  /** Answers. */
  answers: number;
  /** 1 when notes exist, else 0. */
  notes: number;
  /** Documents. */
  documents: number;
}

/** What the Playwright test calls on the page. */
export interface KiteReviewHarness {
  /** Seeds a fixture session and returns its id. */
  seed: (fixture: ReviewFixture) => Promise<string>;
  /** Renders the review of a session. */
  show: (sessionId: string) => void;
  /** Counts what is stored for a session. */
  count: (sessionId: string) => Promise<StoredCounts>;
  /** Renders Settings' "What Kite has learned" section instead (Day 5 Stage 7). */
  showLearned: () => void;
  /** Every stored lesson decision: text, scope and status (Day 5 Stage 7). */
  lessons: () => Promise<{ text: string; scope: string; status: string }[]>;
}

declare global {
  interface Window {
    /** Set by this harness when the page loads. */
    kiteReviewHarness: KiteReviewHarness;
  }
}

/** When the invented call started: 28 Oct 2026, 14:00 local time. */
const CALL_START = new Date(2026, 9, 28, 14, 0, 0).getTime();

/**
 * Seeds one invented session.
 *
 * @param fixture 'full': transcript saved, two answers (one rated down with a note), notes
 *                with a proposed lesson. 'transcript-off': "Save transcript" off, two answers,
 *                no lines and no notes.
 * @returns The session id.
 * Called from: the test, through window.kiteReviewHarness.seed
 */
async function seed(fixture: ReviewFixture): Promise<string> {
  const full = fixture === 'full';
  const session = await createSession(
    {
      type: 'sales',
      company: full ? 'Northwind Logistics (invented)' : 'Pinecrest Clinics (invented)',
      role: full ? 'Renewal call' : 'Support follow-up',
      description: full ? 'Renewal and expansion to the dispatch team.' : '',
      preferences: {
        language: 'en',
        model: 'fast',
        style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
        keyTerms: '',
      },
      instructions: '',
      saveTranscript: full,
      autoAnswer: false,
    },
    CALL_START - 3_600_000,
  );
  await addDocument({
    sessionId: session.id,
    name: 'price-list.txt',
    text: 'Professional plan: 52 dollars per seat per month, billed yearly.',
  });
  if (full) {
    const lines: ['you' | 'them', string, number][] = [
      ['you', 'THANKS FOR JOINING LET US TALK ABOUT THE RENEWAL', 5],
      ['them', 'WE WANT TO MOVE ABOUT FORTY SEATS TO PROFESSIONAL', 12],
      ['them', 'WHAT WOULD THAT COST', 24],
      ['you', 'FIFTY TWO DOLLARS PER SEAT PER MONTH BILLED YEARLY', 40],
      ['them', 'OKAY SEND ME A PROPOSAL AND I WILL TAKE IT TO FINANCE', 95],
      ['you', 'I WILL SEND THE PROPOSAL BY MONDAY', 103],
    ];
    for (const [i, [speaker, text, at]] of lines.entries()) {
      await saveUtterance({
        id: `${session.id}-l${i}`,
        sessionId: session.id,
        speaker,
        text,
        tStart: CALL_START + at * 1_000,
        tEnd: CALL_START + at * 1_000 + 2_000,
      });
    }
  }
  await saveAnswer({
    id: `${session.id}-a1`,
    sessionId: session.id,
    mode: 'answer',
    question: 'What would forty seats on Professional cost?',
    text: '52 dollars per seat per month.\n- Billed yearly',
    model: 'fast',
    msFirstToken: 700,
    msTotal: 1_400,
    createdAt: CALL_START + 26_000,
    rating: 'down',
    note: 'Give the monthly and yearly totals for 40 seats.',
  });
  await saveAnswer({
    id: `${session.id}-a2`,
    sessionId: session.id,
    mode: 'chat',
    question: 'When does onboarding start?',
    text: 'Onboarding starts the week after signing.\n- Two sessions',
    model: 'fast',
    msFirstToken: 650,
    msTotal: 1_300,
    createdAt: CALL_START + 60_000,
    rating: 'up',
    note: '',
  });
  if (full) {
    await saveNotes({
      sessionId: session.id,
      callStartedAt: CALL_START,
      createdAt: CALL_START + 200_000,
      fromAnswersOnly: false,
      notes: {
        summary: [
          'Northwind wants to move about 40 seats to the Professional plan.',
          'Price given: 52 dollars per seat per month, billed yearly.',
        ],
        questions: [
          { question: 'What would 40 seats cost?', at: 24, answered: 'partly', rating: 'down' },
        ],
        nextSteps: [
          { step: 'Send the proposal by Monday', owner: 'You' },
          { step: 'Take the proposal to finance', owner: 'Them' },
        ],
        unclear: [{ from: 60, to: 84, reason: 'Garbled audio' }],
        lessons: [
          {
            text: 'Give monthly and yearly totals for the seat count they mention.',
            evidence: 'The 40-seat price answer was rated down with that note.',
          },
          {
            text: 'Mention the onboarding fee with every price.',
            evidence: 'Invented: no answer was rated for this.',
          },
        ],
      },
    });
  }
  return session.id;
}

/** The React root, created on first show. */
let root: Root | null = null;

window.kiteReviewHarness = {
  seed,
  show: (sessionId) => {
    root ??= createRoot(document.getElementById('root')!);
    root.render(
      <SessionReview
        key={sessionId}
        sessionId={sessionId}
        onDeleted={() => window.location.assign('/dashboard')}
      />,
    );
  },
  count: async (sessionId) => {
    const review = await loadReview(sessionId);
    return {
      sessions: review ? 1 : 0,
      lines: review?.lines.length ?? 0,
      answers: review?.answers.length ?? 0,
      notes: review?.notes ? 1 : 0,
      documents: review?.documents.length ?? 0,
    };
  },
  showLearned: () => {
    root ??= createRoot(document.getElementById('root')!);
    root.render(
      <div className="mx-auto max-w-3xl p-8">
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-900">What Kite has learned</h2>
          <LearnedLessons />
        </section>
      </div>,
    );
  },
  lessons: async () =>
    (await listLessons()).map(({ text, scope, status }) => ({ text, scope, status })),
};
