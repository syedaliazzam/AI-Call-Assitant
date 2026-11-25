/**
 * File: apps/web/src/core/session/modelChoices.ts
 * Purpose: The answer-model choices as a person reads them, in one place, so the session wizard's AI
 *          preferences, Settings, the review and the overlay's chip and ⋮ Model row say the same thing. One list
 *          in the developer's order (ADR-0099): Gemini 3.5 Flash Lite, GPT-5.6 Luna (Fast), GPT-5.6 Terra,
 *          Claude Haiku (Recommended), Claude Sonnet (ADR-0104: Gemini 3.6 Flash retired, and "Recommended" moved
 *          to Claude Haiku; ADR-0121: Groq hidden). ADR-0102: every account sees it; the Gemini rows only the accounts
 *          in the Gemini rollout (KITE_ANSWER_MODELS_USERS). Also which choices are off for this account (an
 *          admin's switch, no server key).
 * Used by: src/features/session-setup/labels.ts, src/features/session-setup/PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx, src/features/review/SessionReview.tsx,
 *          src/features/live/overlay/ModelChoice.tsx, src/features/live/LiveAnswers.tsx
 * Depends on: @kite/shared (AnswerModel, providerOf), ./modelAccess.ts (AnswerModelAccess)
 * Architecture: docs/decisions/ADR-0099-gemini-and-openai-answer-models.md;
 *               docs/decisions/ADR-0102-gpt-answer-models-for-every-account.md;
 *               docs/decisions/ADR-0104-gemini-flash-lite-stays-in-rollout.md; ADR-0094; ADR-0095
 *
 * No React here (core/): plain data and pure functions.
 */
import { isHiddenModel, isRetiredModel, providerOf, type AnswerModel } from '@kite/shared';
import type { AnswerModelAccess } from './modelAccess';

/** One model choice. */
export interface ModelChoiceEntry {
  /** The stored value. */
  value: AnswerModel;
  /** Its short name, on the overlay's model chip ("Haiku", "Luna", "Flash Lite"). */
  name: string;
  /** Its name in lists ("Claude Haiku", "GPT-5.6 Luna"). */
  title: string;
  /** What it is like, at the end of a wizard row ("Recommended"), or '' for nothing. */
  tag: string;
  /** Its row in the overlay's lists: the title, with the tag in brackets. */
  label: string;
}

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
 * ADR-0099: every choice, in the developer's order and words (ADR-0102: the Gemini rows only for the accounts in
 * the Gemini rollout; see STANDARD_MODEL_CHOICES). ADR-0104: Gemini 3.6 Flash is retired and not listed (a session
 * still set to it is named and answered as Claude Haiku); "Recommended" is on Claude Haiku, the default, which the
 * 18 Nov 2026 measurement found quickest, cheapest and best-scoring (it was on Gemini 3.5 Flash Lite, the
 * candidate measured).
 */
export const ROLLOUT_MODEL_CHOICES: readonly ModelChoiceEntry[] = [
  entry('gemini-lite', 'Flash Lite', 'Gemini 3.5 Flash Lite'),
  entry('gpt-luna', 'Luna', 'GPT-5.6 Luna', 'Fast'),
  entry('gpt-terra', 'Terra', 'GPT-5.6 Terra'),
  entry('fast', 'Haiku', 'Claude Haiku', 'Recommended'),
  entry('smart', 'Sonnet', 'Claude Sonnet'),
  // ADR-0121: Groq ("Groq (Fastest)") is hidden (HIDDEN_ANSWER_MODELS): no row, so no list offers it; a session
  // still set to it is named and answered as Claude Haiku until it is moved (retireModels.ts).
];

/**
 * ADR-0102: the choices for every account outside the Gemini rollout: the same list, words and order without
 * the Gemini rows (GPT-5.6 Luna (Fast), GPT-5.6 Terra, Claude Haiku, Claude Sonnet).
 */
export const STANDARD_MODEL_CHOICES: readonly ModelChoiceEntry[] = ROLLOUT_MODEL_CHOICES.filter(
  (choice) => providerOf(choice.value) !== 'gemini',
);

/** Claude Haiku's entry: the default model, and the name of any value not in the list. */
const HAIKU_CHOICE: ModelChoiceEntry = ROLLOUT_MODEL_CHOICES.find(
  (choice) => choice.value === 'fast',
)!;

/**
 * The list this account sees.
 *
 * @param moreModels True for an account in the Gemini rollout (ModelAccessResponse.moreModels).
 * @returns The whole list, or (ADR-0102) the list without the Gemini rows.
 * Called from: PreferencesStep.tsx, Settings.tsx, ModelChoice.tsx (through labels.ts for the first two)
 */
export function modelChoices(moreModels: boolean): readonly ModelChoiceEntry[] {
  return moreModels ? ROLLOUT_MODEL_CHOICES : STANDARD_MODEL_CHOICES;
}

/**
 * One model's entry, named the same for every account (ADR-0102), so a session set to a Gemini model keeps its
 * name even where the Gemini rows are not shown.
 *
 * @param model The model.
 * @returns Its entry (Claude Haiku's for an unknown value).
 * Called from: ModelChoice.tsx (chip, toasts), SessionReview.tsx, LiveMenu.tsx; tests
 */
export function modelEntry(model: AnswerModel): ModelChoiceEntry {
  return ROLLOUT_MODEL_CHOICES.find((choice) => choice.value === model) ?? HAIKU_CHOICE;
}

/**
 * Whether a choice is off for this account: Smart or a provider turned off by an admin, or (Groq, Gemini,
 * OpenAI) not configured on the server; for Gemini also outside the rollout (ADR-0102); ADR-0104: always for a
 * retired model. The server enforces
 * every one of these on each answer anyway; this only shows it.
 *
 * @param model  The choice.
 * @param access What the server said (core/session/modelAccess.ts).
 * @returns True when it is shown disabled.
 * Called from: PreferencesStep.tsx, LiveAnswers.tsx, ModelChoice.tsx; tests
 */
export function modelOff(model: AnswerModel, access: AnswerModelAccess): boolean {
  const provider = providerOf(model);
  // ADR-0121: a hidden model (Groq) is off like a retired one.
  if (isRetiredModel(model) || isHiddenModel(model)) return true;
  if (model === 'smart') return !access.smart;
  if (provider === 'groq') return !access.groq;
  if (provider === 'gemini') return !access.gemini;
  if (provider === 'openai') return !access.openai;
  return false;
}
