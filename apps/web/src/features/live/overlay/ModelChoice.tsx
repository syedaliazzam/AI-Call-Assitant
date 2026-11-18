/**
 * File: apps/web/src/features/live/overlay/ModelChoice.tsx
 * Purpose: The answer model during a call, from the overlay (ADR-0094): the choices as a list with the current
 *          one checked, used by the ⋮ menu's Model row and by bar 1's model chip; the chip itself; its popover;
 *          and the toast's words. A choice that is off (an admin's switch, no server key) is shown disabled, with
 *          "Turned off by your admin" (the server enforces that on every answer anyway). Tooltips are drawn in
 *          the page (ADR-0042), so they stay inside the protected window. The list (core/session/modelChoices.ts,
 *          the same words as AI preferences): GPT-5.6 Luna (Fast), GPT-5.6 Terra, Claude Haiku, Claude Sonnet,
 *          Groq (Fastest) for every account (ADR-0102), with Gemini 3.5 Flash Lite (Recommended) and Gemini 3.6
 *          Flash for an account in the Gemini rollout (ADR-0099).
 * Used by: src/features/live/overlay/LiveMenu.tsx, src/features/live/overlay/ControlBar.tsx,
 *          src/features/live/CompactView.tsx
 * Depends on: lucide-react, src/core/live/liveChannel.ts (CompactState), src/core/storage/types.ts
 *             (AnswerModel), src/core/session/modelChoices.ts (the lists, ADR-0099), src/ui/Tooltip.tsx,
 *             ./parts.tsx (bar button styles)
 * Architecture: docs/decisions/ADR-0094-switch-the-answer-model-during-a-call.md;
 *               docs/decisions/ADR-0095-voice-mode-groq-and-move-keys.md;
 *               docs/design/paramount-ai-ui-spec.md §3 (S13, S16)
 */
'use client';

import { Check, Sparkles } from 'lucide-react';
import { forwardRef, type RefObject } from 'react';
import type { CompactState } from '@/core/live/liveChannel';
import { modelChoices, modelEntry, modelOff as modelOffFor } from '@/core/session/modelChoices';
import type { AnswerModel } from '@/core/storage/types';
import { ChevronDownIcon } from '@/ui/icons';
import { Tooltip } from '@/ui/Tooltip';
import { ICON_BUTTON, PILL } from './parts';

/** One model choice as the overlay shows it. */
export interface ModelChoiceOption {
  /** The stored tier. */
  value: AnswerModel;
  /** Its short name, on bar 1's chip. */
  name: string;
  /** Its row in the lists: the name and what it is like. */
  label: string;
}

/** The tooltip on a choice while it is turned off. */
export const SMART_OFF_TIP = 'Turned off by your admin';

/** Which of the choices may be picked now. */
export interface ModelAllowed {
  /** False when an admin has turned Smart off. */
  smartAllowed: boolean;
  /** ADR-0095: false when Groq is off (no server key, or an admin turned it off). */
  groqAllowed: boolean;
  /** ADR-0099: false (or absent) when the Gemini models are off for this account. */
  geminiAllowed?: boolean | undefined;
  /** ADR-0099: false (or absent) when the GPT models are off for this account. */
  openaiAllowed?: boolean | undefined;
  /** ADR-0099: true for an account in the Gemini rollout (the list shows the Gemini rows). */
  moreModels?: boolean | undefined;
}

/**
 * Whether a choice is off.
 *
 * @param model   The choice.
 * @param allowed Which may be picked.
 * @returns True when it is shown disabled.
 * Called from: ModelOptions; CompactView.tsx; tests
 */
export function modelOff(model: AnswerModel, allowed: ModelAllowed): boolean {
  return modelOffFor(model, {
    smart: allowed.smartAllowed,
    groq: allowed.groqAllowed,
    gemini: allowed.geminiAllowed === true,
    openai: allowed.openaiAllowed === true,
    moreModels: allowed.moreModels === true,
  });
}

/**
 * The toast shown once the live page has switched the model (ADR-0094).
 *
 * @param model The model now in use.
 * @returns The toast's words: "<name> on" (ADR-0102: the same words for every account).
 * Called from: CompactView.tsx; tests
 */
export function modelSwitchToast(model: AnswerModel): string {
  return `${modelEntry(model).title} on`;
}

/**
 * ADR-0099: the toast shown when a model was picked but it is off (the model stays as it was).
 *
 * @param model The model picked.
 * @returns "<name> is turned off by your admin".
 * Called from: CompactView.tsx; tests
 */
