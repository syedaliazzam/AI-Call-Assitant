/**
 * Voice-question latency on production (ADR-0101), as the disposable test account (KITE_E2E_*), in Chrome
 * (Playwright's Chromium): a session, Connect with a microphone that plays a spoken track (KITE_VOICE_WAV:
 * questions, some with a thinking pause in the middle) and a near-silent "meeting" tab, Ctrl+Shift+Space
 * pressed 1.2 s before each question, then End. For each question it reports: stop speaking → question
 * sent, stop speaking → first answer word, and whether the question sent was whole. Manual run only (never in
 * CI); numbers only, never words.
 *
 * - The microphone: getUserMedia is answered with a Web Audio stream that plays the track when the test says
 *   (window.__kiteVoiceStart()), so the press times are known exactly. Chromium's fake-capture file is not
 *   used: it also feeds a shared tab, and the echo canceller then removes the questions from the microphone.
 * - Stop speaking: the last word's end in Deepgram's own results on the page's microphone socket (Nova-3,
 *   /v1/listen), turned into wall time from the times the page sent that socket's audio.
 * - Question sent: the POST /api/answer (mode chat) carrying the whole question: sent after its last word,
 *   with at most one word fewer than spoken (counted, never read out).
 * - First answer word: that answer's first word in the call's timing trace (localStorage), by its send time.
 *
 * Run: KITE_VOICE_WAV=<track.wav> KITE_VOICE_SCHEDULE=<schedule.json> KITE_VOICE_LABEL=before
 *      pnpm --filter web test:e2e-prod voice-latency.spec.ts
 * The schedule has questions [{ q, words, start, end, pauses }] (s, in the track).
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, expect, test, type Request } from '@playwright/test';
import {
  createSession,
  inventedDocument,
  report,
  sessionCard,
  signIn,
  testAccount,
} from './helpers';

/** Title of the "meeting" tab; Chromium auto-selects it when the page asks to share a tab. */
const THEM_TAB_TITLE = 'Kite voice latency Them';

/** Where the page fetches the track from (answered by the test, never by the server). */
const TRACK_PATH = '/__kite-voice-test.wav';

/** One question of the track. */
interface Question {
  /** Its number. */
  q: number;
  /** How many words it has. */
  words: number;
  /** Speech start in the track, s. */
  start: number;
  /** Speech end in the track, s. */
  end: number;
  /** Thinking pauses inside it. */
  pauses: { from: number; ms: number }[];
}

/** One audio frame the page sent to the microphone socket. */
interface Frame {
  /** When it was sent (wall ms). */
  wall: number;
  /** Stream seconds of audio sent so far, this frame included. */
  endT: number;
}

/** The parts of a Deepgram Results message read here. */
interface DeepgramResults {
  /** The message type. */
  type?: string;
  /** The channel. */
  channel?: {
    /** Alternatives, best first. */
    alternatives?: {
      /** The words' times. */
      words?: {
        /** The word's end, stream seconds. */
        end?: number;
      }[];
    }[];
  };
}

/** A chat request the page sent. */
interface SentQuestion {
  /** When (wall ms). */
  wall: number;
  /** How many words its question had (never the words). */
  words: number;
}

/**
 * One second of near-silence (a faint hiss, so the tab really plays audio) as a WAV, base64.
 *
 * @returns The base64 WAV.
 */
function quietWav(): string {
  const rate = 16_000;
  const samples = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i++)
    samples.writeInt16LE(Math.round((Math.random() - 0.5) * 20), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]).toString('base64');
}

/**
 * In the page, before any script: getUserMedia for audio only is answered with a Web Audio stream that stays
 * silent until window.__kiteVoiceStart() plays the track (fetched from the given path). Video requests (the
 * shared tab) go to the browser as usual.
 *
 * @param path The track's path.
 */
function installTrackMicrophone(path: string): void {
  const devices = navigator.mediaDevices;
  const original = devices.getUserMedia.bind(devices);
  let audio: AudioContext | null = null;
  let out: MediaStreamAudioDestinationNode | null = null;
  let buffer: Promise<AudioBuffer> | null = null;
  const ready = (): { audio: AudioContext; out: MediaStreamAudioDestinationNode } => {
    const context = audio ?? new AudioContext({ sampleRate: 48_000 });
    audio = context;
    const destination = out ?? context.createMediaStreamDestination();
    out = destination;
    buffer ??= fetch(path)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes));
    return { audio: context, out: destination };
  };
  devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (constraints?.audio && !constraints.video) {
      const made = ready();
      await made.audio.resume();
      return made.out.stream.clone();
    }
    return original(constraints);
  };
  (window as unknown as { __kiteVoiceStart: () => Promise<number> }).__kiteVoiceStart =
    async () => {
      const made = ready();
      await made.audio.resume();
      const source = made.audio.createBufferSource();
      source.buffer = await buffer!;
      source.connect(made.out);
      source.start();
      return Date.now();
    };
}

