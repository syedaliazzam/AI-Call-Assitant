/**
 * Tests apps/web/src/core/audio/channelSilence.ts (1.5.1, ADR-0069; Batch C, P1-5): the microphone counts as
 * silent after 15 s with no sound while the other side had sound in that time; the other side counts as
 * silent only after 60 s with no sound, while the user is not speaking (and was heard in that minute), so an
 * interview answer never raises it; never when nobody talks; a reset (new device or source) starts its clock
 * again.
 */
import { describe, expect, it } from 'vitest';
import {
  ChannelSilence,
  SILENT_FOR_MS,
  THEM_SILENT_FOR_MS,
  USER_PAUSE_MS,
} from '@/core/audio/channelSilence';

const LOUD = 0.6;

describe('ChannelSilence', () => {
  it('reports the microphone silent while the other side talks', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= SILENT_FOR_MS; t += 1_000) silence.levels({ you: 0, them: LOUD }, t);
    expect(silence.silent(SILENT_FOR_MS - 1)).toBeNull();
    expect(silence.silent(SILENT_FOR_MS)).toBe('you');
  });

  it('never reports the other side while the user answers, however long (Batch C, P1-5)', () => {
    const silence = new ChannelSilence(0);
    // A two-minute answer: the user talks without a break; the other side is silent all along.
    for (let t = 0; t <= 120_000; t += 500) {
      silence.levels({ you: LOUD, them: 0 }, t);
      expect(silence.silent(t)).toBeNull();
    }
  });

  it('reports the other side silent after 60 s once the user stops speaking', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= THEM_SILENT_FOR_MS; t += 1_000) silence.levels({ you: LOUD, them: 0 }, t);
    // The user just stopped: still "speaking" for USER_PAUSE_MS.
    expect(silence.silent(THEM_SILENT_FOR_MS + USER_PAUSE_MS - 1)).toBeNull();
    expect(silence.silent(THEM_SILENT_FOR_MS + USER_PAUSE_MS)).toBe('them');
  });

  it('does not report the other side before 60 s, even in a pause of the user', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= 20_000; t += 1_000) silence.levels({ you: LOUD, them: 0 }, t);
    expect(silence.silent(30_000)).toBeNull();
    expect(silence.silent(THEM_SILENT_FOR_MS - 1)).toBeNull();
  });

  it('reports nothing when nobody talks, or both do', () => {
    const quiet = new ChannelSilence(0);
    quiet.levels({ you: 0, them: 0 }, 20_000);
    expect(quiet.silent(40_000)).toBeNull();
    expect(quiet.silent(THEM_SILENT_FOR_MS * 2)).toBeNull();
    const both = new ChannelSilence(0);
    for (let t = 0; t <= 70_000; t += 1_000) both.levels({ you: LOUD, them: LOUD }, t);
    expect(both.silent(70_000)).toBeNull();
  });

  it('starts a channel again after a new device or source', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= SILENT_FOR_MS; t += 1_000) silence.levels({ you: 0, them: LOUD }, t);
    silence.reset('you', SILENT_FOR_MS);
    expect(silence.silent(SILENT_FOR_MS + 1_000)).toBeNull();
    const them = new ChannelSilence(0);
    for (let t = 0; t <= THEM_SILENT_FOR_MS; t += 1_000) them.levels({ you: LOUD, them: 0 }, t);
    them.reset('them', THEM_SILENT_FOR_MS);
    expect(them.silent(THEM_SILENT_FOR_MS + USER_PAUSE_MS)).toBeNull();
  });
});