export function modelRefusedToast(model: AnswerModel): string {
  return `${modelEntry(model).title} is turned off by your admin`;
}

/**
 * A choice's short name.
 *
 * @param model The model.
 * @returns "Haiku", "Luna", "Flash Lite" and so on.
 * Called from: ModelChip; tests
 */
export function modelName(model: AnswerModel): string {
  return modelEntry(model).name;
}

/**
 * Whether the overlay should offer the model choice: only when the live page says which model it uses
 * (an older live page does not).
 *
 * @param state What the live page shows.
 * @returns The model in use and which choices may be picked, or null for no choice.
 * Called from: LiveMenu.tsx, ControlBar.tsx, CompactView.tsx
 */
export function modelOf(
  state: CompactState | null,
): ({ model: AnswerModel } & ModelAllowed) | null {
  if (!state?.model) return null;
  return {
    model: state.model,
    smartAllowed: state.smartAllowed !== false,
    // ADR-0095: an older live page does not say, and Groq then stays disabled.
    groqAllowed: state.groqAllowed === true,
    // ADR-0099: the same for the Gemini and GPT models, and the Gemini rows.
    geminiAllowed: state.geminiAllowed === true,
    openaiAllowed: state.openaiAllowed === true,
    moreModels: state.moreModels === true,
  };
}

/** The focus ring every control here shares. */
const FOCUS = 'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * The choices as radio rows, the current one checked. Picking the current one changes nothing.
 *
 * @param props.label        What the group chooses, for screen readers.
 * @param props.model        The model in use.
 * @param props.smartAllowed False when an admin has turned Smart off (it is then disabled, with a tooltip).
 * @param props.groqAllowed  False when Groq is off (ADR-0095; disabled the same way).
 * @param props.geminiAllowed ADR-0099: false when the Gemini models are off.
 * @param props.openaiAllowed ADR-0099: false when the GPT models are off.
 * @param props.moreModels   ADR-0099: true to show the Gemini rows (an account in their rollout).
 * @param props.onSelect     Called with a different, allowed choice.
 * @param props.onClose      Called after any choice (the menu or popover closes).
 * @returns The group.
 * Rendered by: LiveMenu (Model row), ModelPopover
 */
