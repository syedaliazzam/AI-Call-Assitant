/**
 * Tests for apps/web/src/features/live/overlay/StatusBar.tsx and ControlBar.tsx (ADR-0082): the overlay's
 * status bar is one row (level button, one line, Clear, collapse; ADR-0085: no language control) whose line shows the live words
 * or the current warning with its button, never both and never a second warning bar; in the transcript
 * panel's header it shows only messages. Bar 1 has no Answer, Screenshot or Chat buttons any more, and a
 * Click-through switch with its state and tooltip where clicks can pass (none where they cannot). The
 * Auto answer and Click-through switches show the short labels "AA" and "W" (no icons) and keep their
 * full names in aria-label and the tooltip.
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
    />,
  );
}

describe('StatusBar', () => {
  it('is one row with the level button, the live words, Clear and collapse', () => {
    const html = bar(QUIET);
    // ADR-0085: no answer-language control in the compact view.
    expect(html).not.toContain('Answer language');
    expect(bar(QUIET, false)).not.toContain('Answer language');
    // ADR-0085: no title attributes (a native tooltip is a separate, unprotected window).
    expect(html).not.toMatch(/ title="/);
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

  it('ADR-0085: pins the device icons and the Transcript switch, for every account, outside the part that gives way', () => {
    const html = bar1(QUIET, () => undefined);
    const pinned = html.indexOf('data-bar-pinned');
    const fitting = html.indexOf('data-fit-step');
    expect(pinned).toBeGreaterThan(-1);
    // The switch and the device lists come before the part that gives way, inside the pinned group.
    const transcript = html.indexOf('aria-label="Transcript"');
    expect(transcript).toBeGreaterThan(pinned);
    expect(transcript).toBeLessThan(fitting);
    expect(html.indexOf('aria-label="Choose microphone"')).toBeLessThan(fitting);
    // Auto answer and Click-through are in the part that gives way.
    expect(html.indexOf('aria-label="Auto answer"')).toBeGreaterThan(fitting);
    expect(html.indexOf('aria-label="Click-through"')).toBeGreaterThan(fitting);
  });

  it('labels Auto answer "AA" and Click-through "W", with no icon, keeping the full names for tooltips and screen readers', () => {
    const html = bar1(QUIET, () => undefined);
    const auto = switchMarkup(html, 'Auto answer');
    const through = switchMarkup(html, 'Click-through');
    // The only visible text is the short label: no bolt or pointer icon, no "Auto" or "Click-through" word.
    expect(visibleText(auto)).toBe('AA');
    expect(visibleText(through)).toBe('W');
    expect(auto).not.toContain('<svg');
    expect(through).not.toContain('<svg');
    // The short label is hidden from screen readers, which read the full name from aria-label instead.
    expect(auto).toContain('<span aria-hidden="true" class="inline-flex ">AA</span>');
    expect(through).toContain('<span aria-hidden="true" class="inline-flex ">W</span>');
    // The hover tooltip still names the control in full.
    expect(auto).toContain('data-tip="Auto answer: Off"');
    expect(through).toContain(
      'data-tip="Click-through: Off (turn on to click the app behind the overlay)',
    );
  });

  it('keeps the on/off styling of the "AA" and "W" toggles', () => {
    const off = bar1(QUIET, () => undefined);
    expect(switchMarkup(off, 'Auto answer')).toContain('text-ui-muted');
    expect(switchMarkup(off, 'Click-through')).toContain('text-ui-muted');
    const on = bar1({ ...QUIET, autoAnswer: true, clickThrough: true }, () => undefined);
    const auto = switchMarkup(on, 'Auto answer');
    const through = switchMarkup(on, 'Click-through');
    expect(auto).toMatch(/aria-checked="true"/);
    expect(auto).toContain('ring-ui-indicator');
    expect(auto).toContain('class="inline-flex text-ui-indicator">AA</span>');
    expect(through).toMatch(/aria-checked="true"/);
    expect(through).toContain('ring-ui-accent-fill');
    expect(through).toContain('class="inline-flex text-ui-accent">W</span>');
  });
});

/**
 * One switch's markup on bar 1, from its opening tag to its closing tag (the toggles hold no nested buttons).
 *
 * @param html The bar's markup.
 * @param name The switch's aria-label.
 * @returns The switch's markup.
 * @throws Error when the bar has no such switch.
 */
function switchMarkup(html: string, name: string): string {
  const label = html.indexOf(`aria-label="${name}"`);
  if (label < 0) throw new Error(`no switch named ${name}`);
  const start = html.lastIndexOf('<button', label);
  return html.slice(start, html.indexOf('</button>', label) + '</button>'.length);
}

/**
 * The text a sighted user sees in some markup: the tags (and React's text-joining comments) removed.
 *
 * @param markup Server-rendered HTML.
 * @returns Its text, trimmed.
 */
function visibleText(markup: string): string {
  return markup
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

describe('the rename offer on the status bar (ADR-0093)', () => {
  it('shows the question with its two buttons', () => {
    const html = bar({ ...QUIET, themName: 'Them', nameOffer: 'Sarah' });
    expect(html).toContain('data-status="rename-them"');
    expect(html).toContain('Rename Them to Sarah?');
    expect(html).toContain('>Rename<');
    expect(html).toContain('>Not now<');
  });
});
