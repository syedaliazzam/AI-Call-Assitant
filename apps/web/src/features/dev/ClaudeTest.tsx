/**
 * File: apps/web/src/features/dev/ClaudeTest.tsx
 * Purpose: Admin test screen for the Claude connection: streams a 'hello' reply and records the
 *          timings and token counts of every click, so streaming and prompt caching can be checked
 *          and first-word times written into docs/testing/benchmark-results.md. "Warm with
 *          session" (Day 3 Stage 5) sends two warm-ups for a session on this computer and shows
 *          the cache write of the first and the cache read of the second.
 * Used by: app/(app)/dev/claude-test/page.tsx
 * Depends on: src/core/answer/answerClient.ts, src/core/answer/warm.ts,
 *             src/core/storage (sessions, documents), src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (latency), §6.3 (caching)
 *
 * Session and document text goes only to /api/answer; this page shows token counts and times.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { streamAnswer, type AnswerDone } from '@/core/answer/answerClient';
import { warmSession } from '@/core/answer/warm';
import { listDocuments } from '@/core/storage/documents';
import { listSessions } from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { Button } from '@/ui/Button';

/** One finished click, shown as a row in the results table. */
interface RunRow {
  /** 1, 2, 3, … in click order. */
  number: number;
  /** Timings and usage of the reply. */
  result: AnswerDone;
}

/** One warm-up, shown as a row in the warm-up table. */
interface WarmRow {
  /** 1, 2, 3, … in the order sent. */
  number: number;
  /** Which session it warmed (shown as company · role). */
  label: string;
  /** Its usage and timings, or null when it failed. */
  result: AnswerDone | null;
}

/**
 * The Claude streaming test.
 *
 * @returns The test panel: buttons, streamed text, error line and results table.
 * Rendered by: app/(app)/dev/claude-test/page.tsx
 */
