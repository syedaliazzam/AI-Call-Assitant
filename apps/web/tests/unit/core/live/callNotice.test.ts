/**
 * Tests apps/web/src/core/live/callNotice.ts (1.5.1, ADR-0069): a silent microphone or call sound comes
 * first, with a button to its device list and advice for the platform; then catching up; then the user's
 * lines set aside ("filled in after the call"); nothing when all is well.
 */
import { describe, expect, it } from 'vitest';
import { callNoticeFor } from '@/core/live/callNotice';

describe('callNoticeFor', () => {
  it('says the microphone is silent, with the microphone list', () => {
    const notice = callNoticeFor({ silent: 'you', backlog: 'dropping', platform: 'desktop' });
    expect(notice).toMatchObject({
      kind: 'mic-silent',
      text: "We can't hear your microphone — check the 🎤 picker.",
      action: { list: 'mic', label: 'Choose microphone' },
    });
    expect(notice?.detail).toContain('Privacy');
  });

  it('says the other side is silent, with the source list and the default-speaker advice', () => {
    const desktop = callNoticeFor({ silent: 'them', backlog: 'ok', platform: 'desktop' });
    expect(desktop).toMatchObject({
      kind: 'them-silent',
      text: "We can't hear the other side — check the audio source.",
      action: { list: 'audio' },
    });
    expect(desktop?.detail).toContain('default speaker');
    expect(callNoticeFor({ silent: 'them', backlog: 'ok', platform: 'browser' })?.detail).toContain(
      'tab audio',
    );
  });

  it('says it is catching up, then that the user lines come later, then nothing', () => {
    expect(callNoticeFor({ silent: null, backlog: 'dropping', platform: 'desktop' })?.kind).toBe(
      'catching-up',
    );
    expect(
      callNoticeFor({ silent: null, backlog: 'you-paused', platform: 'desktop' }),
    ).toMatchObject({
      kind: 'you-deferred',
      text: 'Your lines will be filled in after the call.',
    });
    expect(callNoticeFor({ silent: null, backlog: 'ok', platform: 'desktop' })).toBeNull();
  });
});
