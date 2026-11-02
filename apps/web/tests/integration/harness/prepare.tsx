/**
 * File: apps/web/tests/integration/harness/prepare.tsx
 * Purpose: Browser side of the Prepare tools harness test (parity Phase 4). Renders the real
 *          MockInterview and QuestionBank against this browser's real IndexedDB, with no sign-in.
 *          The speech engine, microphone and voice are stand-ins the test controls: it says what
 *          was "heard", and can see that the microphone opens only after a question has been read.
 *          Exposes helpers on `window.kitePrepareHarness`.
 * Used by: tests/integration/prepare.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/prepare (MockInterview, QuestionBank), src/core/storage (sessions,
 *             utterances, notes, questionBanks), react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); ADR-0029
 *
 * All text is invented.
 */
import { createRoot } from 'react-dom/client';
import { getNotes } from '@/core/storage/notes';
import { getQuestionBank } from '@/core/storage/questionBanks';
import { createSessionWithDocuments, listSessions } from '@/core/storage/sessions';
import type { SessionType } from '@/core/storage/types';
import { listUtterances } from '@/core/storage/utterances';
import type { SttEngineOptions } from '@/core/stt/sttEngine';
import { MockInterview } from '@/features/prepare/MockInterview';
import { QuestionBank } from '@/features/prepare/QuestionBank';

/** What the test can do on this page. */
export interface PrepareHarness {
  /** Stores an invented session; returns its id. */
  seed: (type: SessionType, company: string, role: string) => Promise<string>;
  /** Shows the Mock Interview page. */
  showMock: (options?: { micFails?: boolean }) => void;
  /** Shows the Question Bank page. */
  showBank: () => void;
  /** Says a final line, as the speech engine would. */
  hear: (text: string) => void;
  /** Says words still being heard. */
  hearPartial: (text: string) => void;
  /** Sets a final line to arrive only when the channel is stopped (the last words of an answer). */
  hearOnDetach: (text: string) => void;
  /** What has happened, in order: 'speak:<text>', 'attach', 'detach', 'stop'. */
  events: () => string[];
  /** The stored sessions, newest first. */
  sessions: () => Promise<{ id: string; type: string; status: string; company: string }[]>;
  /** A session's saved lines. */
  lines: (id: string) => Promise<{ speaker: string; text: string }[]>;
  /** A session's AI notes summary. */
  summary: (id: string) => Promise<string[]>;
  /** How many questions a session's saved bank holds. */
  bankSize: (id: string) => Promise<number>;
}

declare global {
  interface Window {
    /** See PrepareHarness. */
    kitePrepareHarness: PrepareHarness;
  }
}

const root = createRoot(document.getElementById('root')!);
const events: string[] = [];
let engineOptions: SttEngineOptions | null = null;
let onDetach = '';
let renders = 0;

/**
 * Sends a final line to the page.
 *
 * @param text The line.
 */
function final(text: string) {
  engineOptions?.onFinal?.({ channel: 'you', text, tStart: 0, tEnd: 0 } as never);
}

window.kitePrepareHarness = {
  seed: async (type, company, role) =>
    (
      await createSessionWithDocuments(
        {
          type,
          company,
          role,
          description: 'Build reports with SQL (invented).',
          preferences: {
            language: 'en',
            model: 'fast',
            style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
            keyTerms: '',
          },
          instructions: '',
          saveTranscript: true,
          autoAnswer: false,
        },
        [{ name: 'resume.txt', text: 'Four years of SQL (invented).', kind: 'resume' }],
      )
    ).id,
  showMock: (options = {}) => {
    renders += 1;
    root.render(
      <MockInterview
        key={renders}
        deps={{
          speak: async (text) => {
            events.push(`speak:${text}`);
            return true;
          },
          getMic: async () => {
            if (options.micFails) throw new Error('denied');
            return new MediaStream();
          },
          createEngine: (engine) => {
            engineOptions = engine;
            return {
              attach: async () => {
                events.push('attach');
              },
              detach: () => {
                events.push('detach');
                if (onDetach) final(onDetach);
                onDetach = '';
              },
              drain: async () => undefined,
              stop: () => {
                events.push('stop');
              },
            };
          },
        }}
      />,
    );
  },
  showBank: () => {
    renders += 1;
    root.render(<QuestionBank key={renders} />);
  },
  hear: final,
  hearPartial: (text) => {
    engineOptions?.onPartial?.({ channel: 'you', text, tStart: 0 } as never);
  },
  hearOnDetach: (text) => {
    onDetach = text;
  },
  events: () => [...events],
  sessions: async () =>
    (await listSessions()).map(({ id, type, status, company }) => ({ id, type, status, company })),
  lines: async (id) => (await listUtterances(id)).map(({ speaker, text }) => ({ speaker, text })),
  summary: async (id) => (await getNotes(id))?.notes.summary ?? [],
  bankSize: async (id) =>
    ((await getQuestionBank(id))?.groups ?? []).reduce(
      (total, group) => total + group.questions.length,
      0,
    ),
};
