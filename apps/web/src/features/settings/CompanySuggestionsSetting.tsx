/**
 * File: apps/web/src/features/settings/CompanySuggestionsSetting.tsx
 * Purpose: The Settings → Privacy switch for company suggestions (ADR-0048), on by default, saying
 *          plainly what is sent and what off means.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/storage/companyPrefs.ts, src/ui/Toggle.tsx
 * Architecture: docs/decisions/ADR-0048-company-suggestions-from-brandfetch.md
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import { companySuggestionsOn, setCompanySuggestionsOn } from '@/core/storage/companyPrefs';
import { Toggle } from '@/ui/Toggle';

/**
 * The setting never changes from outside this page, so nothing needs to be subscribed to.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: CompanySuggestionsSetting (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * The switch. The server render shows it off (no localStorage there); the browser then shows the
 * saved value, then the user's choice.
 *
 * @returns The switch.
 * Rendered by: Settings.tsx
 */
export function CompanySuggestionsSetting() {
  const saved = useSyncExternalStore(subscribeNever, companySuggestionsOn, () => false);
  const [choice, setChoice] = useState<boolean | null>(null);
  return (
    <Toggle
      label="Company suggestions"
      hint="On: the company name you type, and the websites of companies you pick, go to Brandfetch to suggest names and show logos. Off: nothing goes to Brandfetch. Only your past sessions are suggested, and session cards show a letter instead of a logo."
      checked={choice ?? saved}
      onChange={(next) => {
        setCompanySuggestionsOn(next);
        setChoice(next);
      }}
    />
  );
}
