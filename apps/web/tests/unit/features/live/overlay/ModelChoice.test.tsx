/**
 * Tests for apps/web/src/features/live/overlay/ModelChoice.tsx and its use in ControlBar.tsx and
 * LiveMenu.tsx (ADR-0094): the two choices with the current one checked; Smart disabled (aria-disabled,
 * so its tooltip still opens) when an admin has turned it off; the toast's words; bar 1's chip next to
 * Auto answer with the model's name, only when the live page says its model; and the ⋮ menu's Model row.
 * ADR-0095: the third choice, Fastest (Groq), disabled until the live page says Groq may be used. ADR-0123: no
 * Voice toggle on bar 1 or Voice switch in the ⋮ menu any more. 17 Nov 2026: the menu's Model entry is one row (choices open in
 * place) and Zoom, Theme, Opacity and Answer text size are in the Display sheet, so the menu fits a laptop.
 * Clicks, the popover, the toast and the fit rules are covered in tests/integration/live.spec.ts and
 * answers.spec.ts. ADR-0102: every account's list has the GPT models; the Gemini rows only with moreModels.
 * ADR-0121: Groq is hidden: no row in any list, whatever its switch, and a call still set to it is named Claude Haiku.
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
const {
  ModelOptions,
  modelOf,
  modelOff,
  modelSwitchToast,
  modelName,
  modelRefusedToast,
  SMART_OFF_TIP,
} = await import('@/features/live/overlay/ModelChoice');
const { ControlBar } = await import('@/features/live/overlay/ControlBar');
const { LiveMenu } = await import('@/features/live/overlay/LiveMenu');
const { DisplaySheet } = await import('@/features/live/overlay/DisplaySheet');

/** A call's overlay state, on the fast model. */
const STATE: CompactState = {
  audio: { you: true, them: true },
  chips: [],
  answer: null,
  index: -1,
  total: 0,
  answering: false,
  capturing: false,
  notice: null,
  ended: false,
  autoAnswer: false,
  model: 'fast',
  smartAllowed: true,
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
};

/**
 * Bar 1 as HTML.
 *
 * @param state   The overlay state.
 * @param withChip True to give the bar its model chip handler.
 * @returns The markup.
 */
function bar(state: CompactState, withChip = true): string {
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
      {...(withChip ? { onModel: () => undefined, modelOpen: false } : {})}
    />,
  );
}

/**
 * The ⋮ menu as HTML.
 *
 * @param state The overlay state.
 * @returns The markup.
 */
function menu(state: CompactState): string {
  return renderToString(
    <LiveMenu
      state={state}
      onCommand={() => undefined}
      protection={{ supported: true, on: true }}
      onDisplay={() => undefined}
      onCallWindow={() => undefined}
      onPreferences={() => undefined}
      onModel={() => undefined}
    />,
  );
}

describe('the model choice (ADR-0094)', () => {
  it('names each model by its short name (ADR-0102)', () => {
    expect(modelName('fast')).toBe('Haiku');
    expect(modelName('smart')).toBe('Sonnet');
    // ADR-0121: Groq is hidden, so a call still set to it is named Claude Haiku.
    expect(modelName('groq')).toBe('Haiku');
  });

  it('says what the switch means in its toast', () => {
    expect(modelSwitchToast('smart')).toBe('Claude Sonnet on');
    expect(modelSwitchToast('fast')).toBe('Claude Haiku on');
    expect(modelSwitchToast('groq')).toBe('Claude Haiku on');
  });

  it('offers no choice when the live page does not say its model (an older live page)', () => {
    expect(modelOf(null)).toBeNull();
    const { model: _model, ...older } = STATE;
    expect(modelOf(older)).toBeNull();
    expect(modelOf(STATE)).toEqual({
      model: 'fast',
      smartAllowed: true,
      groqAllowed: false,
      geminiAllowed: false,
      openaiAllowed: false,
      moreModels: false,
    });
    expect(modelOf({ ...STATE, smartAllowed: false, groqAllowed: true })).toEqual({
      model: 'fast',
      smartAllowed: false,
      groqAllowed: true,
      geminiAllowed: false,
      openaiAllowed: false,
      moreModels: false,
    });
  });

  it('checks the current model', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="smart"
        smartAllowed
        groqAllowed
        openaiAllowed
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toMatch(/aria-checked="false"[^>]*data-model="fast"/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-model="smart"/);
    expect(html).not.toContain('data-model="groq"');
    expect(html).not.toContain('aria-disabled');
  });

  it('ADR-0121: offers no Groq row, whatever its switch says', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="fast"
        smartAllowed
        groqAllowed={false}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).not.toContain('data-model="groq"');
    expect(html).not.toMatch(/aria-disabled="true"[^>]*data-model="smart"/);
    expect(modelOff('groq', { smartAllowed: true, groqAllowed: false })).toBe(true);
    expect(modelOff('groq', { smartAllowed: true, groqAllowed: true })).toBe(true);
    expect(modelOff('fast', { smartAllowed: false, groqAllowed: false })).toBe(false);
  });

  it('shows Smart disabled when an admin has turned it off (aria-disabled, so its tooltip opens)', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="fast"
        smartAllowed={false}
        groqAllowed
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toMatch(/aria-disabled="true"[^>]*data-model="smart"/);
    expect(html).not.toMatch(/aria-disabled="true"[^>]*data-model="fast"/);
    // A real disabled button would fire no pointer events, so the tooltip would never open.
    expect(html).not.toMatch(/disabled=""[^>]*data-model="smart"/);
    expect(SMART_OFF_TIP).toBe('Turned off by your admin');
  });
});

