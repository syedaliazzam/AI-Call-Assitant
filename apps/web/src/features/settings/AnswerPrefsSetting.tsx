/**
 * File: apps/web/src/features/settings/AnswerPrefsSetting.tsx
 * Purpose: Settings → Answers: the preferred language for code in answers (Python by default), what
 *          Kite does when the documents have no real example (ADR-0030), and, for an admin, which
 *          version of the answer rules this device uses (the rollback switch, ADR-0032). Saved on
 *          this device.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/storage/answerPrefs.ts, @kite/shared (CODING_LANGUAGES), src/ui/Select.tsx
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */
'use client';

import {
  CODING_LANGUAGES,
  DEFAULT_CODING_LANGUAGE,
  type AnswerStyleVersion,
  type MissingInfoMode,
} from '@kite/shared';
import { useState, useSyncExternalStore } from 'react';
import {
  getAnswerStyleVersion,
  getCodingLanguage,
  getMissingInfoMode,
  setAnswerStyleVersion,
  setCodingLanguage,
  setMissingInfoMode,
} from '@/core/storage/answerPrefs';
import { Select } from '@/ui/Select';

/**
 * The settings change only on this page, so nothing needs to be subscribed to.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: AnswerPrefsSetting (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/** The coding languages, as choices. */
const LANGUAGE_OPTIONS = CODING_LANGUAGES.map((language) => ({
  value: language,
  label: language,
}));

/** What to do when information is missing, as choices. */
const MISSING_OPTIONS: readonly { value: MissingInfoMode; label: string }[] = [
  { value: 'approach', label: 'Approach answer' },
  { value: 'story', label: 'Full example story' },
];

/** The answer rules' versions, as choices (ADR-0032). */
const STYLE_VERSION_OPTIONS: readonly { value: AnswerStyleVersion; label: string }[] = [
  { value: 'current', label: 'v-current' },
  { value: 'previous', label: 'v-previous' },
];

/** Props for AnswerPrefsSetting. */
export interface AnswerPrefsSettingProps {
  /** True for an admin: only then is the rollback switch shown. */
  isAdmin: boolean;
}

/**
 * The settings. The server render shows the defaults (no localStorage there); the browser shows the
 * saved values, then the user's choice. The rollback switch appears for an admin only.
 *
 * @param props See AnswerPrefsSettingProps.
 * @returns The settings.
 * Rendered by: Settings.tsx
 */
export function AnswerPrefsSetting({ isAdmin }: AnswerPrefsSettingProps) {
  const savedLanguage = useSyncExternalStore(
    subscribeNever,
    getCodingLanguage,
    () => DEFAULT_CODING_LANGUAGE,
  );
  const savedMissing = useSyncExternalStore<MissingInfoMode>(
    subscribeNever,
    getMissingInfoMode,
    () => 'approach',
  );
  const savedVersion = useSyncExternalStore<AnswerStyleVersion>(
    subscribeNever,
    getAnswerStyleVersion,
    () => 'current',
  );
  const [language, setLanguage] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingInfoMode | null>(null);
  const [version, setVersion] = useState<AnswerStyleVersion | null>(null);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Select
        label="Coding language"
        hint="Code in answers is written in this language."
        options={LANGUAGE_OPTIONS}
        value={language ?? savedLanguage}
        onChange={(value) => {
          setCodingLanguage(value);
          setLanguage(value);
        }}
      />
      <Select
        label="When your CV has no example"
        hint="Kite uses your closest real project first. Approach answer: specific methods and steps, with no invented numbers, employers or results. Full example story: a made-up story, privately tagged Example, to adapt or not use."
        options={MISSING_OPTIONS}
        value={missing ?? savedMissing}
        onChange={(value) => {
          setMissingInfoMode(value);
          setMissing(value);
        }}
      />
      {isAdmin && (
        <Select
          label="Answer style version"
          hint="Admins only. v-previous goes back to the answer rules from before the honesty and length change, on this device, from the next session opened."
          options={STYLE_VERSION_OPTIONS}
          value={version ?? savedVersion}
          onChange={(value) => {
            setAnswerStyleVersion(value);
            setVersion(value);
          }}
        />
      )}
    </div>
  );
}
