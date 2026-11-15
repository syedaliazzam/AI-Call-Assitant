/**
 * Tests for apps/web/src/features/live/overlay/StatusBar.tsx and ControlBar.tsx (ADR-0082): the overlay's
 * status bar is one row (level button, language, one line, Clear, collapse) whose line shows the live words
 * or the current warning with its button, never both and never a second warning bar; in the transcript
 * panel's header it shows only messages. Bar 1 has no Answer, Screenshot or Chat buttons any more, and a
 * Click-through switch with its state and tooltip where clicks can pass (none where they cannot).
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CompactState } from '@/core/live/liveChannel';

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    getShareProtection: async () => ({ supported: true, on: true }),
    setShareProtection: async (on: boolean) => ({ supported: true, on }),
    hotkeyModifier: () => 'Ctrl',
  }),
}));
const { StatusBar } = await import('@/features/live/overlay/StatusBar');
const { ControlBar } = await import('@/features/live/overlay/ControlBar');

/** A call's overlay state with nothing to say. */
const QUIET: CompactState = {
  audio: { you: true, them: true },
  chips: [{ id: 'c1', speaker: 'them', text: 'tell me about' }],
  answer: null,
  index: -1,
  total: 0,
  answering: false,
  capturing: false,
  notice: null,
  ended: false,
};

/**
 * The status bar as HTML.
 *
 * @param state The overlay state.
 * @param words True for bar 2, false for the transcript panel's header.
 * @returns The markup.
 */
function bar(state: CompactState, words = true): string {
  return renderToString(
    <StatusBar
      state={state}
      chips={state.chips}
      question={null}
      words={words}
      transcriptOpen={!words}
      onTranscript={() => undefined}
      onCommand={() => undefined}
      onClear={() => undefined}
      onCollapse={() => undefined}
      collapseLabel="Hide the status bar"
      onList={() => undefined}
      privateOff={false}
      onPrivateOn={() => undefined}
      mac={false}
      languagesOpen={false}
      onLanguagesOpen={() => undefined}
    />,
  );
}

describe('StatusBar', () => {
  it('is one row with the level button, language, the live words, Clear and collapse', () => {
    const html = bar(QUIET);
    expect(html).toContain('aria-label="Status bar"');
    expect(html).toContain('aria-label="Show the transcript"');
    expect(html).toContain('tell me about');
    expect(html).toContain('aria-label="Clear transcript"');
    expect(html).toContain('aria-label="Hide the status bar"');
    expect(html).not.toContain('data-status=');
  });

  it("shows the warning with its button instead of the words: can't hear the other side", () => {
    const html = bar({
      ...QUIET,
      callNotice: {
        kind: 'them-silent',
        text: "We can't hear the other side — check the audio source.",
        detail: '',
        action: { list: 'audio', label: 'Choose audio source' },
      },
    });
    expect(html).toContain('data-status="them-silent"');
    expect(html).toContain('Can&#x27;t hear the other side');
    expect(html).toContain('Choose audio source');
    expect(html).not.toContain('tell me about');
  });

  it('shows "Listening…" with Cancel while a voice question listens', () => {
    const html = bar({ ...QUIET, dictating: true });
    expect(html).toContain('Listening… (Esc cancels)');
    expect(html).toContain('>Cancel<');
  });

  it('in the transcript panel shows messages only, never the words', () => {
    expect(bar(QUIET, false)).not.toContain('tell me about');
    expect(bar({ ...QUIET, headphonesHint: true }, false)).toContain('Speakers echoing');
    expect(bar(QUIET, false)).toContain('aria-label="Hide the transcript"');
  });
});

/**
 * Bar 1 as HTML.
 *
 * @param state          The overlay state.
 * @param onClickThrough The Click-through toggle's handler, or undefined where clicks cannot pass.
 * @returns The markup.
 */
function bar1(state: CompactState, onClickThrough?: (on: boolean) => void): string {
  return renderToString(
    <ControlBar
      state={state}
      onCommand={() => undefined}
      mac={false}
      collapsed={false}
      onCollapse={() => undefined}
      menuOpen={false}
      onMenu={() => undefined}
      deviceList={null}
      onDeviceList={() => undefined}
      menuButton={{ current: null }}
      referenceLook
      transcriptOpen={false}
      onTranscript={() => undefined}
      {...(onClickThrough ? { onClickThrough } : {})}
    />,
  );
}

describe('ControlBar (bar 1)', () => {
  it('has no Answer, Screenshot or Chat buttons (the shortcuts do those)', () => {
    const html = bar1(QUIET, () => undefined);
    expect(html).not.toContain('aria-label="Answer"');
    expect(html).not.toContain('aria-label="Screenshot"');
    expect(html).not.toContain('aria-label="Chat"');
    expect(html).toContain('aria-label="Exit: end call"');
    expect(html).toContain('aria-label="Overlay menu"');
  });

  it('has a Click-through switch with its state and shortcut in the tooltip', () => {
    const off = bar1(QUIET, () => undefined);
    expect(off).toContain('aria-label="Click-through"');
    expect(off).toMatch(/aria-checked="false"[^>]*aria-label="Click-through"/);
    expect(off).toContain('Click-through: Off');
    expect(off).toContain('Ctrl+Alt+X');
    const on = bar1({ ...QUIET, clickThrough: true }, () => undefined);
    expect(on).toMatch(/aria-checked="true"[^>]*aria-label="Click-through"/);
    expect(on).toContain('Click-through: On');
  });

  it('has no Click-through switch where clicks cannot pass (a browser window)', () => {
    expect(bar1(QUIET)).not.toContain('aria-label="Click-through"');
  });
});