describe('bar 1 and the ⋮ menu (ADR-0094)', () => {
  it('puts the model chip right after Auto answer, with its name and tooltip', () => {
    const html = bar(STATE);
    const auto = html.indexOf('aria-label="Auto answer"');
    const chip = html.indexOf('aria-label="Model: Haiku"');
    expect(auto).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(auto);
    expect(html).toContain('data-tip="Model: Claude Haiku (Recommended)"');
    expect(bar({ ...STATE, model: 'smart' })).toContain('aria-label="Model: Sonnet"');
    expect(bar({ ...STATE, model: 'gpt-luna', openaiAllowed: true })).toContain(
      'aria-label="Model: Luna"',
    );
  });

  it('puts the chip in the part of the bar that gives way, never among the pinned controls', () => {
    const html = bar(STATE);
    const giving = html.indexOf('data-fit-step');
    const chip = html.indexOf('aria-label="Model: Haiku"');
    const pinnedRight = html.indexOf('aria-label="Overlay menu"');
    expect(chip).toBeGreaterThan(giving);
    expect(chip).toBeLessThan(pinnedRight);
    expect(html.indexOf('aria-label="Transcript"')).toBeLessThan(giving);
  });

  it('has no chip without a model from the live page, or without a handler', () => {
    const { model: _model, ...older } = STATE;
    expect(bar(older)).not.toContain('aria-label="Model:');
    expect(bar(STATE, false)).not.toContain('aria-label="Model:');
  });

  it('has a one-row Model entry in the ⋮ menu, before Auto answer, naming the model in use', () => {
    const html = menu(STATE);
    expect(html).toContain('aria-label="Model: Claude Haiku (Recommended)"');
    expect(html.indexOf('data-menu-row="model"')).toBeLessThan(html.indexOf('Auto answer'));
    // Shut until clicked, so the menu stays one complete card (its choices open in place).
    expect(html).toMatch(
      /aria-expanded="false"[^>]*aria-label="Model: Claude Haiku \(Recommended\)"/,
    );
    expect(html).not.toContain('aria-label="Answer model"');
    // ADR-0121: a call still set to the hidden Groq is named Claude Haiku.
    expect(menu({ ...STATE, model: 'groq', groqAllowed: true })).toContain(
      'aria-label="Model: Claude Haiku (Recommended)"',
    );
    const { model: _model, ...older } = STATE;
    expect(menu(older)).not.toContain('data-menu-row="model"');
  });

  it('keeps Zoom, Theme, Opacity and Answer text size in the Display sheet, not the menu', () => {
    const html = menu(STATE);
    expect(html).toContain('Display');
    for (const moved of ['Zoom', 'Opacity', 'Answer text size', 'aria-label="Theme"']) {
      expect(html).not.toContain(moved);
    }
    const sheet = renderToString(
      <DisplaySheet
        theme="dark"
        zoom={1}
        fontScale={1}
        opacity={0.9}
        onOpacity={() => undefined}
        onBack={() => undefined}
      />,
    );
    for (const row of ['Back', 'Zoom', 'aria-label="Theme"', 'Opacity', 'Answer text size']) {
      expect(sheet).toContain(row);
    }
    // No opacity where the window cannot do it (a browser's picture-in-picture window).
    expect(
      renderToString(<DisplaySheet theme="dark" zoom={1} fontScale={1} onBack={() => undefined} />),
    ).not.toContain('Opacity');
  });
});

