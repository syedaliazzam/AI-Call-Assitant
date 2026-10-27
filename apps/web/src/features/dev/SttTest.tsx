/**
 * File: apps/web/src/features/dev/SttTest.tsx
 * Purpose: Admin test screen for the speech-to-text engine (ADR-0020): picks one of the Day 2
 *          Stage 5 configurations (streaming model + second pass), loads it with a progress bar,
 *          transcribes up to two channels at once ("You" = microphone, "Them" = the official
 *          test recordings played in a loop, or the real call audio through the platform
 *          adapter: system sound in the desktop app, a shared tab in the browser), and shows
 *          load time, real-time factors (streaming and both workers), lag, end-of-speech →
 *          first-pass final and → refined text latencies, WebAssembly memory of both workers,
 *          the engine's health, and the word error rate on the 3 fixed test sentences for the
 *          first pass and for the final (refined) text. "Copy results" copies the numbers for
 *          benchmark-results.md.
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
  configurationBytes,
  getSecondPassModel,
  getSttModel,
  STT_CONFIGURATIONS,
  STT_DOWNLOAD_BUDGET_BYTES,
  TEST_RECORDINGS,
  testRecordingUrl,
  type SttConfiguration,
} from '@/core/stt/models';
import type { ChannelId, EndpointReason, EngineStats, RefineStatus } from '@/core/stt/protocol';
import {
  buildModelSource,
  createSttEngine,
  type EngineLoad,
  type SttEngine,
} from '@/core/stt/sttEngine';
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

/** Memory (both workers' WebAssembly) above which the page warns: the developer's limit. */
const MEMORY_CONCERN_BYTES = 1_200_000_000;

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

