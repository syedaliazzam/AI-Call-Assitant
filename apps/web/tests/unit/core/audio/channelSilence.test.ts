/**
 * Tests apps/web/src/core/audio/channelSilence.ts (1.5.1, ADR-0069): a channel counts as silent after 15 s
 * with no sound while the other channel had sound in that time; never when nobody talks; a reset (new
 * device or source) starts its clock again.
 */
import { describe, expect, it } from 'vitest';
import { ChannelSilence, SILENT_FOR_MS } from '@/core/audio/channelSilence';

const LOUD = 0.6;

describe('ChannelSilence', () => {
  it('reports the microphone silent while the other side talks', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= SILENT_FOR_MS; t += 1_000) silence.levels({ you: 0, them: LOUD }, t);
    expect(silence.silent(SILENT_FOR_MS - 1)).toBeNull();
    expect(silence.silent(SILENT_FOR_MS)).toBe('you');
  });

  it('reports the other side silent while the user talks', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= SILENT_FOR_MS; t += 1_000) silence.levels({ you: LOUD, them: 0 }, t);
    expect(silence.silent(SILENT_FOR_MS)).toBe('them');
  });

  it('reports nothing when nobody talks, or both do', () => {
    const quiet = new ChannelSilence(0);
    quiet.levels({ you: 0, them: 0 }, 20_000);
    expect(quiet.silent(40_000)).toBeNull();
    const both = new ChannelSilence(0);
    for (let t = 0; t <= 20_000; t += 1_000) both.levels({ you: LOUD, them: LOUD }, t);
    expect(both.silent(20_000)).toBeNull();
  });

  it('starts a channel again after a new device', () => {
    const silence = new ChannelSilence(0);
    for (let t = 0; t <= SILENT_FOR_MS; t += 1_000) silence.levels({ you: 0, them: LOUD }, t);
    silence.reset('you', SILENT_FOR_MS);
    expect(silence.silent(SILENT_FOR_MS + 1_000)).toBeNull();
  });
});
