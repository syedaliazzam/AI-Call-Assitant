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
 * "Hotwords from" (Day 3 Stage 4): fills the hotwords box from a session's hotwords (key terms,
 * company, role, document names; core/stt/sessionHotwords.ts), the fixed test list, or none,
 * to measure what session hotwords do to accuracy.
 *
 * "Beam width" (Day 3 Stage 4): 4 (sherpa-onnx's default, what live sessions use) or 8, to measure
 * whether a wider beam lets hotwords reach names and what it costs in RTF. This page only; it
 * takes effect on the next Start.
 *
 * Transcript text stays in this page's memory only; it is never logged or sent anywhere.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { createRecordingStream, type RecordingStream } from '@/core/audio/recordingStream';
import { listDocuments } from '@/core/storage/documents';
import { getSession, listSessions } from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
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
import {
  DEFAULT_BEAM_WIDTH,
  type BeamWidth,
  type ChannelId,
  type EndpointReason,
  type EngineStats,
  type LoadStats,
} from '@/core/stt/protocol';
import { buildHotwords, hotwordsText as toHotwordsText } from '@/core/stt/sessionHotwords';
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
 * Hotwords prefilled for the accuracy test ("Test list"): the two names in sentence 3, one
 * phrase per line with a boost score. Live sessions build their own list instead
 * (core/stt/sessionHotwords.ts); "Hotwords from" can load a session's list here.
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
 * The speech-to-text test panel: start and stop the engine, pick the "Them" source, apply
 * hotwords, and read the measured numbers and the accuracy test.
 *
 * @returns The panel: controls, live numbers, transcript and the accuracy test.
 * Rendered by: app/(app)/dev/stt-test/page.tsx
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
  // Where the hotwords box was last filled from: 'test', 'none', or a session id.
  const [hotwordSource, setHotwordSource] = useState('test');
  // The source of the hotwords loaded into the running engine (for "Copy results").
  const [hotwordSourceUsed, setHotwordSourceUsed] = useState('');
  // Beam width chosen for the next Start, and the one the running engine was started with.
  const [beamWidth, setBeamWidth] = useState<BeamWidth>(DEFAULT_BEAM_WIDTH);
  const [beamWidthUsed, setBeamWidthUsed] = useState<BeamWidth>(DEFAULT_BEAM_WIDTH);
  // Sessions on this computer, for "Hotwords from".
  const [sessions, setSessions] = useState<Session[]>([]);
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

  /**
   * Attaches or detaches the microphone as "You".
   *
   * @param on True to attach; false to detach and release the microphone.
   */
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

  /**
   * Switches the "Them" source (while listening: detach the old one, attach the new one).
   *
   * @param kind 'off', 'recordings' (official test recordings in a loop) or 'call' (the real
   *             call audio through the platform adapter).
   */
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
    setHotwordSourceUsed(hotwordSource);
    setBeamWidthUsed(beamWidth);
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
      beamWidth,
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

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => undefined);
  }, []);

  /**
   * Fills the hotwords box from the fixed test list, nothing, or a session's hotwords.
   *
   * @param source 'test', 'none', or a session id.
   */
  async function chooseHotwordSource(source: string) {
    setHotwordSource(source);
    if (source === 'test') {
      setHotwordsText(TEST_HOTWORDS);
    } else if (source === 'none') {
      setHotwordsText('');
    } else {
      const session = await getSession(source);
      if (!session) return;
      setHotwordsText(toHotwordsText(buildHotwords(session, await listDocuments(session.id))));
    }
  }

  /**
   * A short description of a hotword source for "Copy results" (no names: the session is
   * described by its type only).
   *
   * @param source 'test', 'none', or a session id.
   * @returns For example "session (sales)".
   */
  function describeSource(source: string): string {
    if (source === 'test') return 'test list';
    if (source === 'none') return 'none';
    const session = sessions.find((candidate) => candidate.id === source);
    return session ? `session (${session.type})` : 'session';
  }

  /** Applies the hotwords box to the running engine. */
  async function applyHotwords() {
    if (!engine.current) return;
    await engine.current.setHotwords(hotwordsText);
    setHotwordsUsed(hotwordsText);
    setHotwordSourceUsed(hotwordSource);
  }

  /**
   * Chooses which test sentence the next "You" final lines belong to (clears its result).
   *
   * @param index Position in TEST_SENTENCES (0-based).
   */
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
  /**
   * End of speech → final line latencies of one channel, or of both.
   *
   * @param channel The channel, or null for both.
   * @returns The latencies in ms, in the order the lines arrived.
   */
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

  /**
   * Builds the "Copy results" text for benchmark-results.md: numbers, plus what was heard for
   * the test sentences (never the call itself).
   *
   * @returns The text, one fact per line.
   */
  function resultsText(): string {
    const lines = [
      `Where: ${where}; user agent: ${navigator.userAgent}`,
      `Model: ${model.id} (source ${source}); decoding modified_beam_search, beam width ${beamWidthUsed}; hotwords from ${describeSource(hotwordSourceUsed)}: ${hotwordsLoaded.length} (scores ${hotwordsLoaded.map((hotword) => hotword.score).join(', ') || '–'})`,
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
        <label className="flex items-center gap-2 text-[13px] text-ui-text">
          <input
            type="checkbox"
            checked={micOn}
            disabled={phase === 'loading'}
            onChange={(event) => void setMic(event.target.checked)}
          />
          You: microphone
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ui-text">
          Them:
          <select
            value={themSource}
            disabled={phase === 'loading'}
            onChange={(event) => void setThem(event.target.value as ThemSource)}
            className="h-9 border border-ui-border rounded-control bg-ui-surface px-2 text-[13px]"
          >
            <option value="off">off</option>
            <option value="recordings">test recordings (looped)</option>
            <option value="call">call audio ({desktop ? 'system sound' : 'share a tab'})</option>
          </select>
        </label>
        {callSource && (
          <span className="text-[13px] text-ui-success">
            Them = {CALL_SOURCE_LABEL[callSource]}
          </span>
        )}
        <label className="flex items-center gap-2 text-[13px] text-ui-text">
          Beam width:
          {/* Read on Start only: the worker builds its recognizer once per load. */}
          <select
            value={beamWidth}
            disabled={phase === 'loading' || phase === 'listening'}
            onChange={(event) => setBeamWidth(Number(event.target.value) as BeamWidth)}
            className="h-9 border border-ui-border rounded-control bg-ui-surface px-2 text-[13px]"
          >
            <option value={4}>4 (live sessions)</option>
            <option value={8}>8 (more CPU)</option>
          </select>
        </label>
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
        <span className="text-[13px] text-ui-muted">
          {where} · {model.label} · {formatMb(totalBytes)} · source {source}
        </span>
      </section>

      <section className="flex flex-col gap-1">
        <label htmlFor="stt-hotword-source" className="text-[13px] font-semibold text-ui-text">
          Hotwords from
        </label>
        <select
          id="stt-hotword-source"
          value={hotwordSource}
          disabled={phase === 'loading'}
          onChange={(event) => void chooseHotwordSource(event.target.value)}
          className="mb-2 h-9 max-w-xl border border-ui-border rounded-control bg-ui-surface px-2 text-[13px]"
        >
          <option value="test">Test list (Bluefin Route, Northwind Logistics)</option>
          <option value="none">No hotwords</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              Session: {session.company || 'Untitled'} · {session.role}
            </option>
          ))}
        </select>
        <label htmlFor="stt-hotwords" className="text-[13px] font-semibold text-ui-text">
          Hotwords (one phrase per line, optional boost score after &quot; :&quot;)
        </label>
        <textarea
          id="stt-hotwords"
          rows={3}
          value={hotwordsText}
          disabled={phase === 'loading'}
          onChange={(event) => setHotwordsText(event.target.value)}
          className="max-w-xl border border-ui-border rounded-card bg-ui-surface shadow-card px-3 py-2 text-[13px]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-ui-muted">
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
            className="h-2 w-full overflow-hidden bg-ui-band"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)}
          >
            <div
              className="h-full bg-ui-primary transition-[width]"
              style={{ width: `${(progress?.fraction ?? 0) * 100}%` }}
            />
          </div>
          <p className="text-[13px] text-ui-muted tabular-nums">
            {progress
              ? `${Math.round(progress.fraction * 100)}% · ${formatMb(progress.loadedBytes)} of ${formatMb(progress.totalBytes)} · ${progress.file}`
              : 'Starting…'}
            {progress && progress.fraction >= 1 && ' · starting the speech model…'}
          </p>
        </section>
      )}
      {phase === 'listening' && loads.length > 0 && (
        <p className="text-[13px] font-semibold text-ui-success">Ready</p>
      )}
      {loads.at(-1)?.cacheAvailable === false && (
        <p className="rounded-control bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-warning">
          This browser does not allow Paramount AI to store the model, so it downloads again on
          every start.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-control bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-warning"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className={
            healthTone(health) === 'hint'
              ? 'rounded-control bg-ui-band px-3 py-2 text-[13px] text-ui-muted'
              : 'rounded-control bg-ui-danger-bg px-3 py-2 text-[13px] text-ui-danger'
          }
        >
          {message}
        </p>
      )}

      <section
        aria-live="polite"
        className="min-h-32 border border-ui-border rounded-card bg-ui-surface shadow-card p-4 text-ui-heading"
      >
        {finals.map((line, i) => (
          <p key={i}>
            <span className={line.channel === 'you' ? 'text-ui-you' : 'text-ui-them'}>
              {CHANNEL_LABEL[line.channel]}:
            </span>{' '}
            {line.text}{' '}
            <span className="text-[13px] text-ui-muted" title="Which rule ended this utterance">
              · {line.reason}
            </span>
          </p>
        ))}
        {(['you', 'them'] as const).map(
          (channel) =>
            partials[channel] && (
              <p key={channel} className="text-ui-muted">
                {CHANNEL_LABEL[channel]}: {partials[channel]}
              </p>
            ),
        )}
        {!partials.you && !partials.them && (
          <p className="text-ui-muted">
            {phase === 'listening' ? 'Listening…' : 'Press Start and speak.'}
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="border border-ui-border rounded-card bg-ui-surface shadow-card p-4 text-[13px]">
          <h2 className="mb-2 font-semibold text-ui-heading">Loading</h2>
          {loads.length === 0 && <p className="text-ui-muted">Not loaded yet.</p>}
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
        <div className="border border-ui-border rounded-card bg-ui-surface shadow-card p-4 text-[13px] tabular-nums">
          <h2 className="mb-2 font-semibold text-ui-heading">Live</h2>
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

      <section className="border border-ui-border rounded-card bg-ui-surface shadow-card p-4 text-[13px]">
        <h2 className="mb-1 font-semibold text-ui-heading">Accuracy test (You channel)</h2>
        <p className="mb-3 text-ui-muted">
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
                className={`border p-3 ${sentence === i ? 'border-ui-accent' : 'border-ui-border'}`}
              >
                <button
                  type="button"
                  onClick={() => chooseSentence(i)}
                  className="text-left font-semibold text-ui-heading"
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
                              ? 'text-ui-text'
                              : step.type === 'sub'
                                ? 'rounded-control bg-ui-warning-bg px-1 text-ui-warning'
                                : step.type === 'del'
                                  ? 'rounded-control bg-ui-danger-bg px-1 text-ui-danger line-through'
                                  : 'rounded-control bg-ui-pale px-1 text-ui-heading'
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