/** One finished utterance on screen: its first-pass text and, later, the refined text. */
interface Segment {
  /** The engine's utterance id. */
  segmentId: string;
  /** Which channel. */
  channel: ChannelId;
  /** Which rule ended the utterance. */
  reason: EndpointReason;
  /** First-pass text (page memory only). */
  firstPass: string;
  /** Second-pass text once it arrived ('refined' only), else null. */
  refined: string | null;
  /** How the second pass ended, or null while waiting / when it is off. */
  status: RefineStatus | null;
  /** True when a second-pass result is expected. */
  awaitingSecondPass: boolean;
  /** End of speech → first-pass final, in ms. */
  firstLatencyMs: number;
  /** End of speech → second-pass result, in ms (null until it arrived). */
  refinedLatencyMs: number | null;
  /** Second-pass decode time, in ms (null until it arrived). */
  decodeMs: number | null;
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
 * Formats bytes as megabytes with one decimal.
 *
 * @param bytes Bytes.
 * @returns For example "204.1 MB".
 */
function formatMb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * "p50 / p95 (n)" for a list of latencies.
 *
 * @param values Latencies in ms.
 * @returns Display text.
 */
function latencySummary(values: readonly number[]): string {
  if (values.length === 0) return '–';
  return `p50 ${formatMs(median(values))} / p95 ${formatMs(percentile(values, 95))} (n=${values.length})`;
}

/**
 * Whether this page is cross-origin isolated (needed by the second-pass runtime's threads).
 *
 * @returns True when SharedArrayBuffer is available.
 */
function isIsolated(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
}

/**
 * The speech-to-text test panel.
 *
 * @returns The panel.
 */
export function SttTest() {
  const source = buildModelSource();
  const [configId, setConfigId] = useState<SttConfiguration['id']>('baseline');
  const config = STT_CONFIGURATIONS.find((candidate) => candidate.id === configId)!;
  const model = getSttModel(config.model);
  const secondPassModel =
    config.secondPass === 'off' ? null : getSecondPassModel(config.secondPass);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [loads, setLoads] = useState<(EngineLoad & { config: string })[]>([]);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [health, setHealth] = useState<SttHealthStatus>('ok');
  const [partials, setPartials] = useState<Record<ChannelId, string>>({ you: '', them: '' });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [themSource, setThemSource] = useState<ThemSource>('off');
  // Where the real call audio comes from, once captured (shown next to the choice).
  const [callSource, setCallSource] = useState<OtherSideSource | null>(null);
  const [hotwordsText, setHotwordsText] = useState(TEST_HOTWORDS);
  const [hotwordsUsed, setHotwordsUsed] = useState('');
  // Set after hydration (the server has no crossOriginIsolated).
  const [isolated, setIsolated] = useState<boolean | null>(null);
  // Accuracy: which sentence is being read, and the "You" utterances heard for each sentence.
  const [sentence, setSentence] = useState<number | null>(null);
  const [heardIds, setHeardIds] = useState<string[][]>([[], [], []]);
  const sentenceRef = useRef<number | null>(null);
  const engine = useRef<SttEngine | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const recording = useRef<RecordingStream | null>(null);
  // The other side of the call (platform adapter), when "Call audio" is chosen.
  const otherSide = useRef<MediaStream | null>(null);
  const monitor = useRef(new SttHealthMonitor());

  useEffect(() => {
    // Read once on the client; it cannot change while the page is open.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value after hydration
    setIsolated(isIsolated());
  }, []);

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

  /** Loads the chosen configuration, then attaches the selected channels. */
  async function start() {
    setError(null);
    if (config.secondPass !== 'off' && !isIsolated()) {
      setError(
        'This page is not cross-origin isolated, so the second pass cannot start (it needs the COOP/COEP headers from next.config.ts). Reload the page.',
      );
      return;
    }
    setPhase('loading');
    setPartials({ you: '', them: '' });
    setSegments([]);
    setHeardIds([[], [], []]);
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
      model: config.model,
      secondPass: config.secondPass,
      hotwords: hotwordsText,
      onProgress: setProgress,
      onPartial: ({ channel, text }) => setPartials((current) => ({ ...current, [channel]: text })),
      onFinal: ({ channel, text, reason, segmentId, latencyMs, secondPass }) => {
        setSegments((current) => [
          ...current,
          {
            segmentId,
            channel,
            reason,
            firstPass: text,
            refined: null,
            status: null,
            awaitingSecondPass: secondPass,
            firstLatencyMs: latencyMs,
            refinedLatencyMs: null,
            decodeMs: null,
          },
        ]);
        const index = sentenceRef.current;
        if (channel === 'you' && index !== null) {
          setHeardIds((current) =>
            current.map((ids, i) => (i === index ? [...ids, segmentId] : ids)),
          );
        }
      },
      onRefined: ({ segmentId, text, status, latencyMs, decodeMs }) => {
        setSegments((current) =>
          current.map((segment) =>
            segment.segmentId === segmentId
              ? {
                  ...segment,
                  refined: status === 'refined' ? text : null,
                  status,
                  awaitingSecondPass: false,
                  refinedLatencyMs: latencyMs,
                  decodeMs,
                }
              : segment,
          ),
        );
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
      setLoads((current) => [...current, { ...load, config: config.id }]);
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

  /** Applies the hotwords box to the running engine (both passes). */
  async function applyHotwords() {
    if (!engine.current) return;
    await engine.current.setHotwords(hotwordsText);
    setHotwordsUsed(hotwordsText);
  }

  /** Chooses which test sentence the next "You" final lines belong to (clears its result). */
  function chooseSentence(index: number) {
    sentenceRef.current = index;
    setSentence(index);
    setHeardIds((current) => current.map((ids, i) => (i === index ? [] : ids)));
  }

  /** Removes the cached files so the next start measures a first (network) load. */
  async function clearCache() {
    const existed = await clearSttCache();
    setError(existed ? 'Model cache cleared.' : 'No model cache to clear.');
  }

  const byId = new Map(segments.map((segment) => [segment.segmentId, segment]));
  /** What was heard for a sentence: first-pass text, or final text (refined when available). */
  const heardText = (index: number, kind: 'first' | 'final') =>
    (heardIds[index] ?? [])
      .map((id) => byId.get(id))
      .filter((segment): segment is Segment => segment !== undefined)
      .map((segment) =>
        kind === 'first' ? segment.firstPass : (segment.refined ?? segment.firstPass),
      )
      .join(' ')
      .trim();
  const scores = TEST_SENTENCES.map((reference, i) => {
    const first = heardText(i, 'first');
    const final = heardText(i, 'final');
    return {
      first: first ? wordErrorRate(reference, first) : null,
      final: final ? wordErrorRate(reference, final) : null,
      firstText: first,
      finalText: final,
    };
  });
  /** Overall WER across the sentences read (total errors ÷ total reference words). */
  const overall = (kind: 'first' | 'final') => {
    const results = scores
      .map((score) => score[kind])
      .filter((result): result is WerResult => result !== null);
    const words = results.reduce((sum, result) => sum + result.referenceWords, 0);
    if (words === 0) return null;
    const errors = results.reduce(
      (sum, result) => sum + result.substitutions + result.deletions + result.insertions,
      0,
    );
    return { wer: errors / words, sentences: results.length };
  };
  const overallFirst = overall('first');
  const overallFinal = overall('final');
  const hotwordsPreview = formatHotwords(hotwordsText);
  const hotwordsLoaded = formatHotwords(hotwordsUsed).hotwords;
  const desktop = getDesktopInfo();
  const where = desktop ? `Desktop app v${desktop.version} (${desktop.os})` : 'Browser';
  const totalBytes = configurationBytes(model, config.secondPass);
  const message = healthMessage(health);
  const attachedChannels = (Object.keys(stats?.channels ?? {}) as ChannelId[]).sort();
  const memoryBytes = (stats?.wasmMemoryBytes ?? 0) + (stats?.secondPass?.wasmMemoryBytes ?? 0);
  /** Latencies of one channel (or both, for channel null). */
  const latencies = (channel: ChannelId | null, kind: 'first' | 'refined') =>
    segments
      .filter((segment) => channel === null || segment.channel === channel)
      .map((segment) => (kind === 'first' ? segment.firstLatencyMs : segment.refinedLatencyMs))
      .filter((value): value is number => value !== null);
  const sp = stats?.secondPass;

  /** Builds the results text (numbers, plus what was heard for the test sentences). */
  function resultsText(): string {
    const lines = [
      `Where: ${where}; user agent: ${navigator.userAgent}; cross-origin isolated: ${isIsolated() ? 'yes' : 'no'}`,
      `Configuration: ${config.id} = ${config.model} + second pass ${config.secondPass} (source ${source}); download ${formatMb(totalBytes)} (budget ${formatMb(config.budgetBytes)}); hotwords: ${hotwordsLoaded.length} (scores ${hotwordsLoaded.map((hotword) => hotword.score).join(', ') || '–'})`,
      ...loads.map(
        (load, i) =>
          `Load ${i + 1} [${load.config}] (${load.fromCache ? 'cache' : 'network'}${load.cacheAvailable ? '' : ', cache unavailable'}): streaming ${load.totalMs} ms = download ${load.downloadMs} + runtime ${load.runtimeInitMs} + model ${load.modelInitMs}; ${formatMb(load.bytes)}` +
          (load.secondPass
            ? `; second pass ${load.secondPass.totalMs} ms = download ${load.secondPass.downloadMs} + runtime ${load.secondPass.runtimeInitMs} + model ${load.secondPass.modelInitMs}; ${formatMb(load.secondPass.bytes)}`
            : ''),
      ),
      stats
        ? `Combined RTF: streaming ${stats.combinedRtf.toFixed(3)}, both workers ${(stats.allWorkersRtf ?? stats.combinedRtf).toFixed(3)} over ${(stats.totalAudioMs / 1000).toFixed(1)} s; channels: ${attachedChannels.join(' + ') || 'none'}`
        : 'RTF: no audio yet',
      stats
        ? `WebAssembly memory: streaming ${formatMb(stats.wasmMemoryBytes)} + second pass ${formatMb(stats.secondPass?.wasmMemoryBytes ?? 0)} = ${formatMb(memoryBytes)}${memoryBytes > MEMORY_CONCERN_BYTES ? ' (OVER 1.2 GB)' : ''}`
        : 'Memory: –',
      ...attachedChannels.map((id) => {
        const channel = stats!.channels[id]!;
        return `${CHANNEL_LABEL[id]}: RTF ${channel.rtf.toFixed(3)} over ${(channel.audioMs / 1000).toFixed(1)} s; chunk avg ${channel.chunkMsAvg.toFixed(1)} ms, max ${channel.chunkMsMax.toFixed(1)} ms; lag median ${formatMs(median(channel.lagsMs))} (${channel.lagsMs.join(', ') || '–'}); gate delay median ${formatMs(median(channel.gateDelaysMs))}; skipped silence ${(channel.skippedMs / 1000).toFixed(1)} s; ended by model ${channel.endpoints.model}, pause ${channel.endpoints.pause}, flush ${channel.endpoints.flush}; input ${channel.inputSampleRate} Hz`;
      }),
      ...(['you', 'them'] as const).map(
        (id) =>
          `${CHANNEL_LABEL[id]} end of speech → first-pass final: ${latencySummary(latencies(id, 'first'))}; → refined text: ${latencySummary(latencies(id, 'refined'))}`,
      ),
      `All channels end of speech → first-pass final: ${latencySummary(latencies(null, 'first'))}; → refined text: ${latencySummary(latencies(null, 'refined'))} (target p50 ≤ 1,500 ms)`,
      sp
        ? `Second pass: ${sp.jobs} jobs; refined ${sp.outcomes.refined}, no speech ${sp.outcomes['no-speech']}, dropped ${sp.outcomes.dropped}, failed ${sp.outcomes.failed}; audio ${(sp.audioMs / 1000).toFixed(1)} s, decoded after VAD ${(sp.speechMs / 1000).toFixed(1)} s; VAD ${Math.round(sp.vadMs)} ms, decode ${Math.round(sp.decodeMs)} ms (decode RTF ${sp.speechMs > 0 ? (sp.decodeMs / sp.speechMs).toFixed(3) : '–'}); longest queue wait ${formatMs(sp.queueMsMax)}`
        : 'Second pass: off',
      `Them source: ${themSource}${callSource ? ` (${callSource})` : ''}`,
      `Health: ${health}`,
      `Overall WER: first pass ${overallFirst ? `${(overallFirst.wer * 100).toFixed(1)}%` : '–'}, final ${overallFinal ? `${(overallFinal.wer * 100).toFixed(1)}%` : '–'} (${overallFinal?.sentences ?? 0} sentences)`,
      ...TEST_SENTENCES.map((_, i) => {
        const score = scores[i]!;
        if (!score.first) return `Sentence ${i + 1}: not read`;
        const describe = (result: WerResult) =>
          `${(result.wer * 100).toFixed(0)}% (${result.substitutions} sub, ${result.deletions} del, ${result.insertions} ins / ${result.referenceWords})`;
        return `Sentence ${i + 1}: first pass WER ${describe(score.first)}; final WER ${score.final ? describe(score.final) : '–'}; first pass heard: "${score.firstText}"; final heard: "${score.finalText}"`;
      }),
    ];
    return lines.join('\n');
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
          Configuration:
          <select
            value={configId}
            disabled={phase === 'loading' || phase === 'listening'}
            onChange={(event) => setConfigId(event.target.value as SttConfiguration['id'])}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
          >
            {STT_CONFIGURATIONS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500 tabular-nums">
          {model.label}
          {secondPassModel ? ` + ${secondPassModel.label} (${secondPassModel.licence})` : ''} ·
          download {formatMb(totalBytes)}{' '}
          {totalBytes <= STT_DOWNLOAD_BUDGET_BYTES
            ? '(within 250 MB)'
            : `(over 250 MB; allowed up to ${formatMb(config.budgetBytes)} only if this configuration is adopted)`}{' '}
          · cross-origin isolated:{' '}
          {isolated === null ? '…' : isolated ? 'yes' : 'no (second pass unavailable)'}
        </p>
      </section>

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
          {where} · source {source}
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
            {secondPassModel &&
              !secondPassModel.hotwords &&
              ' The second pass of this configuration has no hotwords.'}
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
            {progress && progress.fraction >= 1 && ' · starting the speech models…'}
          </p>
        </section>
      )}
      {phase === 'listening' && loads.length > 0 && (
        <p className="text-sm font-medium text-emerald-700">
          Ready
          {config.secondPass !== 'off' &&
            !loads.at(-1)?.secondPass &&
            ' (second pass failed to load: first pass only)'}
        </p>
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
        {segments.map((segment) => (
          <div key={segment.segmentId} className="mb-1">
            <p>
              <span className={segment.channel === 'you' ? 'text-brand-700' : 'text-violet-700'}>
                {CHANNEL_LABEL[segment.channel]}:
              </span>{' '}
              {segment.refined ?? segment.firstPass}{' '}
              <span className="text-xs text-slate-400 tabular-nums">
                · {segment.reason} · final {formatMs(segment.firstLatencyMs)}
                {segment.status === 'refined' &&
                  ` · refined ${formatMs(segment.refinedLatencyMs)} (decode ${formatMs(segment.decodeMs)})`}
                {segment.status &&
                  segment.status !== 'refined' &&
                  ` · second pass: ${segment.status}`}
                {segment.awaitingSecondPass && ' · refining…'}
              </span>
            </p>
            {segment.refined !== null && segment.refined !== segment.firstPass && (
              <p className="pl-4 text-xs text-slate-400">first pass: {segment.firstPass}</p>
            )}
          </div>
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
                Load {i + 1} [{load.config}] ({load.fromCache ? 'cache' : 'network'}): streaming{' '}
                <strong>{formatMs(load.totalMs)}</strong> = download {formatMs(load.downloadMs)} +
                runtime {formatMs(load.runtimeInitMs)} + model {formatMs(load.modelInitMs)};{' '}
                {formatMb(load.bytes)}
                {load.secondPass && (
                  <>
                    ; second pass <strong>{formatMs(load.secondPass.totalMs)}</strong>,{' '}
                    {formatMb(load.secondPass.bytes)}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm tabular-nums">
          <h2 className="mb-2 font-semibold text-slate-900">Live</h2>
          <p>
            Combined real-time factor, both workers:{' '}
            <strong>{stats ? (stats.allWorkersRtf ?? stats.combinedRtf).toFixed(3) : '–'}</strong>{' '}
            (0.5 or less needed with two channels; streaming alone{' '}
            {stats ? stats.combinedRtf.toFixed(3) : '–'})
          </p>
          <p>
            WebAssembly memory:{' '}
            <strong className={memoryBytes > MEMORY_CONCERN_BYTES ? 'text-red-700' : undefined}>
              {stats ? formatMb(memoryBytes) : '–'}
            </strong>{' '}
            (streaming {stats ? formatMb(stats.wasmMemoryBytes) : '–'} + second pass{' '}
            {sp ? formatMb(sp.wasmMemoryBytes) : '–'}
            {memoryBytes > MEMORY_CONCERN_BYTES && '; over 1.2 GB'})
          </p>
          <p>End of speech → first-pass final: {latencySummary(latencies(null, 'first'))}</p>
          <p>
            End of speech → refined text:{' '}
            <strong>{latencySummary(latencies(null, 'refined'))}</strong> (target p50 ≤ 1,500 ms)
          </p>
          {sp && (
            <p>
              Second pass: {sp.jobs} jobs · refined {sp.outcomes.refined} · no speech{' '}
              {sp.outcomes['no-speech']} · dropped {sp.outcomes.dropped} · failed{' '}
              {sp.outcomes.failed} · decode RTF{' '}
              {sp.speechMs > 0 ? (sp.decodeMs / sp.speechMs).toFixed(3) : '–'} · longest wait{' '}
              {formatMs(sp.queueMsMax)}
            </p>
          )}
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
        <p className="mb-1 text-slate-500">
          Click a sentence, pause for a second, read it aloud at normal speed, then pause until its
          final line (and, with a second pass, its refined text) appears. Lag is measured from the
          start of each utterance after a pause.
        </p>
        <p className="mb-3 tabular-nums">
          Overall WER: first pass{' '}
          <strong>{overallFirst ? `${(overallFirst.wer * 100).toFixed(1)}%` : '–'}</strong> · final{' '}
          <strong>{overallFinal ? `${(overallFinal.wer * 100).toFixed(1)}%` : '–'}</strong> (
          {overallFinal?.sentences ?? 0} of 3 sentences)
        </p>
        <ol className="flex flex-col gap-3">
          {TEST_SENTENCES.map((reference, i) => {
            const score = scores[i]!;
            const shown = score.final ?? score.first;
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
                {shown && (
                  <div className="mt-2">
                    <p className="tabular-nums">
                      Final WER <strong>{(shown.wer * 100).toFixed(0)}%</strong> (
                      {shown.substitutions} substituted, {shown.deletions} missed,{' '}
                      {shown.insertions} extra of {shown.referenceWords} words) · first pass{' '}
                      {score.first ? `${(score.first.wer * 100).toFixed(0)}%` : '–'}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {shown.alignment.map((step, j) => (
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
