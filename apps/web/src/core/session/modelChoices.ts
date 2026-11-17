/**
 * File: apps/web/src/core/session/modelChoices.ts
 * Purpose: The answer-model choices as a person reads them, in one place, so the session wizard's AI
 *          preferences, Settings, the review and the overlay's chip and ⋮ Model row say the same thing. Two lists:
 *          the classic one (Fast, Smart, Fastest; ADR-0095) and, for the accounts in the new-models rollout
 *          (ADR-0099), the longer one in the developer's order: Gemini 3.5 Flash Lite (Recommended), GPT-5.6 Luna
 *          (Fast), Gemini 3.6 Flash, GPT-5.6 Terra, Claude Haiku, Claude Sonnet, Groq (Fastest). Also which
 *          choices are off for this account (an admin's switch, no server key).
 * Used by: src/features/session-setup/labels.ts, src/features/session-setup/PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx, src/features/review/SessionReview.tsx,
 *          src/features/live/overlay/ModelChoice.tsx, src/features/live/LiveAnswers.tsx
 * Depends on: @kite/shared (AnswerModel, providerOf), ./modelAccess.ts (AnswerModelAccess)
 * Architecture: docs/decisions/ADR-0099-gemini-and-openai-answer-models.md; ADR-0094; ADR-0095
 *
 * No React here (core/): plain data and pure functions.
 */
import { providerOf, type AnswerModel } from '@kite/shared';
import type { AnswerModelAccess } from './modelAccess';

/** One model choice. */
export interface ModelChoiceEntry {
  /** The stored value. */
  value: AnswerModel;
  /** Its short name, on the overlay's model chip ("Fast", "Flash Lite"). */
  name: string;
  /** Its name in lists ("Fast (Claude Haiku)", "Gemini 3.5 Flash Lite"). */
  title: string;
  /** What it is like, at the end of a wizard row ("Recommended"), or '' for nothing. */
  tag: string;
  /** Its row in the overlay's lists: the title, with the tag in brackets in the rollout list. */
  label: string;
}

/**
 * ADR-0095: the classic choices, unchanged for every account outside the rollout. The overlay's rows show the
 * title only (its words already say what each is like).
 */
export const CLASSIC_MODEL_CHOICES: readonly ModelChoiceEntry[] = [
  {
    value: 'fast',
    name: 'Fast',
    title: 'Fast (Claude Haiku)',
    tag: 'Recommended',
    label: 'Fast (Claude Haiku)',
  },
  {
    value: 'smart',
    name: 'Smart',
    title: 'Smart (Claude Sonnet)',
    tag: 'Deeper, slower',
    label: 'Smart (Claude Sonnet)',
  },
  {
    value: 'groq',
    name: 'Fastest',
    title: 'Fastest (Groq)',
    tag: 'Quickest',
    label: 'Fastest (Groq)',
  },
];

/**
 * Builds one rollout entry: its overlay row is the title with the tag in brackets.
 *
 * @param value The stored value.
 * @param name  The chip's short name.
 * @param title The list name.
 * @param tag   What it is like, or ''.
 * @returns The entry.
 * Called from: ROLLOUT_MODEL_CHOICES
 */
function entry(value: AnswerModel, name: string, title: string, tag = ''): ModelChoiceEntry {
  return { value, name, title, tag, label: tag ? `${title} (${tag})` : title };
}

/**
 * ADR-0099: the choices for the accounts in the rollout, in the developer's order and words. The default model
 * stays Claude Haiku until the developer approves a change after the measurement; "Recommended" is the
 * candidate the measurement is for.
 */
export const ROLLOUT_MODEL_CHOICES: readonly ModelChoiceEntry[] = [
  entry('gemini-lite', 'Flash Lite', 'Gemini 3.5 Flash Lite', 'Recommended'),
  entry('gpt-luna', 'Luna', 'GPT-5.6 Luna', 'Fast'),
  entry('gemini-flash', 'Gemini Flash', 'Gemini 3.6 Flash'),
  entry('gpt-terra', 'Terra', 'GPT-5.6 Terra'),
  entry('fast', 'Haiku', 'Claude Haiku'),
  entry('smart', 'Sonnet', 'Claude Sonnet'),
  entry('groq', 'Groq', 'Groq', 'Fastest'),
];

/**
 * The list this account sees.
 *
 * @param moreModels True for an account in the rollout (ModelAccessResponse.moreModels).
 * @returns The rollout list, or the classic one.
 * Called from: modelEntry(); PreferencesStep.tsx, Settings.tsx, ModelChoice.tsx
 */
export function modelChoices(moreModels: boolean): readonly ModelChoiceEntry[] {
  return moreModels ? ROLLOUT_MODEL_CHOICES : CLASSIC_MODEL_CHOICES;
}

/**
 * One model's entry. A Gemini or GPT model is always named from the rollout list (a session set to one keeps
 * its name even before the server has answered); Haiku, Sonnet and Groq from the list this account sees.
 *
 * @param model      The model.
 * @param moreModels True for an account in the rollout.
 * @returns Its entry.
 * Called from: ModelChoice.tsx (chip, toasts), SessionReview.tsx, LiveMenu.tsx; tests
 */
export function modelEntry(model: AnswerModel, moreModels: boolean): ModelChoiceEntry {
  const rollout = providerOf(model) === 'gemini' || providerOf(model) === 'openai';
  const list = rollout ? ROLLOUT_MODEL_CHOICES : modelChoices(moreModels);
  return list.find((choice) => choice.value === model) ?? CLASSIC_MODEL_CHOICES[0]!;
}

/**
 * Whether a choice is off for this account: Smart or a provider turned off by an admin, or (Groq, Gemini,
 * OpenAI) not configured on the server; for Gemini and OpenAI also outside the rollout. The server enforces
 * every one of these on each answer anyway; this only shows it.
 *
 * @param model  The choice.
 * @param access What the server said (core/session/modelAccess.ts).
 * @returns True when it is shown disabled.
 * Called from: PreferencesStep.tsx, LiveAnswers.tsx, ModelChoice.tsx; tests
 */
export function modelOff(model: AnswerModel, access: AnswerModelAccess): boolean {
  const provider = providerOf(model);
  if (model === 'smart') return !access.smart;
  if (provider === 'groq') return !access.groq;
  if (provider === 'gemini') return !access.gemini;
  if (provider === 'openai') return !access.openai;
  return false;
}
