/**
 * File: apps/web/src/features/dev/LatencyTest.tsx
 * Purpose: The /dev/latency panel (admins only): runs 20 answers on an invented session and
 *          call through the real client path (core/answer/latency.ts) and shows p50/p95 for key
 *          press → request sent → first word → headline complete → done, with each request's
 *          cache read and write, against the architecture §6.2 targets. "Copy results" copies
 *          the numbers as JSON (no text).
 * Used by: app/(app)/dev/latency/page.tsx
 * Depends on: src/core/answer/latency.ts, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2; day-04-answers.md Stage 11
 */
'use client';

import { useState } from 'react';
import {
  runLatencyTest,
  summarise,
  type LatencySample,
  type LatencySummary,
} from '@/core/answer/latency';
import { Button } from '@/ui/Button';

/** The §6.2 targets (p50, p95) in ms for the rows that have one. */
const TARGETS: Partial<Record<keyof Omit<LatencySummary, 'count' | 'cacheHits'>, string>> = {
  toSent: '≤ 50 / ≤ 100',
  toFirstWord: '≤ 1,000 / ≤ 1,800',
  toHeadline: '≤ 1,500 / ≤ 2,500',
};

/** The table rows: label and summary field. */
const ROWS = [
  ['Key press → request sent', 'toSent'],
  ['Key press → first word', 'toFirstWord'],
  ['Key press → headline complete', 'toHeadline'],
  ['Key press → done', 'toDone'],
  ['Server: request received → first text', 'serverToFirstText'],
] as const;

/**
 * The latency test panel.
 *
 * @returns Run button, progress, the p50/p95 table, per-request cache numbers and Copy.
 * Rendered by: app/(app)/dev/latency/page.tsx
 */
export function LatencyTest() {
  const [samples, setSamples] = useState<LatencySample[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [finished, setFinished] = useState(false);
  const summary = samples.length > 0 ? summarise(samples) : null;

  /** Runs the 20 answers. */
  const run = async () => {
    setSamples([]);
    setError(null);
    setCopied(false);
    setFinished(false);
    setRunning(true);
    try {
      await runLatencyTest({
        count: 20,
        onSample: (sample) => setSamples((current) => [...current, sample]),
      });
      setFinished(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The run failed');
    } finally {
      setRunning(false);
    }
  };

  const results = summary ? JSON.stringify({ summary, samples }, null, 1) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run 20 answers'}
        </Button>
        <span role="status" className="text-sm text-slate-600">
          {running ? `Answer ${samples.length + 1} of 20…` : finished ? 'Done: 20 answers.' : ''}
        </span>
        {error && (
          <span role="alert" className="text-sm text-red-700">
            {error}
          </span>
        )}
      </div>

      {summary && (
        <>
          <table aria-label="Latency summary" className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1">Stage (ms)</th>
                <th>p50</th>
                <th>p95</th>
                <th>Target p50 / p95</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, key]) => (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-1">{label}</td>
                  <td>{summary[key].p50}</td>
                  <td>{summary[key].p95}</td>
                  <td className="text-slate-500">{TARGETS[key] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-slate-600">
            Cache read on {summary.cacheHits} of {summary.count} answers.
          </p>
          <table aria-label="Per answer" className="w-full text-left text-xs text-slate-600">
            <thead>
              <tr>
                <th>#</th>
                <th>first word</th>
                <th>headline</th>
                <th>done</th>
                <th>cache read</th>
                <th>cache write</th>
                <th>uncached in</th>
                <th>out</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample) => (
                <tr key={sample.n}>
                  <td>{sample.n}</td>
                  <td>{sample.toFirstWord}</td>
                  <td>{sample.toHeadline}</td>
                  <td>{sample.toDone}</td>
                  <td>{sample.cacheRead}</td>
                  <td>{sample.cacheWrite}</td>
                  <td>{sample.input}</td>
                  <td>{sample.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={running}
              onClick={() => {
                navigator.clipboard
                  .writeText(results)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
            >
              {copied ? 'Copied' : 'Copy results'}
            </Button>
            <span className="text-xs text-slate-500">
              Numbers only (no question or answer text).
            </span>
          </div>
          {/* The same numbers as text, for the automated production check to read. */}
          <pre aria-label="Latency results" className="hidden">
            {finished ? results : ''}
          </pre>
        </>
      )}
    </div>
  );
}