export function ClaudeTest() {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  // Warm with session: the sessions on this computer, the chosen one, and the warm-ups sent.
  const [sessions, setSessions] = useState<Session[]>([]);
  const [warmId, setWarmId] = useState('');
  const [warming, setWarming] = useState(false);
  const [warms, setWarms] = useState<WarmRow[]>([]);

  useEffect(() => {
    listSessions()
      .then((found) => {
        setSessions(found);
        setWarmId((current) => current || (found[0]?.id ?? ''));
      })
      .catch(() => setSessions([]));
  }, []);

  // Stop a running request if the admin leaves the page.
  useEffect(() => () => cancelRef.current?.(), []);

  /** Starts one 'hello' request and streams its text into the panel. */
  function ask() {
    setText('');
    setError(null);
    setRunning(true);
    const { cancel } = streamAnswer(
      { mode: 'hello' },
      {
        onDelta: (piece) => setText((current) => current + piece),
        onDone: (result) => {
          setRuns((current) => [...current, { number: current.length + 1, result }]);
          setRunning(false);
        },
        onError: (failure) => {
          setError(`${failure.message} (${failure.code})`);
          setRunning(false);
        },
      },
    );
    cancelRef.current = cancel;
  }

  /**
   * Sends two warm-ups for the chosen session, one after the other: the first should write the
   * cache (cache write > 0), the second should read it (cache read > 0).
   */
  async function warmTwice() {
    const session = sessions.find((candidate) => candidate.id === warmId);
    if (!session) return;
    setWarming(true);
    const documents = await listDocuments(session.id).catch(() => []);
    const label = `${session.company || 'Untitled'} · ${session.role || session.type}`;
    for (let i = 0; i < 2; i += 1) {
      const result = await warmSession(session, documents);
      setWarms((current) => [...current, { number: current.length + 1, label, result }]);
    }
    setWarming(false);
  }

  /** Stops the running request. */
  function cancel() {
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(false);
    setError('Cancelled.');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <Button onClick={ask} disabled={running}>
          {running ? 'Asking…' : 'Ask Claude'}
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={!running}>
          Cancel
        </Button>
      </div>

      <section
        aria-live="polite"
        className="min-h-20 border border-ui-border rounded-control bg-ui-surface p-4 text-ui-heading"
      >
        {text || <span className="text-ui-muted">The reply streams here.</span>}
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-control bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-danger"
        >
          {error}
        </p>
      )}

      <p className="text-[13px] text-ui-muted">
        The first click writes the prompt to Claude&apos;s cache (cache write &gt; 0). Clicks within
        5 minutes of the previous one should read it back (cache read &gt; 0) and usually reach the
        first word sooner. Browser times include the network; server times start when the request
        reached the server. The server&apos;s first word splits into: sign-in check (Auth), reaching
        Claude (To Claude open, which includes Auth) and Claude&apos;s own time to the first token
        (Open → text).
      </p>

      <div className="overflow-x-auto border border-ui-border bg-ui-surface">
        <table className="w-full text-right text-[13px]">
          <thead className="border-b border-ui-border bg-ui-band text-[13px] text-ui-muted">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">First word (browser)</th>
              <th className="px-3 py-2 font-semibold">Total (browser)</th>
              <th className="px-3 py-2 font-semibold">First word (server)</th>
              <th className="px-3 py-2 font-semibold">Auth</th>
              <th className="px-3 py-2 font-semibold">To Claude open</th>
              <th className="px-3 py-2 font-semibold">Open → text</th>
              <th className="px-3 py-2 font-semibold">Input</th>
              <th className="px-3 py-2 font-semibold">Output</th>
              <th className="px-3 py-2 font-semibold">Cache write</th>
              <th className="px-3 py-2 font-semibold">Cache read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ui-border tabular-nums">
            {runs.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-4 text-center text-ui-muted">
                  No runs yet.
                </td>
              </tr>
            )}
            {runs.map(({ number, result }) => (
              <tr key={number}>
                <td className="px-3 py-2 text-left">{number}</td>
                <td className="px-3 py-2 font-semibold">{result.msToFirstText} ms</td>
                <td className="px-3 py-2">{result.msTotal} ms</td>
                <td className="px-3 py-2">{result.serverMs.toFirstText} ms</td>
                <td className="px-3 py-2">{result.serverMs.auth} ms</td>
                <td className="px-3 py-2">{result.serverMs.toStreamOpen} ms</td>
                <td className="px-3 py-2">{result.serverMs.streamOpenToFirstText} ms</td>
                <td className="px-3 py-2">{result.usage.input_tokens}</td>
                <td className="px-3 py-2">{result.usage.output_tokens}</td>
                <td className="px-3 py-2">{result.usage.cache_creation_input_tokens}</td>
                <td className="px-3 py-2">{result.usage.cache_read_input_tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ui-heading">Warm with session</h2>
        <p className="text-[13px] text-ui-muted">
          Sends mode &quot;warm&quot; (max_tokens 0, no answer) twice for a session on this
          computer, with its details and documents. The first warm-up writes the cache (cache write
          &gt; 0); the second, within 5 minutes, reads it (cache read &gt; 0). A session whose
          prompt is under 512 tokens (no documents, few details) is not cached at all: both show 0.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="warm-session" className="text-[13px] text-ui-text">
            Session
          </label>
          <select
            id="warm-session"
            value={warmId}
            disabled={warming || sessions.length === 0}
            onChange={(event) => setWarmId(event.target.value)}
            className="h-9 max-w-md border border-ui-border rounded-control bg-ui-surface px-2 text-[13px]"
          >
            {sessions.length === 0 && <option value="">No sessions on this computer</option>}
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.company || 'Untitled'} · {session.role || session.type}
              </option>
            ))}
          </select>
          <Button onClick={() => void warmTwice()} disabled={warming || !warmId}>
            {warming ? 'Warming…' : 'Warm twice'}
          </Button>
        </div>
        <div className="overflow-x-auto border border-ui-border bg-ui-surface">
          <table className="w-full text-right text-[13px]">
            <thead className="border-b border-ui-border bg-ui-band text-[13px] text-ui-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Session</th>
                <th className="px-3 py-2 font-semibold">Total (browser)</th>
                <th className="px-3 py-2 font-semibold">Total (server)</th>
                <th className="px-3 py-2 font-semibold">Input</th>
                <th className="px-3 py-2 font-semibold">Output</th>
                <th className="px-3 py-2 font-semibold">Cache write</th>
                <th className="px-3 py-2 font-semibold">Cache read</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ui-border tabular-nums">
              {warms.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-ui-muted">
                    No warm-ups yet.
                  </td>
                </tr>
              )}
              {warms.map(({ number, label, result }) => (
                <tr key={number}>
                  <td className="px-3 py-2 text-left">{number}</td>
                  <td className="px-3 py-2 text-left">{label}</td>
                  {result ? (
                    <>
                      <td className="px-3 py-2">{result.msTotal} ms</td>
                      <td className="px-3 py-2">{result.serverMs.total} ms</td>
                      <td className="px-3 py-2">{result.usage.input_tokens}</td>
                      <td className="px-3 py-2">{result.usage.output_tokens}</td>
                      <td className="px-3 py-2 font-semibold">
                        {result.usage.cache_creation_input_tokens}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {result.usage.cache_read_input_tokens}
                      </td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-3 py-2 text-left text-ui-danger">
                      Failed (the browser console shows the error code).
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
