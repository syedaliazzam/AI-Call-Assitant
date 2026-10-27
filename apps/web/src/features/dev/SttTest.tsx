/**
 * File: apps/web/src/features/dev/SttTest.tsx
 * Purpose: Admin test screen for the speech-to-text spike (ADR-0020): loads a candidate model,
 *          transcribes the microphone live (grey partial line, final lines), shows load time,
 *          real-time factor and lag, and scores the 3 fixed test sentences with a rough word
 *          error rate. A hotwords box boosts names during decoding. "Copy results" copies the
 *          numbers for benchmark-results.md.
 * Used by: app/(app)/dev/stt-test/page.tsx
 * Depends on: src/core/stt/sttClient.ts, src/core/stt/models.ts, src/core/stt/metrics.ts,
 *             src/core/stt/wer.ts, src/core/stt/hotwords.ts, src/platform (getDesktopInfo, label only), src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (speech → partial text), §12 Day 1
 *
 * Transcript text stays in this page's memory only; it is never logged or sent anywhere.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { formatHotwords } from '@/core/stt/hotwords';
import { median } from '@/core/stt/metrics';
import { STT_MODELS, type SttModelId } from '@/core/stt/models';
import type { EndpointReason, LiveStats, LoadStats } from '@/core/stt/protocol';
import { clearModelCache, startMicTranscription, type Transcription } from '@/core/stt/sttClient';
import { wordErrorRate, type WerResult } from '@/core/stt/wer';
import { getDesktopInfo } from '@/platform';
import { Button } from '@/ui/Button';

/** The 3 fixed accuracy sentences (numbers written the way they are spoken). */
export const TEST_SENTENCES: readonly string[] = [
  'Thanks for joining the call today, we would like to renew the contract before the end of the month.',
  'The professional plan costs fifty two dollars per seat per month for one hundred and fifty seats.',
  'Bluefin Route sends the weekly delivery report to Northwind Logistics every Monday at nine thirty.',
];

/**
 * Hotwords prefilled for the accuracy test: the two names in sentence 3, one phrase per line
 * with a boost score. Day 3: the live page builds this list from the session's details and
 * documents (participant and company names, product terms) instead of a text box.
 */
export const TEST_HOTWORDS = ['Bluefin Route :2', 'Northwind Logistics :2'].join('\n');

/** One final line on screen. */
interface FinalLine {
  /** Transcript text (page memory only). */
  text: string;
  /** Which rule ended the utterance. */
  reason: EndpointReason;
}

/** Page states. */
type Phase = 'idle' | 'loading' | 'listening' | 'stopped';

/**
 * Formats a number of milliseconds as "1,234 ms", or "–" when unknown.
 *
 * @param ms Milliseconds or null.
 * @returns Display text.
 */
function formatMs(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '–' : `${Math.round(ms).toLocaleString('en-US')} ms`;
}

/**
 * The speech-to-text test panel.
 *
 * @returns The panel.
 */
