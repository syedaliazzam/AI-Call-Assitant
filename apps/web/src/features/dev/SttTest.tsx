/**
 * File: apps/web/src/features/dev/SttTest.tsx
 * Purpose: Admin test screen for the speech-to-text engine (ADR-0020): loads the model with a
 *          progress bar, transcribes up to two channels at once ("You" = microphone, "Them" =
 *          the official test recordings played in a loop, or the real call audio through the
 *          platform adapter: system sound in the desktop app, a shared tab in the browser), and
 *          shows load time, per-channel and combined real-time factor, lag, end of speech →
 *          final line latency (p50/p95), WebAssembly memory, the engine's health, and the word
 *          error rate on the 3 fixed test sentences (each and overall). "Copy results" copies the
 *          numbers for benchmark-results.md.
 * Used by: app/(app)/dev/stt-test/page.tsx
 * Depends on: src/core/stt/sttEngine.ts, src/core/stt/models.ts, src/core/stt/metrics.ts,
 *             src/core/stt/wer.ts, src/core/stt/hotwords.ts, src/core/stt/health.ts,
 *             src/core/stt/download.ts, src/core/audio/recordingStream.ts,
 *             src/platform (getPlatform, getDesktopInfo), src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.2 (speech → partial text), §12 Day 2
 *
 * Transcript text stays in this page's memory only; it is never logged or sent anywhere.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { createRecordingStream, type RecordingStream } from '@/core/audio/recordingStream';
import { clearSttCache, type DownloadProgress } from '@/core/stt/download';
import {
  healthMessage,
  healthTone,
  SttHealthMonitor,
  type SttHealthStatus,
} from '@/core/stt/health';
import { formatHotwords } from '@/core/stt/hotwords';
import { median, percentile } from '@/core/stt/metrics';
import {
  DEFAULT_STT_MODEL,
  getSttModel,
  modelDownloadBytes,
  TEST_RECORDINGS,
  testRecordingUrl,
} from '@/core/stt/models';
import type { ChannelId, EndpointReason, EngineStats, LoadStats } from '@/core/stt/protocol';
import { buildModelSource, createSttEngine, type SttEngine } from '@/core/stt/sttEngine';
import { wordErrorRate, type WerResult } from '@/core/stt/wer';
import { CaptureError, getDesktopInfo, getPlatform, type OtherSideSource } from '@/platform';
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

/** Display names of the channels. */
const CHANNEL_LABEL: Record<ChannelId, string> = { you: 'You', them: 'Them' };

/** Where the "Them" channel's audio comes from on this page. */
type ThemSource = 'off' | 'recordings' | 'call';

/** How the page describes each real-call source. */
const CALL_SOURCE_LABEL: Record<OtherSideSource, string> = {
  'system-loopback': "this computer's sound (desktop app)",
  'tab-audio': 'the shared tab',
  'screen-audio': 'the shared screen or window',
};

/** One final line on screen. */
interface FinalLine {
  /** Which channel. */
  channel: ChannelId;
  /** Transcript text (page memory only). */
  text: string;
  /** Which rule ended the utterance. */
  reason: EndpointReason;
  /** End of speech → this line reached the page, in ms. */
  latencyMs: number;
}

/** Page states. */
type Phase = 'idle' | 'loading' | 'listening' | 'stopped';

/**
 * Formats milliseconds as "1,234 ms", or "–" when unknown.
 *
 * @param ms Milliseconds or null.
 * @returns Display text.
 */
function formatMs(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '–' : `${Math.round(ms).toLocaleString('en-US')} ms`;
}

/**
 * "p50 / p95 (n)" for a list of latencies.
 *
 * @param values Latencies in ms.
 * @returns Display text, or "–" for none.
 */
function latencySummary(values: readonly number[]): string {
  if (values.length === 0) return '–';
  return `p50 ${formatMs(median(values))} / p95 ${formatMs(percentile(values, 95))} (n=${values.length})`;
}

/**
 * Formats bytes as megabytes with one decimal.
 *
 * @param bytes Bytes.
 * @returns For example "204.1 MB".
 */
function formatMb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * The speech-to-text test panel.
 *
 * @returns The panel.
 */
