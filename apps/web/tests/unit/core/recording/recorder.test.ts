/**
 * Tests for apps/web/src/core/recording/recorder.ts (desktop 1.5.0, ADR-0068), with fake Web Audio,
 * MediaRecorder and recording host: a screen recording opens the screen at the quality's size, opens the
 * files with the chosen container, sends every piece in order (main and stereo), and on stop waits for
 * the last pieces, stops the screen and has the shell finalise; no stereo file when the transcript is not
 * saved; a sound-only recording opens no screen; failures to start say why and release the screen; a full
 * drive and a failed write stop it by themselves; low space is reported; a new microphone joins the mix.
 */
import type { LocalRecording, RecordingTrack } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  RecordingStartError,
  startRecording,
  type RecorderDeps,
  type RecordingStart,
} from '@/core/recording/recorder';
import type { RecordingHost } from '@/platform';

/** A fake track. */
interface FakeTrack {
  /** Its kind. */
  kind: 'audio' | 'video';
  /** Whether stop() was called. */
  stopped: boolean;
  /** Stops it. */
  stop: () => void;
  /** 'ended' listeners. */
  listeners: (() => void)[];
  /** Adds an 'ended' listener. */
  addEventListener: (type: string, listener: () => void) => void;
}

/**
 * A fake track.
 * @param kind Its kind.
 * @returns The track.
 */
function track(kind: 'audio' | 'video'): FakeTrack {
  const t: FakeTrack = {
    kind,
    stopped: false,
    listeners: [],
    stop: () => {
      t.stopped = true;
    },
    addEventListener: (_type, listener) => t.listeners.push(listener),
  };
  return t;
}

/**
 * A fake stream.
 * @param tracks Its tracks.
 * @returns The stream.
 */
function stream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream;
}

/** A fake MediaRecorder that the test feeds pieces into. */
interface FakeRecorder {
  /** Its options. */
  options: MediaRecorderOptions;
  /** 'recording' or 'inactive'. */
  state: string;
  /** The timeslice it was started with. */
  timeslice: number | undefined;
  /** Its piece handler. */
  ondataavailable: ((event: { data: Blob }) => void) | null;
  /** Hands over a piece of the given text. */
  piece: (text: string) => void;
}

/**
 * The fakes for one recording.
 * @param hostChanges Host methods to replace.
 * @returns The fakes.
 */
function setup(hostChanges: Partial<RecordingHost> = {}) {
  const recorders: FakeRecorder[] = [];
  const written: { track: RecordingTrack; text: string }[] = [];
  const screenVideo = track('video');
  const connections: string[] = [];
  let sourceCount = 0;
  const deps: RecorderDeps = {
    isTypeSupported: () => true,
    hardwareH264: async () => true,
    createStream: (tracks) => stream(tracks as unknown as FakeTrack[]),
    now: () => 50_000,
    createAudioContext: () =>
      ({
        state: 'running',
        resume: async () => undefined,
        close: async () => undefined,
        createMediaStreamDestination: () => ({ stream: stream([track('audio')]) }),
        createChannelMerger: () => ({ connect: () => undefined }),
        createMediaStreamSource: () => {
          const id = `source${(sourceCount += 1)}`;
          return {
            connect: (_target: unknown, _out?: number, input?: number) =>
              connections.push(`${id}->${input ?? 'mix'}`),
            disconnect: () => connections.push(`${id} off`),
          };
        },
      }) as unknown as AudioContext,
    createMediaRecorder: (_stream, options) => {
      const stopListeners: (() => void)[] = [];
      const recorder = {
        options,
        state: 'inactive',
        timeslice: undefined as number | undefined,
        ondataavailable: null as ((event: { data: Blob }) => void) | null,
        start(timeslice?: number) {
          recorder.state = 'recording';
          recorder.timeslice = timeslice;
        },
        stop() {
          recorder.state = 'inactive';
          // The last piece arrives with the stop.
          recorder.ondataavailable?.({ data: new Blob(['last']) });
          for (const listener of stopListeners) listener();
        },
        addEventListener: (_type: string, listener: () => void) => stopListeners.push(listener),
        piece: (text: string) => recorder.ondataavailable?.({ data: new Blob([text]) }),
      };
      recorders.push(recorder);
      return recorder as unknown as MediaRecorder;
    },
  };
  const closed: LocalRecording = {
    id: 'r1',
    sessionId: 's1',
    meetingId: 'm1',
    part: 1,
    kind: 'screen',
    startedAt: 50_000,
    durationMs: 3_000,
    bytes: 12,
    fileName: 'a.mkv',
    hasStereo: true,
    status: 'complete',
  };
  const host = {
    openScreen: vi.fn(async () => stream([screenVideo])),
    open: vi.fn(async () => ({ ok: true as const, fileName: 'a.mkv', freeBytes: 9e9 })),
    write: vi.fn(async (_id: string, t: RecordingTrack, bytes: Uint8Array) => {
      written.push({ track: t, text: new TextDecoder().decode(bytes) });
      return { ok: true, disk: 'ok' as const, freeBytes: 9e9 };
    }),
    close: vi.fn(async () => ({ ok: true, recording: closed })),
    ...hostChanges,
  } as unknown as RecordingHost;
  return { deps, host, recorders, written, screenVideo, connections };
}

