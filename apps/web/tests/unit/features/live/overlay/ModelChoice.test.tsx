/**
 * Tests for apps/web/src/features/live/overlay/ModelChoice.tsx and its use in ControlBar.tsx and
 * LiveMenu.tsx (ADR-0094): the two choices with the current one checked; Smart disabled (aria-disabled,
 * so its tooltip still opens) when an admin has turned it off; the toast's words; bar 1's chip next to
 * Auto answer with the model's name, only when the live page says its model; and the ⋮ menu's Model row.
 * ADR-0095: the third choice, Fastest (Groq), disabled until the live page says Groq may be used; and bar 1's
 * Voice toggle and the ⋮ menu's Voice switch.
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
const {
  ModelOptions,
  modelOf,
  modelOff,
  modelSwitchToast,
  modelName,
  MODEL_CHOICES,
  SMART_OFF_TIP,
} = await import('@/features/live/overlay/ModelChoice');
const { ControlBar, voiceTip, VOICE_TIP } = await import('@/features/live/overlay/ControlBar');
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
 * @param withVoice True to give the bar its Voice toggle handler (ADR-0095).
 * @returns The markup.
 */
function bar(state: CompactState, withChip = true, withVoice = false): string {
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
      {...(withVoice ? { onVoice: () => undefined } : {})}
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
  it('offers Fast, Smart and Fastest with the words the wizard uses too (ADR-0095)', () => {
    expect(MODEL_CHOICES.map((choice) => choice.label)).toEqual([
      'Fast (Claude Haiku)',
      'Smart (Claude Sonnet)',
      'Fastest (Groq)',
    ]);
    expect(modelName('fast')).toBe('Fast');
    expect(modelName('smart')).toBe('Smart');
    expect(modelName('groq')).toBe('Fastest');
  });

  it('says what the switch means in its toast', () => {
    expect(modelSwitchToast('smart')).toBe('Smart model on — answers may take a bit longer');
    expect(modelSwitchToast('fast')).toBe('Fast model on — quick answers');
    expect(modelSwitchToast('groq')).toBe('Fastest model on (Groq)');
  });

  it('offers no choice when the live page does not say its model (an older live page)', () => {
    expect(modelOf(null)).toBeNull();
    const { model: _model, ...older } = STATE;
    expect(modelOf(older)).toBeNull();
    expect(modelOf(STATE)).toEqual({ model: 'fast', smartAllowed: true, groqAllowed: false });
    expect(modelOf({ ...STATE, smartAllowed: false, groqAllowed: true })).toEqual({
      model: 'fast',
      smartAllowed: false,
      groqAllowed: true,
    });
  });

  it('checks the current model', () => {
    const html = renderToString(
      <ModelOptions
        label="Model"
        model="smart"
        smartAllowed
        groqAllowed
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toMatch(/aria-checked="false"[^>]*data-model="fast"/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-model="smart"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-model="groq"/);
    expect(html).not.toContain('aria-disabled');
  });

  it('shows Fastest (Groq) disabled while Groq is off (ADR-0095)', () => {
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
    expect(html).toMatch(/aria-disabled="true"[^>]*data-model="groq"/);
    expect(html).not.toMatch(/aria-disabled="true"[^>]*data-model="smart"/);
    expect(modelOff('groq', { smartAllowed: true, groqAllowed: false })).toBe(true);
    expect(modelOff('groq', { smartAllowed: true, groqAllowed: true })).toBe(false);
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
    const chip = html.indexOf('aria-label="Model: Fast"');
    expect(auto).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(auto);
    expect(html).toContain('data-tip="Model: Fast (Claude Haiku)"');
    expect(bar({ ...STATE, model: 'smart' })).toContain('aria-label="Model: Smart"');
    expect(bar({ ...STATE, model: 'groq', groqAllowed: true })).toContain(
      'aria-label="Model: Fastest"',
    );
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

describe('Voice mode on bar 1 and in the ⋮ menu (ADR-0095)', () => {
  it('puts the Voice toggle after the model chip, in the part that gives way', () => {
    const html = bar({ ...STATE, voiceMode: 'off' }, true, true);
    const chip = html.indexOf('aria-label="Model: Fast"');
    const voice = html.indexOf('aria-label="Voice: talk to Paramount AI hands-free"');
    const giving = html.indexOf('data-fit-step');
    const pinnedRight = html.indexOf('aria-label="Overlay menu"');
    expect(voice).toBeGreaterThan(chip);
    expect(voice).toBeGreaterThan(giving);
    expect(voice).toBeLessThan(pinnedRight);
    expect(html).toContain('data-voice-mode="off"');
    expect(html).toContain('>Voice<');
    expect(html).toContain(`data-tip="${VOICE_TIP} · Off"`);
  });

  it('shows its state', () => {
    expect(bar({ ...STATE, voiceMode: 'listening' }, true, true)).toMatch(
      /aria-checked="true"[^>]*data-voice-mode="listening"/,
    );
    expect(bar({ ...STATE, voiceMode: 'paused' }, true, true)).toContain(
      'data-voice-mode="paused"',
    );
    expect(VOICE_TIP).toBe('Talk to Paramount AI hands-free');
    expect(voiceTip('listening')).toBe('Talk to Paramount AI hands-free · On (Esc turns it off)');
    expect(voiceTip('paused')).toBe('Talk to Paramount AI hands-free · Paused while they speak');
  });

  it('has no toggle for an older live page, or without a handler', () => {
    expect(bar(STATE, true, true)).not.toContain('data-voice-mode');
    expect(bar({ ...STATE, voiceMode: 'off' }, true, false)).not.toContain('data-voice-mode');
  });

  it('has a Voice switch in the ⋮ menu, after Auto answer, only when the live page says Voice mode', () => {
    const html = menu({ ...STATE, voiceMode: 'listening' });
    expect(html).toContain('Voice');
    expect(html.indexOf('>Voice<')).toBeGreaterThan(html.indexOf('Auto answer'));
    expect(menu(STATE)).not.toContain('>Voice<');
  });
});
