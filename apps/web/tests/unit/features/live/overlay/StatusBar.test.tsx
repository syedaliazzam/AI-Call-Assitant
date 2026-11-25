/**
 * Tests for apps/web/src/features/live/overlay/StatusBar.tsx, WarningLine.tsx and ControlBar.tsx. ADR-0118: bar 2
 * (the transcript bar) is one row (level button, the live words as phrase chips, Clear, the expand button) that
 * always shows the words and never a warning or a collapse button; the warning has its own slim line
 * (WarningLine.tsx) with its button. ADR-0085: no language control. Bar 1 has no Answer, Screenshot or
 * (ADR-0118) Transcript buttons, ADR-0122: a Chat button with its shortcut; and a Click-through switch with its state and tooltip where clicks can pass (none
 * where they cannot). The Auto answer and Click-through switches show the short labels "AA" and "W" (no icons) and
 * keep their full names in aria-label and the tooltip.
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
  // ADR-0120 §4: the recording warning asks whether this is a Mac (useIsMac); here it is not.
  isMacComputer: () => false,
}));
const { StatusBar } = await import('@/features/live/overlay/StatusBar');
const { WarningLine } = await import('@/features/live/overlay/WarningLine');
const { statusMessage } = await import('@/features/live/overlay/statusLine');
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
 * The transcript bar as HTML.
 *
 * @param state The overlay state.
 * @param open  True while the full transcript panel is open.
 * @returns The markup.
 */
function bar(state: CompactState, open = false): string {
  return renderToString(
    <StatusBar
      state={state}
      chips={state.chips}
      transcriptOpen={open}
      onTranscript={() => undefined}
      onClear={() => undefined}
      mac={false}
    />,
  );
}

/**
 * The warning line for a state, as HTML (empty when no message applies).
 *
 * @param state The overlay state.
 * @returns The markup.
 */
function warning(state: CompactState): string {
  const message = statusMessage(state, false);
  return message
    ? renderToString(
        <WarningLine
          message={message}
          onCommand={() => undefined}
          onList={() => undefined}
          onPrivateOn={() => undefined}
        />,
      )
    : '';
}