export function ModelOptions({
  label,
  model,
  smartAllowed,
  groqAllowed,
  geminiAllowed = false,
  openaiAllowed = false,
  moreModels = false,
  onSelect,
  onClose,
}: {
  /** What the group chooses, for screen readers. */
  label: string;
  /** The model in use. */
  model: AnswerModel;
  /** False when an admin has turned Smart off. */
  smartAllowed: boolean;
  /** ADR-0095: false when Groq is off. */
  groqAllowed: boolean;
  /** ADR-0099: false when the Gemini models are off. */
  geminiAllowed?: boolean | undefined;
  /** ADR-0099: false when the GPT models are off. */
  openaiAllowed?: boolean | undefined;
  /** ADR-0099: true to show the Gemini rows. */
  moreModels?: boolean | undefined;
  /** Called with a different, allowed choice. */
  onSelect: (model: AnswerModel) => void;
  /** Called after any choice. */
  onClose: () => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col py-0.5">
      {modelChoices(moreModels).map((choice) => {
        const checked = choice.value === model;
        const off = modelOff(choice.value, {
          smartAllowed,
          groqAllowed,
          geminiAllowed,
          openaiAllowed,
          moreModels,
        });
        const row = (
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            // aria-disabled, not disabled: a disabled button fires no pointer events, and its tooltip
            // must still open on hover. The click is ignored below.
            aria-disabled={off || undefined}
            data-model={choice.value}
            onClick={() => {
              if (off) return;
              if (!checked) onSelect(choice.value);
              onClose();
            }}
            className={`flex min-h-9 w-full items-center gap-2.5 rounded-control px-3 py-1 text-left text-[13px] ${FOCUS} ${
              off
                ? 'cursor-not-allowed text-ui-muted opacity-60'
                : `hover:bg-ui-hover ${checked ? 'font-semibold text-ui-text' : 'text-ui-text'}`
            }`}
          >
            <span aria-hidden="true" className="inline-flex w-4 shrink-0 justify-center">
              {checked && <Check size={15} strokeWidth={2.25} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
          </button>
        );
        return off ? (
          <Tooltip key={choice.value} content={SMART_OFF_TIP} className="w-full">
            {row}
          </Tooltip>
        ) : (
          <div key={choice.value}>{row}</div>
        );
      })}
    </div>
  );
}

/**
 * Bar 1's model chip (ADR-0094): the model's short name ("Haiku", "Luna") with a ▾, next to Auto answer; it opens the same choice
 * as the ⋮ menu's Model row. When bar 1 is short of room it gives way to its icon, with Auto answer.
 *
 * @param props.model     The model in use.
 * @param props.word      False to show the icon only.
 * @param props.open      True while its popover is open.
 * @param props.disabled  True before the live page answers, or once the call ended.
 * @param props.buttonRef The chip (its popover sits under it).
 * @param props.onToggle  Opens or closes its popover.
 * @returns The chip.
 * Rendered by: ControlBar
 */
export function ModelChip({
  model,
  word,
  open,
  disabled,
  buttonRef,
  onToggle,
}: {
  /** The model in use. */
  model: AnswerModel;
  /** False to show the icon only. */
  word: boolean;
  /** True while its popover is open. */
  open: boolean;
  /** True before the live page answers, or once the call ended. */
  disabled: boolean;
  /** The chip (its popover sits under it). */
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
  /** Opens or closes its popover. */
  onToggle: () => void;
}) {
  const name = modelName(model);
  return (
    <button
      ref={buttonRef}
      type="button"
      // A click on it is not a click outside its popover (CompactView closes popups on outside clicks).
      data-popup-button
      aria-label={`Model: ${name}`}
      aria-haspopup="true"
      aria-expanded={open}
      data-tip={`Model: ${modelEntry(model).label}`}
      data-model-chip={model}
      className={`${word ? `${PILL} gap-1 pr-1` : `${ICON_BUTTON} relative`} ${model !== 'fast' ? 'text-ui-text ring-1 ring-inset ring-ui-accent-fill' : 'text-ui-text'}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span
        aria-hidden="true"
        className={`inline-flex ${model !== 'fast' ? 'text-ui-accent' : 'text-ui-muted'}`}
      >
        <Sparkles size={15} strokeWidth={1.75} />
      </span>
      {word && (
        <>
          {name}
          <ChevronDownIcon size={12} />
        </>
      )}
    </button>
  );
}

/** Props for ModelPopover. */
export interface ModelPopoverProps {
  /** The model in use. */
  model: AnswerModel;
  /** False when an admin has turned Smart off. */
  smartAllowed: boolean;
  /** ADR-0095: false when Groq is off. */
  groqAllowed: boolean;
  /** ADR-0099: false when the Gemini models are off. */
  geminiAllowed?: boolean | undefined;
  /** ADR-0099: false when the GPT models are off. */
  openaiAllowed?: boolean | undefined;
  /** ADR-0099: true to show the Gemini rows. */
  moreModels?: boolean | undefined;
  /** Its left edge inside bar 1's box, px (under the chip, kept inside the window). */
  left: number;
  /** Called with a different, allowed choice. */
  onSelect: (model: AnswerModel) => void;
  /** Closes it. */
  onClose: () => void;
}

/**
 * The chip's popover: the same choice as the ⋮ menu's Model row, under the chip (above it on the bottom
 * row: k-overlay-menu, theme.css).
 *
 * @param props See ModelPopoverProps.
 * @param ref   Its element, so the window can grow to fit it and outside clicks close it.
 * @returns The popover.
 * Rendered by: CompactView.tsx
 */
export const ModelPopover = forwardRef<HTMLDivElement, ModelPopoverProps>(function ModelPopover(
  {
    model,
    smartAllowed,
    groqAllowed,
    geminiAllowed,
    openaiAllowed,
    moreModels,
    left,
    onSelect,
    onClose,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Model"
      data-menu="model"
      style={{ left }}
      className={`k-overlay-menu absolute top-[calc(100%+6px)] z-30 flex w-72 flex-col rounded-menu border border-ui-border p-1.5 text-ui-text shadow-modal [-webkit-app-region:no-drag]`}
    >
      <p className="px-3 pb-0.5 pt-1 text-[12px] font-medium text-ui-muted">Model</p>
      <ModelOptions
        label="Model"
        model={model}
        smartAllowed={smartAllowed}
        groqAllowed={groqAllowed}
        geminiAllowed={geminiAllowed}
        openaiAllowed={openaiAllowed}
        moreModels={moreModels}
        onSelect={onSelect}
        onClose={onClose}
      />
    </div>
  );
});
