/**
 * Tests for apps/web/src/features/live/overlay/ModelChoice.tsx and its use in ControlBar.tsx and
 * LiveMenu.tsx (ADR-0094): the two choices with the current one checked; Smart disabled (aria-disabled,
 * so its tooltip still opens) when an admin has turned it off; the toast's words; bar 1's chip next to
 * Auto answer with the model's name, only when the live page says its model; and the ⋮ menu's Model row.
 * Clicks, the popover, the toast and the fit rules are covered in tests/integration/live.spec.ts and
 * answers.spec.ts.
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
const { ModelOptions, modelOf, modelSwitchToast, modelName, MODEL_CHOICES, SMART_OFF_TIP } =
  await import('@/features/live/overlay/ModelChoice');
const { ControlBar } = await import('@/features/live/overlay/ControlBar');
const { LiveMenu } = await import('@/features/live/overlay/LiveMenu');

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
      transcriptOpen={false}
      onTranscript={() => undefined}
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
      theme="dark"
      zoom={1}
      fontScale={1}
      onCallWindow={() => undefined}
      onPreferences={() => undefined}
      onModel={() => undefined}
    />,
  );
}

describe('the model choice (ADR-0094)', () => {
  it('offers Fast and Smart with the words the overlay shows', () => {
    expect(MODEL_CHOICES.map((choice) => choice.label)).toEqual([
      'Fast — quickest answers',
      'Smart — more thorough, slower',
    ]);
    expect(modelName('fast')).toBe('Fast');
    expect(modelName('smart')).toBe('Smart');
  });

  it('says what the switch means in its toast', () => {
    expect(modelSwitchToast('smart')).toBe('Smart model on — answers may take a bit longer');
    expect(modelSwitchToast('fast')).toBe('Fast model on — quickest answers');
  });

  it('offers no choice when the live page does not say its model (an older live page)', () => {
    expect(modelOf(null)).toBeNull();
    const { model: _model, ...older } = STATE;
    expect(modelOf(older)).toBeNull();
    expect(modelOf(STATE)).toEqual({ model: 'fast', smartAllowed: true });
    expect(modelOf({ ...STATE, smartAllowed: false })).toEqual({
      model: 'fast',
      smartAllowed: false,
    });
  });

  it('checks the current model', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="smart"
        smartAllowed
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toMatch(/aria-checked="false"[^>]*data-model="fast"/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-model="smart"/);
    expect(html).not.toContain('aria-disabled');
  });

  it('shows Smart disabled when an admin has turned it off (aria-disabled, so its tooltip opens)', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="fast"
        smartAllowed={false}
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
    const chip = html.indexOf('aria-label="Model: Fast"');
    expect(auto).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(auto);
    expect(html).toContain('data-tip="Model: Fast — quickest answers"');
    expect(bar({ ...STATE, model: 'smart' })).toContain('aria-label="Model: Smart"');
  });

  it('puts the chip in the part of the bar that gives way, never among the pinned controls', () => {
    const html = bar(STATE);
    const giving = html.indexOf('data-fit-step');
    const chip = html.indexOf('aria-label="Model: Fast"');
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

  it('has a Model row in the ⋮ menu, before Auto answer, with Smart off when an admin turned it off', () => {
    const html = menu(STATE);
    expect(html).toContain('aria-label="Answer model"');
    expect(html.indexOf('aria-label="Answer model"')).toBeLessThan(html.indexOf('Auto answer'));
    expect(menu({ ...STATE, smartAllowed: false })).toMatch(
      /aria-disabled="true"[^>]*data-model="smart"/,
    );
    const { model: _model, ...older } = STATE;
    expect(menu(older)).not.toContain('aria-label="Answer model"');
  });
});