export function SttTest() {
  const [modelId, setModelId] = useState<SttModelId>('zipformer-en-2023-06-21');
  const [hotwordsText, setHotwordsText] = useState(TEST_HOTWORDS);
  // The hotwords the current model was loaded with (they apply from Start until Stop).
  const [hotwordsUsed, setHotwordsUsed] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ file: string; loaded: number; total: number } | null>(
    null,
  );
  const [loads, setLoads] = useState<LoadStats[]>([]);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [partial, setPartial] = useState('');
  const [finals, setFinals] = useState<FinalLine[]>([]);
  // Accuracy: which sentence is being read, and the final lines heard for each sentence.
  const [sentence, setSentence] = useState<number | null>(null);
  const [heard, setHeard] = useState<string[]>(['', '', '']);
  const sentenceRef = useRef<number | null>(null);
  const transcription = useRef<Transcription | null>(null);

  // Stop the microphone and worker when leaving the page.
  useEffect(() => () => transcription.current?.stop(), []);

  /** Loads the chosen model and starts listening. */
  async function start() {
    setError(null);
    setPhase('loading');
    setPartial('');
    setStats(null);
    setHotwordsUsed(hotwordsText);
    try {
      transcription.current = await startMicTranscription(
        modelId,
        {
          onProgress: (file, loaded, total) => setProgress({ file, loaded, total }),
          onReady: (load) => {
            setLoads((current) => [...current, load]);
            setProgress(null);
          },
          onPartial: setPartial,
          onFinal: (text, reason) => {
            setFinals((current) => [...current, { text, reason }]);
            const index = sentenceRef.current;
            if (index !== null) {
              setHeard((current) =>
                current.map((value, i) => (i === index ? `${value} ${text}`.trim() : value)),
              );
            }
          },
          onStats: setStats,
          onError: (message) => setError(message),
        },
        { hotwords: hotwordsText },
      );
      setPhase('listening');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start');
      setPhase('idle');
    }
  }

  /** Stops listening (keeps the results on screen). */
  function stop() {
    transcription.current?.stop();
    transcription.current = null;
    setPhase('stopped');
  }

  /** Chooses which test sentence the next final lines belong to (clears its earlier result). */
  function chooseSentence(index: number) {
    sentenceRef.current = index;
    setSentence(index);
    setHeard((current) => current.map((value, i) => (i === index ? '' : value)));
  }

  /** Removes the cached model files so the next start measures a first (network) load. */
  async function clearCache() {
    const existed = await clearModelCache();
    setError(existed ? 'Model cache cleared.' : 'No model cache to clear.');
  }

  const scores: (WerResult | null)[] = TEST_SENTENCES.map((reference, i) =>
    heard[i] ? wordErrorRate(reference, heard[i] ?? '') : null,
  );
  const lagMedian = median(stats?.lagsMs ?? []);
  const hotwordsPreview = formatHotwords(hotwordsText);
  const hotwordsLoaded = formatHotwords(hotwordsUsed).hotwords;
  const desktop = getDesktopInfo();
  const where = desktop ? `Desktop app v${desktop.version} (${desktop.os})` : 'Browser';

  /** Builds the results text (numbers, plus what was heard for the test sentences). */
  function resultsText(): string {
    const lines = [
      `Where: ${where}; user agent: ${navigator.userAgent}`,
      `Model: ${modelId}; decoding modified_beam_search; hotwords: ${hotwordsLoaded.length} (scores ${hotwordsLoaded.map((hotword) => hotword.score).join(', ') || '–'})`,
      ...loads.map(
        (load, i) =>
          `Load ${i + 1} (${load.fromCache ? 'cache' : 'network'}): total ${load.totalMs} ms = download ${load.downloadMs} + runtime ${load.runtimeInitMs} + model ${load.modelInitMs}; ${(load.bytes / 1e6).toFixed(1)} MB`,
      ),
      stats
        ? `RTF ${stats.rtf.toFixed(3)} over ${(stats.audioMs / 1000).toFixed(1)} s audio; chunk avg ${stats.chunkMsAvg.toFixed(1)} ms, max ${stats.chunkMsMax.toFixed(1)} ms; input ${stats.inputSampleRate} Hz`
        : 'RTF: no audio yet',
      `Lag to first partial (ms): ${(stats?.lagsMs ?? []).join(', ') || '–'}; median ${formatMs(lagMedian)}`,
      `Utterances ended by: model rule ${stats?.endpoints.model ?? 0}, pause rule ${stats?.endpoints.pause ?? 0}`,
      ...TEST_SENTENCES.map((_, i) => {
        const score = scores[i];
        return score
          ? `Sentence ${i + 1}: WER ${(score.wer * 100).toFixed(0)}% (${score.substitutions} sub, ${score.deletions} del, ${score.insertions} ins / ${score.referenceWords}); heard: "${heard[i]}"`
          : `Sentence ${i + 1}: not read`;
      }),
    ];
    return lines.join('\n');
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="stt-model" className="text-sm font-medium text-slate-800">
            Model
          </label>
          <select
            id="stt-model"
            value={modelId}
            disabled={phase === 'loading' || phase === 'listening'}
            onChange={(event) => setModelId(event.target.value as SttModelId)}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            {STT_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={start} disabled={phase === 'loading' || phase === 'listening'}>
          {phase === 'loading' ? 'Loading…' : 'Start'}
        </Button>
        <Button variant="secondary" onClick={stop} disabled={phase !== 'listening'}>
          Stop
        </Button>
        <Button
          variant="ghost"
          onClick={clearCache}
          disabled={phase === 'loading' || phase === 'listening'}
        >
          Clear model cache
        </Button>
        <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(resultsText())}>
          Copy results
        </Button>
        <span className="text-xs text-slate-500">{where}</span>
      </section>

      <section className="flex flex-col gap-1">
        <label htmlFor="stt-hotwords" className="text-sm font-medium text-slate-800">
          Hotwords (one phrase per line, optional boost score after &quot; :&quot;; applied at
          Start)
        </label>
        <textarea
          id="stt-hotwords"
          rows={3}
          value={hotwordsText}
          disabled={phase === 'loading' || phase === 'listening'}
          onChange={(event) => setHotwordsText(event.target.value)}
          className="max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
        />
        <p className="text-xs text-slate-500">
          {hotwordsPreview.hotwords.length === 0
            ? 'No hotwords: plain beam search.'
            : `Sent to the model: ${hotwordsPreview.hotwords.map((hotword) => `${hotword.phrase} (${hotword.score})`).join(', ')}`}
          {hotwordsPreview.skippedLines.length > 0 &&
            `; skipped line ${hotwordsPreview.skippedLines.join(', ')} (no letters or bad score)`}
        </p>
      </section>

      {progress && (
        <p className="text-sm text-slate-600">
          Loading {progress.file}: {(progress.loaded / 1e6).toFixed(1)} /{' '}
          {(progress.total / 1e6).toFixed(1)} MB
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </p>
      )}

      <section
        aria-live="polite"
        className="min-h-32 rounded-lg border border-slate-200 bg-white p-4 text-slate-900"
      >
        {finals.map((line, i) => (
          <p key={i}>
            {line.text}{' '}
            <span className="text-xs text-slate-400" title="Which rule ended this utterance">
              · {line.reason}
            </span>
          </p>
        ))}
        <p className="text-slate-400">
          {partial || (phase === 'listening' ? 'Listening…' : 'Press Start and speak.')}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Loading</h2>
          {loads.length === 0 && <p className="text-slate-400">Not loaded yet.</p>}
          <ul className="flex flex-col gap-1 tabular-nums">
            {loads.map((load, i) => (
              <li key={i}>
                Load {i + 1} ({load.fromCache ? 'cache' : 'network'}):{' '}
                <strong>{formatMs(load.totalMs)}</strong> = download {formatMs(load.downloadMs)} +
                runtime {formatMs(load.runtimeInitMs)} + model {formatMs(load.modelInitMs)};{' '}
                {(load.bytes / 1e6).toFixed(1)} MB
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm tabular-nums">
          <h2 className="mb-2 font-semibold text-slate-900">Live</h2>
          <p>
            Real-time factor: <strong>{stats ? stats.rtf.toFixed(3) : '–'}</strong> (below 0.5
            needed; also the share of one CPU core)
          </p>
          <p>
            Chunk time: avg {stats ? stats.chunkMsAvg.toFixed(1) : '–'} ms, max{' '}
            {stats ? stats.chunkMsMax.toFixed(1) : '–'} ms (per 100 ms of audio)
          </p>
          <p>
            Lag, speech → first partial: <strong>{formatMs(lagMedian)}</strong> median (
            {(stats?.lagsMs ?? []).join(', ') || 'no utterances yet'})
          </p>
          <p>
            Utterances ended by: model rule {stats?.endpoints.model ?? 0}, pause rule{' '}
            {stats?.endpoints.pause ?? 0}
          </p>
          <p>
            Audio: {stats ? (stats.audioMs / 1000).toFixed(1) : '–'} s at input{' '}
            {stats?.inputSampleRate ?? '–'} Hz
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold text-slate-900">Accuracy test</h2>
        <p className="mb-3 text-slate-500">
          Click a sentence, pause for a second, read it aloud at normal speed, then pause until it
          appears as a final line. Lag is measured from the start of each utterance after a pause.
        </p>
        <ol className="flex flex-col gap-3">
          {TEST_SENTENCES.map((reference, i) => {
            const score = scores[i];
            return (
              <li
                key={i}
                className={`rounded-md border p-3 ${sentence === i ? 'border-brand-600' : 'border-slate-200'}`}
              >
                <button
                  type="button"
                  onClick={() => chooseSentence(i)}
                  className="text-left font-medium text-slate-900"
                >
                  {i + 1}. {reference}
                </button>
                {score && (
                  <div className="mt-2">
                    <p className="tabular-nums">
                      WER <strong>{(score.wer * 100).toFixed(0)}%</strong> ({score.substitutions}{' '}
                      substituted, {score.deletions} missed, {score.insertions} extra of{' '}
                      {score.referenceWords} words)
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {score.alignment.map((step, j) => (
                        <span
                          key={j}
                          className={
                            step.type === 'ok'
                              ? 'text-slate-700'
                              : step.type === 'sub'
                                ? 'rounded bg-amber-100 px-1 text-amber-900'
                                : step.type === 'del'
                                  ? 'rounded bg-red-100 px-1 text-red-800 line-through'
                                  : 'rounded bg-sky-100 px-1 text-sky-900'
                          }
                          title={step.type}
                        >
                          {step.type === 'sub'
                            ? `${step.ref}→${step.hyp}`
                            : step.type === 'ins'
                              ? `+${step.hyp}`
                              : step.ref}
                        </span>
                      ))}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
