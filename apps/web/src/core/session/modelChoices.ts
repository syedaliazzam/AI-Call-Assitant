/**
 * File: apps/web/src/core/session/modelChoices.ts
 * Purpose: The answer-model choices as a person reads them, in one place, so the session wizard's AI
 *          preferences, Settings, the review and the overlay's chip and ⋮ Model row say the same thing. One list
 *          in the developer's order (ADR-0099): Gemini 3.5 Flash Lite (Recommended), GPT-5.6 Luna (Fast), Gemini
 *          3.6 Flash, GPT-5.6 Terra, Claude Haiku, Claude Sonnet, Groq (Fastest). ADR-0102: every account sees
 *          it; the Gemini rows only the accounts in the Gemini rollout (KITE_ANSWER_MODELS_USERS). Also which
 *          choices are off for this account (an admin's switch, no server key).
 * Used by: src/features/session-setup/labels.ts, src/features/session-setup/PreferencesStep.tsx,
 *          src/features/settings/Settings.tsx, src/features/review/SessionReview.tsx,
 *          src/features/live/overlay/ModelChoice.tsx, src/features/live/LiveAnswers.tsx
 * Depends on: @kite/shared (AnswerModel, providerOf), ./modelAccess.ts (AnswerModelAccess)
 * Architecture: docs/decisions/ADR-0099-gemini-and-openai-answer-models.md;
 *               docs/decisions/ADR-0102-gpt-answer-models-for-every-account.md; ADR-0094; ADR-0095
 *
 * No React here (core/): plain data and pure functions.
 */
import { providerOf, type AnswerModel } from '@kite/shared';
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
 * the Gemini rollout; see STANDARD_MODEL_CHOICES). The default model stays Claude Haiku until the developer approves a change after the measurement; "Recommended" is the
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
 * ADR-0102: the choices for every account outside the Gemini rollout: the same list, words and order without
 * the Gemini rows (GPT-5.6 Luna (Fast), GPT-5.6 Terra, Claude Haiku, Claude Sonnet, Groq (Fastest)).
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
 * OpenAI) not configured on the server; for Gemini also outside the rollout (ADR-0102). The server enforces
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