describe('StatusBar (ADR-0118: the transcript bar)', () => {
  it('is one row with the level button, the live words, Clear and the expand button; no collapse', () => {
    const html = bar(QUIET);
    // ADR-0085: no answer-language control in the compact view.
    expect(html).not.toContain('Answer language');
    // ADR-0085: no title attributes (a native tooltip is a separate, unprotected window).
    expect(html).not.toMatch(/ title="/);
    expect(html).toContain('aria-label="Status bar"');
    expect(html).toContain('aria-label="Show the transcript"');
    expect(html).toContain('tell me about');
    expect(html).toContain('aria-label="Clear transcript"');
    expect(html).toContain('aria-label="Open the full transcript"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('Hide the status bar');
    expect(html).not.toContain('data-status=');
  });

  it('keeps showing the words while a warning applies (the warning is on its own line)', () => {
    const html = bar({
      ...QUIET,
      callNotice: {
        kind: 'them-silent',
        text: "We can't hear the other side — check the audio source.",
        detail: '',
        action: { list: 'audio', label: 'Choose audio source' },
      },
    });
    expect(html).toContain('tell me about');
    expect(html).not.toContain('Choose audio source');
  });

  it('shows up to ten chips in one line, oldest first, and names the open panel', () => {
    const chips = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      speaker: 'them' as const,
      text: `phrase ${i}`,
    }));
    const html = bar({ ...QUIET, chips }, true);
    expect(html).not.toContain('phrase 1<');
    expect(html).toContain('phrase 2<');
    expect(html).toContain('phrase 11<');
    expect(html.indexOf('phrase 2<')).toBeLessThan(html.indexOf('phrase 11<'));
    expect(html).toContain('data-words-line');
    expect(html).toContain('aria-label="Hide the transcript"');
    expect(html).toContain('aria-label="Close the full transcript"');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('StatusBar (ADR-0123: what Ctrl+Enter answers now)', () => {
  it('shows a small "Them" hint on a call and "You" on your own, with the sentence for screen readers', () => {
    const them = bar({ ...QUIET, pressTarget: 'them' });
    expect(them).toContain('data-press-hint="them"');
    expect(them).toContain(
      'aria-label="Ctrl+Enter answers the other person&#x27;s newest question"',
    );
    expect(them).toMatch(/>Them</);
    const you = bar({ ...QUIET, pressTarget: 'you' });
    expect(you).toContain('data-press-hint="you"');
    expect(you).toContain('aria-label="Ctrl+Enter answers your own newest question"');
    expect(you).toMatch(/text-ui-you[^>]*>You</);
    // Never a tooltip window (a title is drawn outside the protected overlay).
    expect(them).not.toContain('title=');
  });

  it('shows no hint for an older live page or once the call has ended', () => {
    expect(bar(QUIET)).not.toContain('data-press-hint');
    expect(bar({ ...QUIET, pressTarget: 'you', ended: true })).not.toContain('data-press-hint');
  });
});

describe('WarningLine (ADR-0118)', () => {
  it("shows can't hear the other side with its button", () => {
    const html = warning({
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
    const html = warning({ ...QUIET, dictating: true });
    expect(html).toContain('Listening… (Esc cancels)');
    expect(html).toContain('>Cancel<');
  });

  it('is nothing at all when no message applies', () => {
    expect(warning(QUIET)).toBe('');
  });
});

/**
 * Bar 1 as HTML.
 *
 * @param state          The overlay state.
 * @param onClickThrough The Click-through toggle's handler, or undefined where clicks cannot pass.
 * @param onChat         ADR-0122: the Chat button's handler, or undefined for no Chat button.
 * @param passAll        ADR-0055 (amended 26 Nov 2026): the whole overlay passes clicks (bar 1's hint).
 * @param mac            True for a Mac's key names.
 * @returns The markup.
 */
function bar1(
  state: CompactState,
  onClickThrough?: (on: boolean) => void,
  onChat?: () => void,
  passAll = false,
  mac = false,
): string {
  return renderToString(
    <ControlBar
      state={state}
      onCommand={() => undefined}
      mac={mac}
      collapsed={false}
      onCollapse={() => undefined}
      menuOpen={false}
      onMenu={() => undefined}
      deviceList={null}
      onDeviceList={() => undefined}
      menuButton={{ current: null }}
      {...(onClickThrough ? { onClickThrough } : {})}
      {...(onChat ? { onChat } : {})}
      passAll={passAll}
    />,
  );
}

describe('ControlBar (bar 1)', () => {
  it('has no Answer or Screenshot buttons (the shortcuts do those)', () => {
    const html = bar1(
      QUIET,
      () => undefined,
      () => undefined,
    );
    expect(html).not.toContain('aria-label="Answer"');
    expect(html).not.toContain('aria-label="Screenshot"');
    expect(html).toContain('aria-label="Exit: end call"');
    expect(html).toContain('aria-label="Overlay menu"');
  });

  it('ADR-0122: has Chat with its shortcut shown, first in the part that gives way', () => {
    const html = bar1(
      QUIET,
      () => undefined,
      () => undefined,
    );
    expect(html).toContain('aria-label="Chat"');
    expect(html).toContain('aria-keyshortcuts="Ctrl+Alt+K"');
    expect(html).toContain('data-tip="Chat: type a question · Ctrl+Alt+K"');
    // A click gives the keyboard back to the meeting (only a click into the chat bar's box takes it).
    expect(html).toMatch(/<button[^>]*aria-label="Chat"[^>]*data-releases-focus=""/);
    // Before Auto answer, inside the part that gives way (data-fit-step).
    const fitPart = html.slice(html.indexOf('data-fit-step'));
    expect(fitPart.indexOf('aria-label="Chat"')).toBeGreaterThan(-1);
    expect(fitPart.indexOf('aria-label="Chat"')).toBeLessThan(
      fitPart.indexOf('aria-label="Auto answer"'),
    );
    // Without the handler: no Chat button.
    expect(bar1(QUIET, () => undefined)).not.toContain('aria-label="Chat"');
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

  it('ADR-0055 (amended 26 Nov 2026): while the whole overlay passes clicks, shows only the hint in place of Chat, AA, the model and W', () => {
    const on = { ...QUIET, clickThrough: true };
    const html = bar1(
      on,
      () => undefined,
      () => undefined,
      true,
    );
    expect(html).toContain('data-click-through-hint');
    expect(html).toContain('Click-through on — press Ctrl+Alt+X to turn off');
    // Text, not a control: nothing on the overlay can be pressed in this mode.
    expect(html).not.toMatch(/<button[^>]*data-click-through-hint/);
    expect(html).not.toContain('aria-label="Click-through"');
    expect(html).not.toContain('aria-label="Chat"');
    expect(html).not.toContain('aria-label="Auto answer"');
    // The pinned controls stay (they show the call's state; the shortcut turns the mode off).
    expect(html).toContain('aria-label="Exit: end call"');
    expect(html).toContain('aria-label="Overlay menu"');
    // A Mac names its own key.
    expect(bar1(on, () => undefined, undefined, true, true)).toContain(
      'Click-through on — press ⌘ ⌥ X to turn off',
    );
  });

  it('ADR-0055 (amended 26 Nov 2026): Click-through off, or on with its key taken: no hint, W as before', () => {
    const off = bar1(
      QUIET,
      () => undefined,
      () => undefined,
      false,
    );
    expect(off).not.toContain('data-click-through-hint');
    expect(off).toContain('aria-label="Click-through"');
    expect(off).toContain('aria-label="Chat"');
    // The key held by another app: CompactView passes passAll=false, so W stays to turn it off.
    const taken = bar1(
      { ...QUIET, clickThrough: true, clickThroughKeyTaken: true },
      () => undefined,
    );
    expect(taken).not.toContain('data-click-through-hint');
    expect(taken).toMatch(/aria-checked="true"[^>]*aria-label="Click-through"/);
  });

  it('has no Click-through switch where clicks cannot pass (a browser window)', () => {
    expect(bar1(QUIET)).not.toContain('aria-label="Click-through"');
  });

  it('ADR-0085: pins the device icons outside the part that gives way; ADR-0118: no Transcript switch', () => {
    const html = bar1(QUIET, () => undefined);
    const pinned = html.indexOf('data-bar-pinned');
    const fitting = html.indexOf('data-fit-step');
    expect(pinned).toBeGreaterThan(-1);
    // ADR-0118: bar 2's level and expand buttons open the full transcript; bar 1 has no switch for it.
    expect(html).not.toContain('aria-label="Transcript"');
    // The device lists come before the part that gives way, inside the pinned group.
    expect(html.indexOf('aria-label="Choose microphone"')).toBeGreaterThan(pinned);
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

describe('the rename offer on the warning line (ADR-0093, ADR-0118)', () => {
  it('shows the question with its two buttons', () => {
    const html = warning({ ...QUIET, themName: 'Them', nameOffer: 'Sarah' });
    expect(html).toContain('data-status="rename-them"');
    expect(html).toContain('Rename Them to Sarah?');
    expect(html).toContain('>Rename<');
    expect(html).toContain('>Not now<');
  });
});