describe('No Voice control any more (ADR-0123 removes ADR-0095 Voice mode from the overlay)', () => {
  it('has no Voice toggle on bar 1 and no Voice switch in the ⋮ menu, even if a state still says Voice mode', () => {
    expect(bar({ ...STATE, voiceMode: 'off' })).not.toContain('data-voice-mode');
    expect(bar({ ...STATE, voiceMode: 'listening' })).not.toContain('Voice');
    expect(menu({ ...STATE, voiceMode: 'listening' })).not.toContain('>Voice<');
  });
});

describe('ADR-0099: the new-models rollout in the overlay', () => {
  it("lists the rollout's five choices in order, with their tags, and disables the providers that are off", () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="gemini-lite"
        smartAllowed
        groqAllowed
        geminiAllowed
        openaiAllowed={false}
        moreModels
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    const order = [
      'Gemini 3.5 Flash Lite',
      'GPT-5.6 Luna (Fast)',
      'GPT-5.6 Terra',
      'Claude Haiku (Recommended)',
      'Claude Sonnet',
    ].map((label) => html.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // ADR-0121: Groq is hidden.
    expect(html).not.toContain('Groq');
    expect(html).toMatch(/aria-disabled="true" data-model="gpt-luna"/);
    expect(html).not.toMatch(/aria-disabled="true" data-model="gemini-lite"/);
    // ADR-0104: Gemini 3.6 Flash is retired.
    expect(html).not.toContain('Gemini 3.6 Flash');
  });

  it('shows everyone else the GPT models and no Gemini rows (ADR-0102)', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="fast"
        smartAllowed
        groqAllowed
        openaiAllowed
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    const order = [
      'GPT-5.6 Luna (Fast)',
      'GPT-5.6 Terra',
      'Claude Haiku (Recommended)',
      'Claude Sonnet',
    ].map((label) => html.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('Gemini');
    expect(html).not.toContain('Groq');
    expect(html).not.toContain('aria-disabled');
  });

  it('names the new models in its toasts and on the chip', () => {
    expect(modelSwitchToast('gemini-lite')).toBe('Gemini 3.5 Flash Lite on');
    expect(modelSwitchToast('gpt-luna')).toBe('GPT-5.6 Luna on');
    expect(modelRefusedToast('gpt-terra')).toBe('GPT-5.6 Terra is turned off by your admin');
    expect(modelName('gpt-luna')).toBe('Luna');
  });
});

describe('ADR-0130: the model chip is as bright as the other bar buttons', () => {
  /**
   * The chip's ✦ span, from the rendered chip.
   * @param html The chip's HTML.
   * @returns The span's opening tag.
   */
  const iconTag = (html: string): string =>
    /<span[^>]*data-model-icon="[^"]*"[^>]*>/.exec(html)?.[0] ?? '';

  it('draws the default model ✦ in the normal text colour, never muted', async () => {
    const { ModelChip } = await import('@/features/live/overlay/ModelChoice');
    for (const word of [false, true]) {
      const html = renderToString(
        <ModelChip
          model="fast"
          word={word}
          open={false}
          disabled={false}
          onToggle={() => undefined}
        />,
      );
      expect(iconTag(html)).toContain('data-model-icon="normal"');
      expect(iconTag(html)).toContain('text-ui-text');
      expect(html).not.toContain('text-ui-muted');
      // Only `ended` dims the chip, with the bar's shared disabled style.
      expect(html).not.toContain('disabled=""');
    }
  });

  it('still marks another model with the accent ✦ and ring', async () => {
    const { ModelChip } = await import('@/features/live/overlay/ModelChoice');
    const html = renderToString(
      <ModelChip
        model="smart"
        word={false}
        open={false}
        disabled={false}
        onToggle={() => undefined}
      />,
    );
    expect(iconTag(html)).toContain('text-ui-accent');
    expect(html).toContain('ring-ui-accent-fill');
  });
});
