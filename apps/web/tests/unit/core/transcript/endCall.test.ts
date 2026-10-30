/**
 * Tests for apps/web/src/core/transcript/endCall.ts with the real transcript and saver, a fake
 * store and a fake engine: the line that becomes final only while the call ends (flushed by the
 * detach, delivered before drain() resolves) is saved, and the transcript is cleared only after
 * that; the steps run in order (stop capture, drain, stop saver, flush, clear); with saving off
 * the transcript is still cleared. This is the Day 3 end-to-end finding ("End drops the line
 * being spoken"). All text is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StoredUtterance } from '@/core/storage/types';
import { endCall } from '@/core/transcript/endCall';
import { startTranscriptSaver } from '@/core/transcript/saver';
import { createTranscript } from '@/core/transcript/transcript';

describe('endCall', () => {
  it('saves the line flushed by End, then clears the transcript', async () => {
    const transcript = createTranscript(() => 10_000);
    const saved: string[] = [];
    const saver = startTranscriptSaver(transcript, 's1', {
      callId: 'c1',
      store: {
        save: async (utterance: StoredUtterance) => {
          saved.push(utterance.text);
        },
        remove: async () => undefined,
      },
    });
    transcript.addFinal({ speaker: 'them', text: 'FIRST LINE', tStart: 1_000, tEnd: 2_000 });
    const steps: string[] = [];
    await endCall({
      stopCapture: () => steps.push('stop capture'),
      engine: {
        // As the real engine: the worker's flushed final line arrives before the pong.
        drain: async () => {
          steps.push('drain');
          transcript.addFinal({ speaker: 'them', text: 'LAST LINE', tStart: 5_000, tEnd: 7_000 });
        },
      },
      saver,
      transcript: {
        clear: () => {
          steps.push(`clear (${saved.length} saved)`);
          transcript.clear();
        },
      },
    });
    expect(saved).toEqual(['FIRST LINE', 'LAST LINE']);
    expect(steps).toEqual(['stop capture', 'drain', 'clear (2 saved)']);
    expect(transcript.allLines()).toHaveLength(0);
  });

  it('stops the saver before clearing, so the clear itself writes nothing', async () => {
    const transcript = createTranscript(() => 10_000);
    const save = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const saver = startTranscriptSaver(transcript, 's1', { store: { save, remove } });
    transcript.addFinal({ speaker: 'you', text: 'HELLO THERE', tStart: 1_000, tEnd: 2_000 });
    await endCall({ stopCapture: () => undefined, engine: null, saver, transcript });
    expect(save).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('clears the transcript when saving is off', async () => {
    const transcript = createTranscript(() => 10_000);
    transcript.addFinal({ speaker: 'them', text: 'NOT KEPT', tStart: 1_000, tEnd: 2_000 });
    const drain = vi.fn(async () => undefined);
    await endCall({ stopCapture: () => undefined, engine: { drain }, saver: null, transcript });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(transcript.allLines()).toHaveLength(0);
  });
});