/**
 * Nearest-rank percentile.
 *
 * @param values The numbers.
 * @param p      0–100.
 * @returns The value, or null for none.
 */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

/**
 * The words in a question (a count only).
 *
 * @param text The question.
 * @returns Its number of words.
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * The JSON body of a request, gzipped or not.
 *
 * @param request The request.
 * @returns The parsed body, or null.
 */
function bodyOf(request: Request): { mode?: string; question?: string } | null {
  const raw = request.postDataBuffer();
  if (!raw) return null;
  try {
    const text =
      request.headers()['content-encoding'] === 'gzip'
        ? gunzipSync(raw).toString('utf8')
        : raw.toString('utf8');
    return JSON.parse(text) as { mode?: string; question?: string };
  } catch {
    return null;
  }
}

test('voice questions: stop speaking → sent → first word', async () => {
  test.setTimeout(1_200_000);
  const wav = process.env.KITE_VOICE_WAV;
  const schedulePath = process.env.KITE_VOICE_SCHEDULE;
  if (!wav || !schedulePath) throw new Error('KITE_VOICE_WAV and KITE_VOICE_SCHEDULE are needed');
  const questions = (JSON.parse(readFileSync(schedulePath, 'utf8')) as { questions: Question[] })
    .questions;
  const label = process.env.KITE_VOICE_LABEL ?? 'run';

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      `--auto-select-tab-capture-source-by-title=${THEM_TAB_TITLE}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const track = readFileSync(wav);
    await context.route(`**${TRACK_PATH}`, (route) =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body: track }),
    );
    await context.addInitScript(installTrackMicrophone, TRACK_PATH);
    const page = context.pages()[0] ?? (await context.newPage());
    // Diagnostics (counts and paths only): every Deepgram socket the page opened.
    const seen: { path: string; sent: number; received: number }[] = [];
    // The microphone socket: frames sent (for the clock) and the words' end times received.
    let frames: Frame[] = [];
    let wordEnds: number[] = [];
    page.on('websocket', (socket) => {
      const info = { path: new URL(socket.url()).pathname, sent: 0, received: 0 };
      seen.push(info);
      socket.on('framesent', () => {
        info.sent += 1;
      });
      socket.on('framereceived', () => {
        info.received += 1;
      });
      if (!socket.url().includes('/v1/listen')) return;
      // A new microphone socket starts its own stream clock.
      const mine: Frame[] = [];
      const ends: number[] = [];
      frames = mine;
      wordEnds = ends;
      let sent = 0;
      socket.on('framesent', (frame) => {
        if (typeof frame.payload === 'string') return;
        sent += frame.payload.length / 32_000;
        mine.push({ wall: Date.now(), endT: sent });
      });
      socket.on('framereceived', (frame) => {
        if (typeof frame.payload !== 'string') return;
        try {
          const message = JSON.parse(frame.payload) as DeepgramResults;
          if (message.type !== 'Results') return;
          for (const word of message.channel?.alternatives?.[0]?.words ?? []) {
            if (typeof word.end === 'number') ends.push(word.end);
          }
        } catch {
          // Not JSON: ignore.
        }
      });
    });
    const sentQuestions: SentQuestion[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST' || !request.url().endsWith('/api/answer')) return;
      const body = bodyOf(request);
      if (body?.mode === 'chat' && typeof body.question === 'string') {
        sentQuestions.push({ wall: Date.now(), words: wordCount(body.question) });
      }
    });
    /**
     * Wall time of a stream second (from the frames sent).
     *
     * @param streamT Stream seconds.
     * @returns Wall ms.
     */
    const wallOf = (streamT: number): number => {
      const at = frames.find((frame) => frame.endT >= streamT) ?? frames.at(-1);
      if (!at) return Number.NaN;
      return at.wall - (at.endT - streamT) * 1000;
    };

    await signIn(page, testAccount());
    await page.evaluate(() => {
      localStorage.setItem('kite.startInOverlay', 'off');
      localStorage.setItem('kite.trace', '1');
    });
    const company = `Voice Latency Co ${Date.now().toString(36)}`;
    await createSession(page, {
      company,
      keyTerms: ['Bluefin Route', 'Harbor Lane'],
      document: inventedDocument(),
    });
    await sessionCard(page, company).getByRole('button', { name: 'Start session' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open in browser' }).click();
    await expect(page.getByText('Speech model ready')).toBeVisible({ timeout: 480_000 });
    const them = await context.newPage();
    // The tab plays audio of its own (near-silence), so the shared tab carries no speech.
    await them.setContent(
      `<title>${THEM_TAB_TITLE}</title><audio autoplay loop src="data:audio/wav;base64,${quietWav()}"></audio>`,
    );
    await page.bringToFront();
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByLabel('Live transcript')).toBeVisible({ timeout: 30_000 });
    // The sockets settle, then the track starts.
    await page.waitForTimeout(4_000);
    const startWall = await page.evaluate(() =>
      (window as unknown as { __kiteVoiceStart: () => Promise<number> }).__kiteVoiceStart(),
    );
    /**
     * Wall time of a moment in the track.
     *
     * @param trackT Track seconds.
     * @returns Wall ms.
     */
    const trackWall = (trackT: number) => startWall + trackT * 1000;

    for (const question of questions) {
      const wait = trackWall(question.start) - 1_200 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      await page.bringToFront();
      await page.keyboard.press('Control+Shift+Space');
    }
    // The last question's answer.
    const last = questions.at(-1)!;
    await page.waitForTimeout(Math.max(0, trackWall(last.end) + 10_000 - Date.now()));
    for (const [index, info] of seen.entries()) {
      report(`${label} socket ${index} ${info.path}`, true, {
        sent: info.sent,
        received: info.received,
      });
    }
    report(`${label} microphone words`, wordEnds.length > 0, { words: wordEnds.length });
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await page.waitForTimeout(2_000);

    // The call's timing trace: each answer's send time and first word (numbers only).
    const traced = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.startsWith('kite.callTimings.'));
      if (!key) return [] as { sentAt: number; firstWordAt: number | null }[];
      const calls = JSON.parse(localStorage.getItem(key) ?? '[]') as {
        answers?: { sentAt?: number; firstWordAt?: number | null }[];
      }[];
      const call = calls.at(-1);
      return (call?.answers ?? []).map((answer) => ({
        sentAt: answer.sentAt ?? 0,
        firstWordAt: answer.firstWordAt ?? null,
      }));
    });

    const toSent: number[] = [];
    const toFirst: number[] = [];
    let whole = 0;
    let notWhole = 0;
    for (const [index, question] of questions.entries()) {
      const from = trackWall(question.start) - 300;
      const to = trackWall(question.end) + 600;
      const ends = wordEnds.map((end) => wallOf(end)).filter((end) => end >= from && end <= to);
      const endWall = ends.length > 0 ? Math.max(...ends) : Number.NaN;
      const next = questions[index + 1];
      const windowEnd = next ? trackWall(next.start) - 1_500 : Number.POSITIVE_INFINITY;
      const mine = sentQuestions.filter(
        (sent) => sent.wall >= trackWall(question.start) && sent.wall < windowEnd,
      );
      // The request that carried the whole question (a held one cancelled later carried only part).
      const complete = mine.find(
        (sent) =>
          sent.words >= question.words - 1 &&
          (!Number.isFinite(endWall) || sent.wall >= endWall - 200),
      );
      if (complete) whole += 1;
      else notWhole += 1;
      const sentMs =
        complete && Number.isFinite(endWall) ? Math.round(complete.wall - endWall) : null;
      const answer = complete
        ? traced.find((item) => Math.abs(item.sentAt - complete.wall) < 400)
        : undefined;
      const firstMs =
        answer?.firstWordAt != null && Number.isFinite(endWall)
          ? Math.round(answer.firstWordAt - endWall)
          : null;
      if (sentMs !== null) toSent.push(sentMs);
      if (firstMs !== null) toFirst.push(firstMs);
      report(`${label} q${question.q}`, complete !== undefined, {
        pauseMs: question.pauses[0]?.ms ?? 0,
        requests: mine.length,
        whole: complete ? 1 : 0,
        heardEnd: Number.isFinite(endWall) ? 1 : 0,
        ...(sentMs !== null ? { stopToSentMs: sentMs } : {}),
        ...(firstMs !== null ? { stopToFirstWordMs: firstMs } : {}),
      });
    }
    report(`${label} summary`, notWhole === 0, {
      whole,
      notWhole,
      sentP50: percentile(toSent, 50) ?? -1,
      sentP95: percentile(toSent, 95) ?? -1,
      firstWordP50: percentile(toFirst, 50) ?? -1,
      firstWordP95: percentile(toFirst, 95) ?? -1,
    });
  } finally {
    await context.close();
  }
});