export function SttTest() {
  const model = getSttModel(DEFAULT_STT_MODEL);
  const source = buildModelSource();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [loads, setLoads] = useState<LoadStats[]>([]);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [health, setHealth] = useState<SttHealthStatus>('ok');
  const [partials, setPartials] = useState<Record<ChannelId, string>>({ you: '', them: '' });
  const [finals, setFinals] = useState<FinalLine[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [themSource, setThemSource] = useState<ThemSource>('off');
  // Where the real call audio comes from, once captured (shown next to the choice).
  const [callSource, setCallSource] = useState<OtherSideSource | null>(null);
  const [hotwordsText, setHotwordsText] = useState(TEST_HOTWORDS);
  const [hotwordsUsed, setHotwordsUsed] = useState('');
  // Accuracy: which sentence is being read, and the "You" final lines heard for each sentence.
  const [sentence, setSentence] = useState<number | null>(null);
  const [heard, setHeard] = useState<string[]>(['', '', '']);
  const sentenceRef = useRef<number | null>(null);
  const engine = useRef<SttEngine | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const recording = useRef<RecordingStream | null>(null);
  // The other side of the call (platform adapter), when "Call audio" is chosen.
  const otherSide = useRef<MediaStream | null>(null);
  const monitor = useRef(new SttHealthMonitor());

  /** Stops whatever feeds "Them" (recording or captured call audio). */
  function closeThem() {
    recording.current?.stop();
    recording.current = null;
    for (const track of otherSide.current?.getTracks() ?? []) track.stop();
    otherSide.current = null;
    setCallSource(null);
  }

  /** Releases the microphone, "Them" and the engine. */
  function release() {
    for (const track of mic.current?.getTracks() ?? []) track.stop();
    mic.current = null;
    closeThem();
    engine.current?.stop();
    engine.current = null;
  }

  /**
   * Opens the chosen "Them" source.
   * Must run straight from a click when it is the call audio: browsers only allow
   * getDisplayMedia shortly after a user gesture.
   *
   * @param kind Which source ('off' opens nothing).
   * @returns The stream, or null for 'off'.
   * @throws CaptureError from the platform adapter (message for the user).
   */
  async function openThem(kind: ThemSource): Promise<MediaStream | null> {
    if (kind === 'recordings') {
      const urls = TEST_RECORDINGS.map((file) => testRecordingUrl(file, source, location.origin));
      recording.current = await createRecordingStream(urls);
      return recording.current.stream;
    }
    if (kind === 'call') {
      const captured = await getPlatform().getOtherSideStream();
      otherSide.current = captured.stream;
      setCallSource(captured.source);
      return captured.stream;
    }
    return null;
  }

  // Stop everything when leaving the page. Through a ref, so the cleanup calls the latest
  // release() (it reads state setters and refs) without re-running the effect on every render.
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(() => () => releaseRef.current(), []);

  // Re-check health every second (a stalled worker sends nothing, so time must pass here).
  useEffect(() => {
    if (phase !== 'listening') return;
    const timer = setInterval(() => setHealth(monitor.current.status(performance.now())), 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  /** Attaches or detaches the microphone as "You". */
  async function setMic(on: boolean) {
    setMicOn(on);
    const current = engine.current;
    if (!current || phase !== 'listening') return;
    if (on) {
      mic.current = await getPlatform().getMicStream();
      await current.attach('you', mic.current);
    } else {
      current.detach('you');
      for (const track of mic.current?.getTracks() ?? []) track.stop();
      mic.current = null;
    }
  }

  /** Switches the "Them" source (while listening: detach the old one, attach the new one). */
  async function setThem(kind: ThemSource) {
    setThemSource(kind);
    setError(null);
    const current = engine.current;
    if (!current || phase !== 'listening') return;
    current.detach('them');
    closeThem();
    try {
      const stream = await openThem(kind);
      if (stream) await current.attach('them', stream);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not capture the other side');
      setThemSource('off');
    }
  }

  /** Loads the model, then attaches the selected channels. */
  async function start() {
    setError(null);
    setPhase('loading');
    setPartials({ you: '', them: '' });
    setStats(null);
    setHotwordsUsed(hotwordsText);
    monitor.current.reset();
    // The call audio is captured first, while the click still counts as a user gesture.
    let themStream: MediaStream | null = null;
    try {
      themStream = await openThem(themSource);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not capture the other side');
      setPhase('idle');
      return;
    }
    const created = createSttEngine({
      hotwords: hotwordsText,
      onProgress: setProgress,
      onPartial: ({ channel, text }) => setPartials((current) => ({ ...current, [channel]: text })),
      onFinal: ({ channel, text, reason, latencyMs }) => {
        setFinals((current) => [...current, { channel, text, reason, latencyMs }]);
        const index = sentenceRef.current;
        if (channel === 'you' && index !== null) {
          setHeard((current) =>
            current.map((value, i) => (i === index ? `${value} ${text}`.trim() : value)),
          );
        }
      },
      onStats: (next) => {
        monitor.current.push(next, performance.now());
        setStats(next);
      },
      onError: ({ message }) => setError(message),
    });
    engine.current = created;
    try {
      const load = await created.ready;
      setLoads((current) => [...current, load]);
      if (micOn) {
        mic.current = await getPlatform().getMicStream();
        await created.attach('you', mic.current);
      }
      if (themStream) await created.attach('them', themStream);
      setPhase('listening');
    } catch (cause) {
      setError(
        cause instanceof CaptureError || cause instanceof Error ? cause.message : 'Could not start',
      );
      release();
      setPhase('idle');
    }
  }

  /** Stops listening (keeps the results on screen). */
  function stop() {
    release();
    setPhase('stopped');
  }

  /** Applies the hotwords box to the running engine. */
  async function applyHotwords() {
    if (!engine.current) return;
    await engine.current.setHotwords(hotwordsText);
    setHotwordsUsed(hotwordsText);
  }

  /** Chooses which test sentence the next "You" final lines belong to (clears its result). */
  function chooseSentence(index: number) {
    sentenceRef.current = index;
    setSentence(index);
    setHeard((current) => current.map((value, i) => (i === index ? '' : value)));
  }

  /** Removes the cached files so the next start measures a first (network) load. */
  async function clearCache() {
    const existed = await clearSttCache();
    setError(existed ? 'Model cache cleared.' : 'No model cache to clear.');
  }

  const scores: (WerResult | null)[] = TEST_SENTENCES.map((reference, i) =>
    heard[i] ? wordErrorRate(reference, heard[i] ?? '') : null,
  );
  /** Overall WER across the sentences read (total errors ÷ total reference words), or null. */
  const overall = (() => {
    const results = scores.filter((score): score is WerResult => score !== null);
    const words = results.reduce((sum, result) => sum + result.referenceWords, 0);
    if (words === 0) return null;
    const errors = results.reduce(
      (sum, result) => sum + result.substitutions + result.deletions + result.insertions,
      0,
    );
    return { wer: errors / words, sentences: results.length };
  })();
  /** End of speech → final line latencies of one channel (or both, for channel null). */
  const latencies = (channel: ChannelId | null) =>
    finals
      .filter((line) => channel === null || line.channel === channel)
      .map((line) => line.latencyMs);
  const hotwordsPreview = formatHotwords(hotwordsText);
  const hotwordsLoaded = formatHotwords(hotwordsUsed).hotwords;
  const desktop = getDesktopInfo();
  const where = desktop ? `Desktop app v${desktop.version} (${desktop.os})` : 'Browser';
  const totalBytes = modelDownloadBytes(model);
  const message = healthMessage(health);
  const attachedChannels = (Object.keys(stats?.channels ?? {}) as ChannelId[]).sort();

  /** Builds the results text (numbers, plus what was heard for the test sentences). */
  function resultsText(): string {
    const lines = [
      `Where: ${where}; user agent: ${navigator.userAgent}`,
      `Model: ${model.id} (source ${source}); decoding modified_beam_search; hotwords: ${hotwordsLoaded.length} (scores ${hotwordsLoaded.map((hotword) => hotword.score).join(', ') || '–'})`,
      ...loads.map(
        (load, i) =>
          `Load ${i + 1} (${load.fromCache ? 'cache' : 'network'}${load.cacheAvailable ? '' : ', cache unavailable'}): total ${load.totalMs} ms = download ${load.downloadMs} + runtime ${load.runtimeInitMs} + model ${load.modelInitMs}; ${formatMb(load.bytes)}`,
      ),
      stats
        ? `Combined RTF ${stats.combinedRtf.toFixed(3)} over ${(stats.totalAudioMs / 1000).toFixed(1)} s; channels: ${attachedChannels.join(' + ') || 'none'}; WebAssembly memory ${formatMb(stats.wasmMemoryBytes)}`
        : 'RTF: no audio yet',
      ...attachedChannels.map((id) => {
        const channel = stats!.channels[id]!;
        return `${CHANNEL_LABEL[id]}: RTF ${channel.rtf.toFixed(3)} over ${(channel.audioMs / 1000).toFixed(1)} s; chunk avg ${channel.chunkMsAvg.toFixed(1)} ms, max ${channel.chunkMsMax.toFixed(1)} ms; lag median ${formatMs(median(channel.lagsMs))} (${channel.lagsMs.join(', ') || '–'}); gate delay median ${formatMs(median(channel.gateDelaysMs))} (${channel.gateDelaysMs.join(', ') || '–'}); skipped silence ${(channel.skippedMs / 1000).toFixed(1)} s; ended by model ${channel.endpoints.model}, pause ${channel.endpoints.pause}, flush ${channel.endpoints.flush}; input ${channel.inputSampleRate} Hz`;
      }),
      ...attachedChannels.map(
        (id) => `${CHANNEL_LABEL[id]} end of speech → final line: ${latencySummary(latencies(id))}`,
      ),
      `All channels end of speech → final line: ${latencySummary(latencies(null))}`,
      `Them source: ${themSource}${callSource ? ` (${callSource})` : ''}`,
      `Health: ${health}`,
      ...TEST_SENTENCES.map((_, i) => {
        const score = scores[i];
        return score
          ? `Sentence ${i + 1}: WER ${(score.wer * 100).toFixed(0)}% (${score.substitutions} sub, ${score.deletions} del, ${score.insertions} ins / ${score.referenceWords}); heard: "${heard[i]}"`
          : `Sentence ${i + 1}: not read`;
      }),
      `Overall WER: ${overall ? `${(overall.wer * 100).toFixed(1)}%` : '–'} (${overall?.sentences ?? 0} sentences)`,
    ];
    return lines.join('\n');
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center gap-3">
        <Button onClick={start} disabled={phase === 'loading' || phase === 'listening'}>
          {phase === 'loading' ? 'Loading…' : 'Start'}
        </Button>
        <Button variant="secondary" onClick={stop} disabled={phase !== 'listening'}>
          Stop
        </Button>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={micOn}
            disabled={phase === 'loading'}
            onChange={(event) => void setMic(event.target.checked)}
          />
          You: microphone
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          Them:
          <select
            value={themSource}
            disabled={phase === 'loading'}
            onChange={(event) => void setThem(event.target.value as ThemSource)}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
          >
            <option value="off">off</option>
            <option value="recordings">test recordings (looped)</option>
            <option value="call">call audio ({desktop ? 'system sound' : 'share a tab'})</option>
          </select>
        </label>
        {callSource && (
          <span className="text-xs text-emerald-700">Them = {CALL_SOURCE_LABEL[callSource]}</span>
        )}
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
        <span className="text-xs text-slate-500">
          {where} · {model.label} · {formatMb(totalBytes)} · source {source}
        </span>
      </section>

      <section className="flex flex-col gap-1">
        <label htmlFor="stt-hotwords" className="text-sm font-medium text-slate-800">
          Hotwords (one phrase per line, optional boost score after &quot; :&quot;)
        </label>
        <textarea
          id="stt-hotwords"
          rows={3}
          value={hotwordsText}
          disabled={phase === 'loading'}
          onChange={(event) => setHotwordsText(event.target.value)}
          className="max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500">
            {hotwordsPreview.hotwords.length === 0
              ? 'No hotwords: plain beam search.'
              : `Sent to the model: ${hotwordsPreview.hotwords.map((hotword) => `${hotword.phrase} (${hotword.score})`).join(', ')}`}
            {hotwordsPreview.skippedLines.length > 0 &&
              `; skipped line ${hotwordsPreview.skippedLines.join(', ')} (no letters or bad score)`}
          </p>
          {phase === 'listening' && hotwordsText !== hotwordsUsed && (
            <Button variant="secondary" onClick={() => void applyHotwords()}>
              Apply hotwords (about 2 s)
            </Button>
          )}
        </div>
      </section>

      {phase === 'loading' && (
        <section className="flex max-w-xl flex-col gap-1" aria-live="polite">
          <div
            className="h-2 w-full overflow-hidden rounded bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)}
          >
            <div
              className="h-full bg-brand-600 transition-[width]"
              style={{ width: `${(progress?.fraction ?? 0) * 100}%` }}
            />
          </div>
          <p className="text-sm text-slate-600 tabular-nums">
            {progress
              ? `${Math.round(progress.fraction * 100)}% · ${formatMb(progress.loadedBytes)} of ${formatMb(progress.totalBytes)} · ${progress.file}`
              : 'Starting…'}
            {progress && progress.fraction >= 1 && ' · starting the speech model…'}
          </p>
        </section>
      )}
      {phase === 'listening' && loads.length > 0 && (
        <p className="text-sm font-medium text-emerald-700">Ready</p>
      )}
      {loads.at(-1)?.cacheAvailable === false && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This browser does not allow Kite to store the model, so it downloads again on every start.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className={
            healthTone(health) === 'hint'
              ? 'rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600'
              : 'rounded-md bg-red-50 px-3 py-2 text-sm text-red-800'
          }
        >
          {message}
        </p>
      )}

      <section
        aria-live="polite"
        className="min-h-32 rounded-lg border border-slate-200 bg-white p-4 text-slate-900"
      >
        {finals.map((line, i) => (
          <p key={i}>
            <span className={line.channel === 'you' ? 'text-brand-700' : 'text-violet-700'}>
              {CHANNEL_LABEL[line.channel]}:
            </span>{' '}
            {line.text}{' '}
            <span className="text-xs text-slate-400" title="Which rule ended this utterance">
              · {line.reason}
            </span>
          </p>
        ))}
        {(['you', 'them'] as const).map(
          (channel) =>
            partials[channel] && (
              <p key={channel} className="text-slate-400">
                {CHANNEL_LABEL[channel]}: {partials[channel]}
              </p>
            ),
        )}
        {!partials.you && !partials.them && (
          <p className="text-slate-400">
            {phase === 'listening' ? 'Listening…' : 'Press Start and speak.'}
          </p>
        )}
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
                {formatMb(load.bytes)}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm tabular-nums">
          <h2 className="mb-2 font-semibold text-slate-900">Live</h2>
          <p>
            Combined real-time factor: <strong>{stats ? stats.combinedRtf.toFixed(3) : '–'}</strong>{' '}
            (0.5 or less needed, both channels; also the share of one CPU core)
          </p>
          <p>End of speech → final line: {latencySummary(latencies(null))}</p>
          <p>WebAssembly memory: {stats ? formatMb(stats.wasmMemoryBytes) : '–'}</p>
          <p>Health: {health}</p>
          {attachedChannels.map((id) => {
            const channel = stats!.channels[id]!;
            return (
              <p key={id} className="mt-2">
                <strong>{CHANNEL_LABEL[id]}</strong>: RTF {channel.rtf.toFixed(3)} · chunk avg{' '}
                {channel.chunkMsAvg.toFixed(1)} ms, max {channel.chunkMsMax.toFixed(1)} ms · lag
                median {formatMs(median(channel.lagsMs))} (gate adds{' '}
                {formatMs(median(channel.gateDelaysMs))}) · skipped silence{' '}
                {(channel.skippedMs / 1000).toFixed(1)} s · ended by model {channel.endpoints.model}
                , pause {channel.endpoints.pause}
              </p>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold text-slate-900">Accuracy test (You channel)</h2>
        <p className="mb-3 text-slate-500">
          Click a sentence, pause for a second, read it aloud at normal speed, then pause until it
          appears as a final line. Lag is measured from the start of each utterance after a pause.
        </p>
        <p className="mb-3 tabular-nums">
          Overall WER: <strong>{overall ? `${(overall.wer * 100).toFixed(1)}%` : '–'}</strong> (
          {overall?.sentences ?? 0} of 3 sentences; digits are spelled out before comparing)
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