/** The start of an invented screen recording. */
const START: RecordingStart = {
  id: 'r1',
  sessionId: 's1',
  meetingId: 'm1',
  part: 1,
  kind: 'screen',
  quality: 'standard',
  displayId: '2',
  stereo: true,
  you: stream([track('audio')]),
  them: stream([track('audio')]),
};

/**
 * Lets queued writes run.
 * @returns After one turn of the event loop.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startRecording', () => {
  it('records the screen and both sides, in order, and finalises on stop', async () => {
    const f = setup();
    const recording = await startRecording(f.host, START, {}, f.deps);
    expect(f.host.openScreen).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1280, height: 720, frameRate: 15 }),
      '2',
    );
    expect(f.host.open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', container: 'mkv', stereo: true, startedAt: 50_000 }),
    );
    expect(f.recorders).toHaveLength(2);
    expect(f.recorders[0]!.timeslice).toBe(1_000);
    expect(f.recorders[0]!.options.videoBitsPerSecond).toBe(1_500_000);
    // You on the stereo file's left (0), Them on the right (1), both in the mix.
    expect(f.connections).toEqual(['source1->mix', 'source1->0', 'source2->mix', 'source2->1']);
    f.recorders[0]!.piece('one');
    f.recorders[1]!.piece('s-one');
    f.recorders[0]!.piece('two');
    const local = await recording.stop();
    expect(f.written).toEqual([
      { track: 'main', text: 'one' },
      { track: 'stereo', text: 's-one' },
      { track: 'main', text: 'two' },
      { track: 'main', text: 'last' },
      { track: 'stereo', text: 'last' },
    ]);
    expect(f.screenVideo.stopped).toBe(true);
    expect(f.host.close).toHaveBeenCalledWith('r1');
    expect(local?.durationMs).toBe(3_000);
    expect(await recording.stop()).toBeNull();
  });

  it('writes no stereo file when the transcript is not saved, and no screen for sound only', async () => {
    const f = setup();
    await startRecording(f.host, { ...START, kind: 'audio', stereo: false }, {}, f.deps);
    expect(f.host.openScreen).not.toHaveBeenCalled();
    expect(f.recorders).toHaveLength(1);
    expect(f.recorders[0]!.options.mimeType).toBe('audio/webm;codecs=opus');
    expect(f.host.open).toHaveBeenCalledWith(expect.objectContaining({ container: 'webm' }));
  });

  it('says why it cannot start, and releases the screen', async () => {
    const lowDisk = setup({
      open: vi.fn(async () => ({ ok: false as const, reason: 'low-disk' as const })),
    });
    await expect(startRecording(lowDisk.host, START, {}, lowDisk.deps)).rejects.toMatchObject({
      reason: 'low-disk',
    });
    expect(lowDisk.screenVideo.stopped).toBe(true);
    const noScreen = setup({
      openScreen: vi.fn(async () => {
        throw new Error('denied');
      }),
    });
    await expect(startRecording(noScreen.host, START, {}, noScreen.deps)).rejects.toBeInstanceOf(
      RecordingStartError,
    );
  });

  it('stops by itself on a full drive or a failed write, and reports low space', async () => {
    const disks = ['low', 'stop'] as const;
    let call = 0;
    const f = setup({
      write: vi.fn(async () => ({ ok: true, disk: disks[call++] ?? 'stop', freeBytes: 1 })),
    });
    const onDisk = vi.fn();
    const onStopped = vi.fn();
    await startRecording(f.host, START, { onDisk, onStopped }, f.deps);
    f.recorders[0]!.piece('a');
    f.recorders[0]!.piece('b');
    await settle();
    await settle();
    expect(onDisk).toHaveBeenCalledWith('low');
    expect(onStopped).toHaveBeenCalledWith('disk-full');

    const failing = setup({
      write: vi.fn(async () => ({ ok: false, disk: 'ok' as const, freeBytes: 0 })),
    });
    const failed = vi.fn();
    await startRecording(failing.host, START, { onStopped: failed }, failing.deps);
    failing.recorders[0]!.piece('a');
    await settle();
    await settle();
    expect(failed).toHaveBeenCalledWith('write-failed');
  });

  it('stops by itself when the screen goes, and takes a new microphone into the mix', async () => {
    const f = setup();
    const onStopped = vi.fn();
    const recording = await startRecording(f.host, START, { onStopped }, f.deps);
    recording.replaceSource('you', stream([track('audio')]));
    expect(f.connections.slice(-3)).toEqual(['source1 off', 'source3->mix', 'source3->0']);
    for (const listener of f.screenVideo.listeners) listener();
    expect(onStopped).toHaveBeenCalledWith('screen-ended');
  });
});
