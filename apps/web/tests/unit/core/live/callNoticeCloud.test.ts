/**
 * Tests for the cloud-fallback notice in apps/web/src/core/live/callNotice.ts (ADR-0076): shown while a
 * channel of a cloud call uses the on-device engine, after a silent channel (which needs the user) and
 * before the on-device engine's own backlog notices.
 */
import { describe, expect, it } from 'vitest';
import { callNoticeFor } from '@/core/live/callNotice';

describe('cloud-fallback notice', () => {
  it('says the cloud is unavailable and on-device transcription is used', () => {
    const notice = callNoticeFor({
      silent: null,
      backlog: 'dropping',
      platform: 'desktop',
      cloudFallback: true,
    });
    expect(notice?.kind).toBe('cloud-fallback');
    expect(notice?.text).toBe('Cloud transcription unavailable — using on-device transcription.');
  });

  it('gives way to a silent channel, and is absent otherwise', () => {
    const silent = callNoticeFor({
      silent: 'you',
      backlog: 'ok',
      platform: 'desktop',
      cloudFallback: true,
    });
    expect(silent?.kind).toBe('mic-silent');
    expect(callNoticeFor({ silent: null, backlog: 'ok', platform: 'desktop' })).toBeNull();
  });
});
