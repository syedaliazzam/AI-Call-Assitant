/**
 * Tests for apps/web/src/features/live/PrivateOffWarning.tsx (1.5.2, ADR-0070): the warning shows only while
 * a screen recording runs with Private off (not for a sound-only recording, not while starting or off, not
 * when Private's state is unknown); it says "Private is off: Paramount AI will appear in your recording"
 * with the one-click "Turn Private back on", in the overlay's bar (with its bars attribute) and in the call
 * window; the Rec pill reads "Visible in recording".
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    getShareProtection: async () => ({ supported: true, on: false }),
    setShareProtection: async (on: boolean) => ({ supported: true, on }),
  }),
}));
const {
  PRIVATE_BACK_ON_TEXT,
  PRIVATE_OFF_TEXT,
  PrivateOffWarning,
  VISIBLE_IN_RECORDING_TEXT,
  visibleInRecording,
} = await import('@/features/live/PrivateOffWarning');
const { RecPill } = await import('@/features/live/overlay/RecordControls');

describe('visibleInRecording', () => {
  it('is true only for a running screen recording with Private off', () => {
    expect(visibleInRecording({ state: 'on', kind: 'screen' }, false)).toBe(true);
    expect(visibleInRecording({ state: 'on', kind: 'screen' }, true)).toBe(false);
    expect(visibleInRecording({ state: 'on', kind: 'audio' }, false)).toBe(false);
    expect(visibleInRecording({ state: 'starting', kind: 'screen' }, false)).toBe(false);
    expect(visibleInRecording({ state: 'off', kind: 'screen' }, false)).toBe(false);
    expect(visibleInRecording({ state: 'on', kind: 'screen' }, null)).toBe(false);
    expect(visibleInRecording(undefined, false)).toBe(false);
  });
});

describe('PrivateOffWarning', () => {
  it('says what happens and offers the fix, in the overlay and in the call window', () => {
    const overlay = renderToString(
      <PrivateOffWarning look="overlay" onTurnOn={() => undefined} barsAttribute="data-bars" />,
    );
    expect(overlay).toContain(PRIVATE_OFF_TEXT);
    expect(overlay).toContain(PRIVATE_BACK_ON_TEXT);
    expect(overlay).toContain('data-bars');
    const window = renderToString(<PrivateOffWarning look="window" onTurnOn={() => undefined} />);
    expect(window).toContain(PRIVATE_OFF_TEXT);
    expect(window).toContain(PRIVATE_BACK_ON_TEXT);
    expect(PRIVATE_OFF_TEXT).toBe('Private is off: Paramount AI will appear in your recording');
    expect(PRIVATE_BACK_ON_TEXT).toBe('Turn Private back on');
  });

  it('puts "Visible in recording" on the Rec pill while recording', () => {
    const recording = {
      state: 'on' as const,
      startedAt: Date.now(),
      kind: 'screen' as const,
      displays: [],
      displayId: null,
      stereo: true,
      promptCount: 0,
      parts: 1,
      notice: null,
    };
    const pill = (visible: boolean) =>
      renderToString(
        <RecPill
          recording={recording}
          open={false}
          onToggle={() => undefined}
          disabled={false}
          mac={false}
          visibleInRecording={visible}
        />,
      );
    expect(pill(true)).toContain(VISIBLE_IN_RECORDING_TEXT);
    expect(pill(false)).not.toContain(VISIBLE_IN_RECORDING_TEXT);
  });
});
