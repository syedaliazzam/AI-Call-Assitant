/**
 * File: apps/web/src/features/dev/ClaudeTest.tsx
 * Purpose: Admin test screen for the Claude connection: streams a 'hello' reply and records the
 *          timings and token counts of every click, so streaming and prompt caching can be checked
 *          and first-word times written into docs/testing/benchmark-results.md.
 * Used by: app/(app)/dev/claude-test/page.tsx
 * Depends on: src/core/answer/answerClient.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (latency), §6.3 (caching)
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { streamAnswer, type AnswerDone } from '@/core/answer/answerClient';
import { Button } from '@/ui/Button';

/** One finished click, shown as a row in the results table. */
interface RunRow {
  /** 1, 2, 3, … in click order. */
  number: number;
  /** Timings and usage of the reply. */
  result: AnswerDone;
}

/**
 * The Claude streaming test.
 *
 * @returns The test panel: buttons, streamed text, error line and results table.
 */
export function ClaudeTest() {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);

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
        className="min-h-20 rounded-lg border border-slate-200 bg-white p-4 text-slate-900"
      >
        {text || <span className="text-slate-400">The reply streams here.</span>}
      </section>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="text-sm text-slate-500">
        The first click writes the prompt to Claude&apos;s cache (cache write &gt; 0). Clicks within
        5 minutes of the previous one should read it back (cache read &gt; 0) and usually reach the
        first word sooner. Browser times include the network; server times start when the request
        reached the server. The server&apos;s first word splits into: sign-in check (Auth), reaching
        Claude (To Claude open, which includes Auth) and Claude&apos;s own time to the first token
        (Open → text).
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 font-medium">First word (browser)</th>
              <th className="px-3 py-2 font-medium">Total (browser)</th>
              <th className="px-3 py-2 font-medium">First word (server)</th>
              <th className="px-3 py-2 font-medium">Auth</th>
              <th className="px-3 py-2 font-medium">To Claude open</th>
              <th className="px-3 py-2 font-medium">Open → text</th>
              <th className="px-3 py-2 font-medium">Input</th>
              <th className="px-3 py-2 font-medium">Output</th>
              <th className="px-3 py-2 font-medium">Cache write</th>
              <th className="px-3 py-2 font-medium">Cache read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {runs.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-4 text-center text-slate-400">
                  No runs yet.
                </td>
              </tr>
            )}
            {runs.map(({ number, result }) => (
              <tr key={number}>
                <td className="px-3 py-2 text-left">{number}</td>
                <td className="px-3 py-2 font-medium">{result.msToFirstText} ms</td>
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
    </div>
  );
}
